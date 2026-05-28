'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const HOOK_PATH = path.join(ROOT, '.githooks', 'pre-push');

function writeExec(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
  if (process.platform === 'win32') {
    // Node's fs.writeFileSync mode=0o755 is a no-op for the execute bit on NTFS
    // per https://nodejs.org/docs/latest-v22.x/api/fs.html — "on Windows only
    // the write permission can be changed". Bash's access(X_OK) skips the file.
    // The canonical MSYS2/Cygwin pattern is to chmod via the POSIX emulation layer:
    const posixPath = filePath.replace(/\\/g, '/');
    execFileSync('bash', ['-c', `chmod +x "${posixPath}"`], { stdio: 'pipe' });
  }
}

/**
 * Write a mock executable into binDir with cross-platform shims.
 *
 * On Windows, bash (Git Bash / MSYS2) PATH scanning finds extensionless files,
 * but cmd.exe and Win32 process creation use PATHEXT (.CMD, .EXE, etc.).
 * When a bash hook script calls `git` inside a Node `execFileSync('bash', ...)`
 * invocation on Windows, both resolution paths may fire depending on where the
 * shell delegates execution — so we need all three shim files.
 *
 * Pattern: npm/cmd-shim (https://github.com/npm/cmd-shim) — generates
 * <name>, <name>.cmd, <name>.ps1 per bin. Used for test mocking by
 * stevemao/mock-bin (https://github.com/stevemao/mock-bin), AppVeyor CI green.
 *
 * MSYS2_PATH_TYPE=inherit does NOT work here because it is only read in
 * /etc/profile (login shell path). `execFileSync('bash', ...)` launches bash
 * non-interactively without --login, so /etc/profile is never sourced:
 * https://github.com/msys2/MSYS2-packages/blob/master/filesystem/profile
 */
function writeMockBin(binDir, name, bashBody) {
  // 1. Extensionless bash script — bash PATH scan picks this up.
  writeExec(path.join(binDir, name), bashBody);

  if (process.platform === 'win32') {
    // 2. .cmd — cmd.exe / PATHEXT / Win32 spawn resolution.
    //    Delegates to the extensionless script via bash so mock logic stays DRY.
    //    cmd-shim pattern: https://github.com/npm/cmd-shim
    fs.writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@SETLOCAL\r\n@bash "%~dp0${name}" %*\r\n`,
      { encoding: 'utf-8' },
    );
    // 3. .ps1 — PowerShell PATH resolution (completeness, matches cmd-shim surface).
    fs.writeFileSync(
      path.join(binDir, `${name}.ps1`),
      `#!/usr/bin/env pwsh\n& bash "$PSScriptRoot/${name}" $args\n`,
      { encoding: 'utf-8' },
    );
  }
}

describe('.githooks/pre-push enterprise email guard', () => {
  test('blocks push when any to-be-pushed commit matches local blocked regex', (t) => {
    const tmpDir = createTempDir('gsd-prepush-hook-');
    t.after(() => cleanup(tmpDir));

    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    writeMockBin(binDir, 'git', `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "rev-list" ]]; then
  echo "c1"
  echo "c2"
  exit 0
fi
if [[ "$1" == "show" ]]; then
  commit="$(printf '%s\n' "$@" | tail -n 1)"
  if [[ "$commit" == "c1" ]]; then
    echo "trekkie@nomorestars.com"
  else
    echo "person@example-corp.com"
  fi
  exit 0
fi
exit 1
`);

    assert.throws(() => {
      execFileSync('bash', [HOOK_PATH], {
        cwd: ROOT,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          GSD_BLOCKED_AUTHOR_REGEX: '@example-corp\\.com$',
        },
        input: 'refs/heads/pr refs-local-sha refs/heads/pr refs-remote-sha\n',
        stdio: 'pipe',
      });
    }, /Push blocked: commit author email matched local blocked regex/);
  });

  test('allows push when to-be-pushed commits are non-enterprise emails', (t) => {
    const tmpDir = createTempDir('gsd-prepush-hook-');
    t.after(() => cleanup(tmpDir));

    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    writeMockBin(binDir, 'git', `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "rev-list" ]]; then
  echo "c1"
  echo "c2"
  exit 0
fi
if [[ "$1" == "show" ]]; then
  echo "trekkie@nomorestars.com"
  exit 0
fi
exit 1
`);

    execFileSync('bash', [HOOK_PATH], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        GSD_BLOCKED_AUTHOR_REGEX: '@example-corp\\.com$',
      },
      input: 'refs/heads/pr refs-local-sha refs/heads/pr refs-remote-sha\n',
      stdio: 'pipe',
    });
  });
});
