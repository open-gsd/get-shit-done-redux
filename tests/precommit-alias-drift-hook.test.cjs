'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTempDir, cleanup } = require('./helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const HOOK_PATH = path.join(ROOT, '.githooks', 'pre-commit');

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
 * Write a mock executable into binDir.
 *
 * On Windows, `bash` (Git Bash / MSYS2) resolves commands by scanning PATH for
 * files with no extension *before* checking PATHEXT-registered extensions.
 * However, `cmd.exe` and Windows Win32 process creation (used by npm scripts,
 * PowerShell, etc.) resolve via PATHEXT (.COM, .EXE, .BAT, .CMD).  When both
 * are in play — a bash hook script that calls `git` or `npm`, running inside
 * a node `execFileSync('bash', ...)` — we need both resolution paths covered.
 *
 * The canonical pattern used by npm itself is the cmd-shim package:
 * https://github.com/npm/cmd-shim
 * It generates three files per bin: <name> (extensionless bash shim),
 * <name>.cmd (Windows batch), and <name>.ps1 (PowerShell).
 * The same pattern is used for test mocking by stevemao/mock-bin:
 * https://github.com/stevemao/mock-bin (AppVeyor Windows CI green).
 *
 * MSYS2_PATH_TYPE=inherit is insufficient because it is read only in
 * /etc/profile (login-shell path), which `execFileSync('bash', ...)` never
 * sources — bash launched non-interactively without --login skips /etc/profile
 * entirely:
 * https://github.com/msys2/MSYS2-packages/blob/master/filesystem/profile
 *
 * The reliable fix is to write all three shim files so that regardless of
 * which resolution mechanism fires, it finds and runs the mock body.
 */
function writeMockBin(binDir, name, bashBody) {
  // 1. Extensionless bash script — bash's own PATH scan picks this up.
  writeExec(path.join(binDir, name), bashBody);

  if (process.platform === 'win32') {
    // 2. .cmd batch wrapper — cmd.exe / PATHEXT resolution and Win32 spawn.
    //    Uses bash to delegate to the extensionless script body so the mock
    //    logic is kept in one place.
    //    cmd-shim pattern: https://github.com/npm/cmd-shim
    fs.writeFileSync(
      path.join(binDir, `${name}.cmd`),
      `@SETLOCAL\r\n@bash "%~dp0${name}" %*\r\n`,
      { encoding: 'utf-8' },
    );
    // 3. .ps1 wrapper — PowerShell PATH resolution (less common in CI but
    //    included for completeness, matching the full cmd-shim surface).
    fs.writeFileSync(
      path.join(binDir, `${name}.ps1`),
      `#!/usr/bin/env pwsh\n& bash "$PSScriptRoot/${name}" $args\n`,
      { encoding: 'utf-8' },
    );
  }
}

describe('.githooks/pre-commit alias drift guard', () => {
  test('runs npm check when staged files include command-manifest/alias artifacts', (t) => {
    const tmpDir = createTempDir('gsd-precommit-hook-');
    t.after(() => cleanup(tmpDir));

    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    writeMockBin(binDir, 'git', `#!/usr/bin/env bash\nprintf "%s\\n" "${'sdk/src/query/command-manifest.phase.ts'}"\n`);
    writeMockBin(binDir, 'npm', `#!/usr/bin/env bash\nprintf "called" > "$GSD_TEST_NPM_MARKER"\n`);

    const marker = path.join(tmpDir, 'npm-called.txt');

    execFileSync('bash', [HOOK_PATH], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        GSD_TEST_NPM_MARKER: marker,
      },
      stdio: 'pipe',
    });

    assert.ok(fs.existsSync(marker), 'expected npm run check:alias-drift to be invoked');
  });

  test('does not run npm check when staged files are unrelated', (t) => {
    const tmpDir = createTempDir('gsd-precommit-hook-');
    t.after(() => cleanup(tmpDir));

    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    writeMockBin(binDir, 'git', `#!/usr/bin/env bash\nprintf "%s\\n" "README.md"\n`);
    writeMockBin(binDir, 'npm', `#!/usr/bin/env bash\nprintf "called" > "$GSD_TEST_NPM_MARKER"\n`);

    const marker = path.join(tmpDir, 'npm-called.txt');

    execFileSync('bash', [HOOK_PATH], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        GSD_TEST_NPM_MARKER: marker,
      },
      stdio: 'pipe',
    });

    assert.ok(!fs.existsSync(marker), 'expected npm check to be skipped for unrelated staged files');
  });
});
