// allow-test-rule: integration-test-input
// Regression test for #131: runNpm() must not fail when HOME points at an
// unwritable directory. The before() hook in release-tarball-smoke.install.test.cjs
// calls runNpm(['pack', ...]) and runNpm(['install', '-g', ...]) — if those inherit
// an unwritable HOME from the environment (common in constrained Docker hosts),
// the entire hook fails and all 6 subtests are cancelled.
//
// Fix: runNpm() must inject an explicit HOME, npm_config_cache, and
// npm_config_userconfig that point into a temp directory it owns, so that npm
// never reads from or writes to the caller's HOME.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The helper under test.
const { runNpm } = require('./helpers.cjs');

describe('bug-131: runNpm isolates HOME from the caller environment', () => {
  // ── Test 1 — runNpm works with an unwritable HOME ────────────────────────
  // Spawn a child Node process that sets HOME to a chmod-0500 directory, then
  // invokes runNpm(['--version']). Without the fix, npm tries to read/write
  // HOME/.npmrc and HOME/.npm, fails with EACCES, and runNpm throws.
  // With the fix, runNpm injects its own isolated HOME and npm succeeds.
  test('runNpm succeeds even when process HOME is unwritable', () => {
    // Create an unwritable dir to act as a poisoned HOME.
    const poisonedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-bug131-poison-'));
    try {
      fs.chmodSync(poisonedHome, 0o500); // r-x only — not writable

      // We exercise the real runNpm() path by running a tiny inline Node script
      // that requires helpers.cjs and calls runNpm(['--version']) with HOME set
      // to the unwritable dir. The script exits 0 on success, non-zero on throw.
      const script = `
        process.env.HOME = ${JSON.stringify(poisonedHome)};
        const { runNpm } = require(${JSON.stringify(path.join(__dirname, 'helpers.cjs'))});
        try {
          const out = runNpm(['--version']);
          if (!out || out.trim() === '') process.exit(2); // vacuous success guard
          process.stdout.write(out);
          process.exit(0);
        } catch (e) {
          process.stderr.write(e.message + '\\n');
          process.exit(1);
        }
      `;

      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      try {
        stdout = execFileSync(process.execPath, ['-e', script], {
          encoding: 'utf-8',
          timeout: 30_000,
        });
      } catch (err) {
        stdout = err.stdout || '';
        stderr = err.stderr || '';
        exitCode = err.status ?? 1;
      }

      assert.equal(
        exitCode,
        0,
        `runNpm should succeed with an unwritable HOME but exited ${exitCode}. stderr: ${stderr}`,
      );
      // npm --version returns something like "10.x.y"
      assert.match(
        stdout.trim(),
        /^\d+\.\d+/,
        `expected semver output from npm --version, got: ${stdout}`,
      );
    } finally {
      // Restore write permission before cleanup so rmSync can delete it.
      try { fs.chmodSync(poisonedHome, 0o700); } catch (_) { /* best-effort */ }
      fs.rmSync(poisonedHome, { recursive: true, force: true });
    }
  });

  // ── Test 2 — runNpm does not leak a caller-supplied HOME into npm ────────
  // Even if the caller exports HOME=/some/real/path, the injected HOME must be
  // a different (temp) path so npm writes never touch the caller's $HOME.
  test('runNpm injects a HOME distinct from process.env.HOME', () => {
    // Capture what HOME runNpm actually passes to npm by asking npm to print
    // the value it sees for the $HOME env var. We do this via `npm config get
    // cache` which reveals the cache path — if it's under process.env.HOME,
    // the fix is absent; if it's under a tmp dir, the fix is present.

    const script = `
      const { runNpm } = require(${JSON.stringify(path.join(__dirname, 'helpers.cjs'))});
      try {
        // npm config get cache prints the effective cache directory.
        const out = runNpm(['config', 'get', 'cache']);
        process.stdout.write(out.trim());
        process.exit(0);
      } catch (e) {
        process.stderr.write(e.message + '\\n');
        process.exit(1);
      }
    `;

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execFileSync(process.execPath, ['-e', script], {
        encoding: 'utf-8',
        timeout: 30_000,
      });
    } catch (err) {
      stdout = err.stdout || '';
      stderr = err.stderr || '';
      exitCode = err.status ?? 1;
    }

    assert.equal(
      exitCode,
      0,
      `runNpm config get cache failed with exit ${exitCode}. stderr: ${stderr}`,
    );

    const effectiveCacheDir = stdout.trim();

    // The effective npm cache must NOT be inside the calling process's HOME.
    // If it is, the fix was not applied and the Docker regression can still occur.
    const callerHome = os.homedir();
    assert.ok(
      !effectiveCacheDir.startsWith(callerHome),
      `npm cache dir ${effectiveCacheDir} is still under caller HOME ${callerHome} — fix not applied`,
    );

    // It must be somewhere under the system tmp dir, confirming isolation.
    const sysTmp = fs.realpathSync(os.tmpdir());
    const realCacheDir = (() => {
      try { return fs.realpathSync(effectiveCacheDir); } catch (_) { return effectiveCacheDir; }
    })();
    assert.ok(
      realCacheDir.startsWith(sysTmp),
      `npm cache dir ${realCacheDir} should be under tmpdir ${sysTmp}`,
    );
  });
});
