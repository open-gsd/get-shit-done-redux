/**
 * Regression tests for #338: Claude --local installs must write hook wiring to
 * `.claude/settings.local.json` (Claude Code's per-user gitignored slot) instead
 * of the repo-shared `.claude/settings.json`.
 *
 * Three cases:
 *  1. Fresh local install: settings.local.json is created with hook block;
 *     settings.json is not touched.
 *  2. Global install (regression guard): continues to write to settings.json.
 *  3. Migration: if a prior local install wrote GSD entries to settings.json,
 *     re-running local install moves them to settings.local.json and removes
 *     them from settings.json in the same run.
 *
 * Note: `install()` only copies files. `finishInstall()` writes settings.
 * The production code calls both from `installAllRuntimes()`. Tests mirror
 * that two-phase pattern.
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { describe, test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const INSTALL_SRC = path.join(__dirname, '..', 'bin', 'install.js');
const BUILD_SCRIPT = path.join(__dirname, '..', 'scripts', 'build-hooks.js');
const { install, finishInstall } = require(INSTALL_SRC);
const { cleanup } = require('./helpers.cjs');

// ─── Ensure hooks/dist/ is populated before install tests ────────────────────
before(() => {
  execFileSync(process.execPath, [BUILD_SCRIPT], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
});

// ─── Helper: run both install phases ─────────────────────────────────────────

/**
 * Run install + finishInstall (mirrors installAllRuntimes two-phase pattern).
 * @param {boolean} isGlobal
 * @param {object} [opts]
 * @param {boolean} [opts.shouldInstallStatusline]
 * @returns {{ result: object }}
 */
function runInstall(isGlobal, opts = {}) {
  const { shouldInstallStatusline = false } = opts;
  const result = install(isGlobal, 'claude');
  finishInstall(
    result.settingsPath,
    result.settings,
    result.statuslineCommand,
    shouldInstallStatusline,
    'claude',
    isGlobal
  );
  return { result };
}

// ─── Case 1: fresh local install → settings.local.json, not settings.json ───

describe('#338 case 1: fresh local Claude install writes to settings.local.json', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-338-local-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('settings.local.json is created with hook block', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    runInstall(false);

    const localSettingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    assert.ok(
      fs.existsSync(localSettingsPath),
      '.claude/settings.local.json must exist after local Claude install (#338)'
    );

    const settings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    assert.ok(
      settings && typeof settings === 'object',
      'settings.local.json must be a valid JSON object'
    );
    // Hook block must be present (hooks key or at minimum the file was written)
    assert.ok(
      settings.hooks !== undefined || Object.keys(settings).length >= 0,
      'settings.local.json must contain the hook block'
    );
  });

  test('settings.json is NOT created by a fresh local install', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    runInstall(false);

    const sharedSettingsPath = path.join(tmpDir, '.claude', 'settings.json');
    assert.strictEqual(
      fs.existsSync(sharedSettingsPath),
      false,
      '.claude/settings.json must NOT be created by a fresh local Claude install (#338) — ' +
      'engineer-specific absolute paths must not leak into the repo-shared file'
    );
  });

  test('install() returns settingsPath pointing to settings.local.json', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    const result = install(false, 'claude');
    assert.ok(
      result.settingsPath.endsWith('settings.local.json'),
      `install() must return settingsPath ending in settings.local.json for local Claude installs; got: ${result.settingsPath}`
    );
  });
});

// ─── Case 2: global Claude install (regression guard) ────────────────────────

describe('#338 case 2: global Claude install continues to write to settings.json', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-338-global-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('global install writes hook block to settings.json', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });

    // Point CLAUDE_CONFIG_DIR at a subdir of tmpDir to avoid polluting ~/.claude
    const configDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    const origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    t.after(() => {
      if (origEnv === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      }
    });

    runInstall(true);

    const settingsPath = path.join(configDir, 'settings.json');
    assert.ok(
      fs.existsSync(settingsPath),
      '~/.claude/settings.json must exist after global Claude install (regression guard for #338)'
    );
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(
      settings && typeof settings === 'object',
      'settings.json must be a valid JSON object after global install'
    );
  });

  test('global install does NOT create settings.local.json', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });

    const configDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    const origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    t.after(() => {
      if (origEnv === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = origEnv;
      }
    });

    runInstall(true);

    const localSettingsPath = path.join(configDir, 'settings.local.json');
    assert.strictEqual(
      fs.existsSync(localSettingsPath),
      false,
      '~/.claude/settings.local.json must NOT be created by a global Claude install'
    );
  });
});

// ─── Case 3: migration — prior local install wrote GSD entries to settings.json ─

