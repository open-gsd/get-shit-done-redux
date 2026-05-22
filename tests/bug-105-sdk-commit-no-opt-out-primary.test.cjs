'use strict';

/**
 * Regression test for bug #105
 *
 * `gsd-tools commit` / SDK commit unconditionally switches the current
 * checkout to the strategy branch with no opt-out, silently moving a shared
 * HEAD and allowing concurrent commits to land on the wrong branch.
 *
 * Repro: a working tree where `workflow.use_worktrees: false` and the primary
 * is pinned to a base branch; `ensureStrategyBranch` must NOT switch HEAD.
 *
 * Expected: when `workflow.use_worktrees` is false (shared/pinned primary),
 * `ensureStrategyBranch` skips the branch switch and returns ok: true with a
 * skip reason rather than calling `git checkout`.
 *
 * Acceptance: test covering `use_worktrees: false` primary — commit completes
 * without switching HEAD away from the original branch.  No regression on
 * worktree-enabled paths.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const COMMIT_TS = path.join(__dirname, '..', 'sdk', 'src', 'query', 'commit.ts');
const source = fs.readFileSync(COMMIT_TS, 'utf-8');

// ─── ts-node availability check ─────────────────────────────────────────────

let helpersAvailable = false;
try {
  const tsNodeBin = path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node');
  const sdkDir = path.join(__dirname, '..', 'sdk');
  const smokeScript = `
    const { ensureStrategyBranch } =
      require(${JSON.stringify(COMMIT_TS.replace(/\\/g, '/'))});
    process.stdout.write(JSON.stringify({ ok: true }));
  `;
  execFileSync(tsNodeBin, ['--skip-project', '--transpile-only', '-e', smokeScript], {
    cwd: sdkDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  });
  helpersAvailable = true;
} catch {
  helpersAvailable = false;
}

// ─── Behavioral: ensureStrategyBranch skips switch on use_worktrees=false ───
//
// We exercise the real ensureStrategyBranch function via ts-node with a
// controlled .planning/config.json that has:
//   git.branching_strategy: 'phase'
//   workflow.use_worktrees: false
//
// The function must return { ok: true, reason: <contains 'use_worktrees'> }
// without attempting a git checkout, because the primary checkout is shared.

describe('bug-105: ensureStrategyBranch skips switch on use_worktrees=false',
  { skip: !helpersAvailable ? 'ts-node not available' : false },
  () => {
    const tsNodeBin = path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node');
    const sdkDir = path.join(__dirname, '..', 'sdk');
    const os = require('node:os');

    /**
     * Run ensureStrategyBranch(projectDir, undefined, filePaths) via ts-node.
     * Returns the parsed JSON result.
     */
    function runEnsureStrategyBranch(projectDir, filePaths) {
      const script = `
        require('ts-node').register({
          transpileOnly: true,
          skipProject: true,
          compilerOptions: { module: 'commonjs', esModuleInterop: true, resolveJsonModule: true },
        });
        const { ensureStrategyBranch } = require(${JSON.stringify(COMMIT_TS)});
        ensureStrategyBranch(
          ${JSON.stringify(projectDir)},
          undefined,
          ${JSON.stringify(filePaths)}
        ).then(result => {
          process.stdout.write(JSON.stringify(result));
        }).catch(err => {
          process.stdout.write(JSON.stringify({ ok: false, reason: String(err) }));
        });
      `;
      const out = execFileSync(tsNodeBin, ['--skip-project', '-e', script], {
        cwd: sdkDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
      });
      return JSON.parse(out.toString());
    }

    /**
     * Create a minimal fake project dir with .planning/config.json.
     * Returns the temp dir path.
     */
    function makeTmpProject(configOverrides) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-105-'));
      const planningDir = path.join(tmpDir, '.planning');
      fs.mkdirSync(planningDir, { recursive: true });
      const config = {
        git: {
          branching_strategy: 'phase',
          phase_branch_template: 'phase/{phase}-{slug}',
          milestone_branch_template: 'ms/{milestone}-{slug}',
          quick_branch_template: null,
        },
        workflow: {
          use_worktrees: false,
        },
        ...configOverrides,
      };
      fs.writeFileSync(path.join(planningDir, 'config.json'), JSON.stringify(config));
      return tmpDir;
    }

    test('returns ok:true and skips branch switch when use_worktrees is false', () => {
      const tmpDir = makeTmpProject({});
      try {
        const result = runEnsureStrategyBranch(tmpDir, ['1-setup/plan.md']);
        assert.ok(result.ok, `expected ok: true, got: ${JSON.stringify(result)}`);
        assert.ok(
          typeof result.reason === 'string' && result.reason.includes('use_worktrees'),
          `expected reason to mention 'use_worktrees', got: ${JSON.stringify(result.reason)}`,
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('does NOT call git checkout when use_worktrees is false (no git repo needed)', () => {
      // The tmpDir is not a git repo — if ensureStrategyBranch tried to call
      // `git checkout` it would fail with exitCode !== 0 and potentially return
      // ok: false.  With the fix, the guard fires before the git call.
      const tmpDir = makeTmpProject({});
      try {
        const result = runEnsureStrategyBranch(tmpDir, ['2-build/state.md']);
        // If git checkout had been attempted in a non-git dir, it would likely
        // return ok: false (branch_switch_failed). Guard must fire first.
        assert.ok(result.ok, `expected ok: true without git checkout, got: ${JSON.stringify(result)}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('still switches branch when use_worktrees is true (or absent)', () => {
      // With use_worktrees: true, the guard must NOT fire.
      // We expect it to attempt (and fail in a non-git dir) the checkout.
      const tmpDir = makeTmpProject({ workflow: { use_worktrees: true } });
      try {
        const result = runEnsureStrategyBranch(tmpDir, ['1-setup/plan.md']);
        // In a non-git dir the checkout attempt returns an error reason, NOT
        // the use_worktrees skip reason.
        if (!result.ok) {
          // Fine — it attempted the checkout and failed (expected in non-git dir)
          assert.ok(
            !String(result.reason ?? '').includes('use_worktrees'),
            `when use_worktrees:true the skip guard must NOT fire; got reason: ${result.reason}`,
          );
        } else if (result.reason) {
          // ok: true but with a reason — must NOT be the use_worktrees skip
          assert.ok(
            !result.reason.includes('use_worktrees'),
            `when use_worktrees:true the skip guard must NOT fire; got reason: ${result.reason}`,
          );
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  },
);

// ─── Structural: source must guard on use_worktrees ─────────────────────────

describe('structural: ensureStrategyBranch guards on use_worktrees (bug-105)', () => {
  test('ensureStrategyBranch reads workflow.use_worktrees from config', () => {
    assert.ok(
      source.includes('use_worktrees'),
      'ensureStrategyBranch must check workflow.use_worktrees before attempting branch switch (#105)',
    );
  });

  test('ensureStrategyBranch skips when use_worktrees is false', () => {
    // The guard must check use_worktrees and return early.
    // Acceptable forms: `use_worktrees === false`, `!use_worktrees`, or
    // `use_worktrees !== true` etc.
    const hasExplicitFalseCheck = source.includes('use_worktrees === false') ||
      source.includes('use_worktrees !== true') ||
      source.includes('!use_worktrees') ||
      (source.includes('use_worktrees') && source.includes("'use_worktrees'")) ||
      // Also accept: a pattern where use_worktrees is checked and a skip
      // reason containing 'use_worktrees' is returned
      (source.includes('use_worktrees') && source.includes('strategy-skipped'));
    assert.ok(
      hasExplicitFalseCheck,
      'ensureStrategyBranch must contain a guard that skips branch switch when use_worktrees is false (#105)',
    );
  });
});