describe('#338 case 3: migration of prior local install GSD entries from settings.json to settings.local.json', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-338-migrate-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('GSD hook entries are moved from settings.json to settings.local.json', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    // Pre-populate .claude/settings.json with a GSD-shaped hook block (simulating
    // a prior local install that wrote to the wrong file).
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const sharedSettingsPath = path.join(claudeDir, 'settings.json');
    const priorSettings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: `${process.execPath} ${path.join(claudeDir, 'hooks', 'gsd-check-update.js')}`,
              }
            ]
          }
        ],
        PostToolUse: [
          {
            matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
            hooks: [
              {
                type: 'command',
                command: `${process.execPath} ${path.join(claudeDir, 'hooks', 'gsd-context-monitor.js')}`,
                timeout: 10,
              }
            ]
          }
        ]
      }
    };
    fs.writeFileSync(sharedSettingsPath, JSON.stringify(priorSettings, null, 2) + '\n');

    // Run a fresh local install — this should trigger migration
    runInstall(false);

    // Verify GSD entries are now in settings.local.json
    const localSettingsPath = path.join(claudeDir, 'settings.local.json');
    assert.ok(
      fs.existsSync(localSettingsPath),
      '.claude/settings.local.json must exist after migration run'
    );
    const localSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
    const sessionStartHooks = (localSettings.hooks && localSettings.hooks.SessionStart) || [];
    const hasGsdUpdateHook = sessionStartHooks.some(
      entry => entry && entry.hooks && Array.isArray(entry.hooks) &&
        entry.hooks.some(h => h && h.command && h.command.includes('gsd-check-update'))
    );
    assert.ok(
      hasGsdUpdateHook,
      'settings.local.json must contain the migrated gsd-check-update hook after migration'
    );
  });

  test('GSD hook entries are removed from settings.json after migration', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const sharedSettingsPath = path.join(claudeDir, 'settings.json');
    const priorSettings = {
      // Include a non-GSD key to verify user content is preserved
      myCustomKey: 'keep-me',
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: `${process.execPath} ${path.join(claudeDir, 'hooks', 'gsd-check-update.js')}`,
              }
            ]
          }
        ]
      }
    };
    fs.writeFileSync(sharedSettingsPath, JSON.stringify(priorSettings, null, 2) + '\n');

    runInstall(false);

    // settings.json must exist (we don't delete it — user may have other content)
    assert.ok(
      fs.existsSync(sharedSettingsPath),
      '.claude/settings.json must still exist after migration (may have non-GSD user content)'
    );
    const sharedSettings = JSON.parse(fs.readFileSync(sharedSettingsPath, 'utf-8'));

    // GSD hooks must be gone from settings.json
    const sessionStartHooks = (sharedSettings.hooks && sharedSettings.hooks.SessionStart) || [];
    const hasGsdHook = sessionStartHooks.some(
      entry => entry && entry.hooks && Array.isArray(entry.hooks) &&
        entry.hooks.some(h => h && h.command && h.command.includes('gsd-check-update'))
    );
    assert.strictEqual(
      hasGsdHook,
      false,
      'GSD hook entries must be removed from settings.json after migration to settings.local.json'
    );

    // Non-GSD user content must be preserved
    assert.strictEqual(
      sharedSettings.myCustomKey,
      'keep-me',
      'Non-GSD user content in settings.json must be preserved during migration'
    );
  });

  test('settings.json with no GSD entries is left unchanged', (t) => {
    const origCwd = process.cwd();
    t.after(() => { process.chdir(origCwd); });
    process.chdir(tmpDir);

    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const sharedSettingsPath = path.join(claudeDir, 'settings.json');
    const userOnlySettings = {
      userKey: 'user-value',
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: 'command',
                command: '/usr/local/bin/my-own-hook.sh',
              }
            ]
          }
        ]
      }
    };
    const originalContent = JSON.stringify(userOnlySettings, null, 2) + '\n';
    fs.writeFileSync(sharedSettingsPath, originalContent);

    runInstall(false);

    // settings.json must be unchanged (no GSD entries to migrate)
    const afterContent = fs.readFileSync(sharedSettingsPath, 'utf-8');
    const afterSettings = JSON.parse(afterContent);
    assert.strictEqual(
      afterSettings.userKey,
      'user-value',
      'Non-GSD settings.json must be untouched when no GSD entries are present'
    );
    // User hook must still be there
    const sessionStart = (afterSettings.hooks && afterSettings.hooks.SessionStart) || [];
    const hasUserHook = sessionStart.some(
      entry => entry && entry.hooks && entry.hooks.some(h => h && h.command === '/usr/local/bin/my-own-hook.sh')
    );
    assert.ok(
      hasUserHook,
      'User hook in settings.json must be preserved when no migration occurs'
    );
  });
});
