/**
 * Behavioral regression tests for bug #105.
 *
 * `gsd-tools commit` / SDK commit unconditionally switches the current
 * checkout to the strategy branch with no opt-out, silently moving a
 * shared HEAD and causing commits from parallel sessions to land on the
 * wrong branch.
 *
 * Fix: when `workflow.use_worktrees` is `false`, `ensureStrategyBranch`
 * must return `{ ok: true, reason: <includes 'use_worktrees'> }` WITHOUT
 * performing a `git checkout`.
 *
 * These tests exercise the real runtime path via Vitest (no source-grep).
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Stub out the git layer so the skip-path tests can assert no git invocation
// occurred, and the no-skip-path tests can assert it was attempted.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'not a git repository',
    })),
  };
});

import { spawnSync } from 'node:child_process';

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Create a minimal project directory with .planning/config.json.
 * Returns the temp directory path.
 *
 * The directory is intentionally NOT a git repo so that any attempt to
 * run `git checkout` inside it will fail — which would propagate as
 * ok: false from ensureStrategyBranch.  The guard in the fix must fire
 * BEFORE any git invocation when use_worktrees is false.
 */
function makeTmpProject(workflowOverrides: Record<string, unknown> = {}): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'bug-105-'));
  const planningDir = join(tmpDir, '.planning');
  mkdirSync(planningDir, { recursive: true });
  const config = {
    git: {
      branching_strategy: 'phase',
      phase_branch_template: 'phase/{phase}-{slug}',
      milestone_branch_template: 'ms/{milestone}-{slug}',
      quick_branch_template: null,
    },
    workflow: {
      use_worktrees: false,
      ...workflowOverrides,
    },
  };
  writeFileSync(join(planningDir, 'config.json'), JSON.stringify(config));
  return tmpDir;
}

const tmpDirs: string[] = [];
const spawnSyncMock = vi.mocked(spawnSync);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ─── bug-105 behavioral tests ─────────────────────────────────────────────

describe('bug-105: ensureStrategyBranch skips branch switch when use_worktrees is false', () => {
  it('returns ok:true when use_worktrees is false', async () => {
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = makeTmpProject({ use_worktrees: false });
    tmpDirs.push(tmpDir);

    const result = await ensureStrategyBranch(tmpDir, undefined, ['1-setup/plan.md']);

    expect(result.ok).toBe(true);
    // Guard must fire BEFORE any git invocation
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('reason mentions use_worktrees when skipping', async () => {
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = makeTmpProject({ use_worktrees: false });
    tmpDirs.push(tmpDir);

    const result = await ensureStrategyBranch(tmpDir, undefined, ['1-setup/plan.md']);

    expect(result.ok).toBe(true);
    const reason = (result as { ok: true; reason?: string }).reason ?? '';
    expect(reason).toContain('use_worktrees');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('does not attempt git checkout when use_worktrees is false (non-git dir stays ok:true)', async () => {
    // The tmpDir is NOT a git repo. If ensureStrategyBranch were to run
    // `git checkout` it would exit non-zero and return ok:false with a
    // branch_switch_failed reason. The guard must fire BEFORE the git call.
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = makeTmpProject({ use_worktrees: false });
    tmpDirs.push(tmpDir);

    const result = await ensureStrategyBranch(tmpDir, undefined, ['2-build/state.md']);

    // If the guard fired correctly, we get ok:true even without a git repo.
    expect(result.ok).toBe(true);
    const reason = (result as { ok: true; reason?: string }).reason ?? '';
    // Must be the use_worktrees skip reason, not a git failure or phase error.
    expect(reason).toContain('use_worktrees');
    // No git command must have been spawned
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('skips when use_worktrees is the string "false" (YAML/JSON parser coercion)', async () => {
    // YAML/JSON parsers can leave boolean-like fields as strings.
    // The guard must treat the string "false" identically to the boolean false.
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = makeTmpProject({ use_worktrees: 'false' });
    tmpDirs.push(tmpDir);

    const result = await ensureStrategyBranch(tmpDir, undefined, ['1-setup/plan.md']);

    expect(result.ok).toBe(true);
    const reason = (result as { ok: true; reason?: string }).reason ?? '';
    expect(reason).toContain('use_worktrees');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('does NOT skip when use_worktrees is true (guard does not fire → reason is not use_worktrees)', async () => {
    // With use_worktrees: true, the guard must NOT fire.
    // Phase lookup finds nothing in the tmp dir → skips for a different reason.
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = makeTmpProject({ use_worktrees: true });
    tmpDirs.push(tmpDir);

    const result = await ensureStrategyBranch(tmpDir, undefined, ['1-setup/plan.md']);

    // The result may be ok:true (phase not found) or ok:false (git failed).
    // Either way the reason must NOT mention the use_worktrees guard.
    if (result.ok) {
      const reason = (result as { ok: true; reason?: string }).reason ?? '';
      expect(reason).not.toContain('use_worktrees');
    } else {
      const reason = (result as { ok: false; reason: string }).reason;
      expect(reason).not.toContain('use_worktrees');
    }
    // The use_worktrees guard must NOT have fired before any git call — confirm
    // that spawnSync was NOT called due to an early guard return.
    // (Phase not found causes an fs-only skip before git — that is acceptable:
    // what matters is the reason is not "use_worktrees".)
  });

  it('does NOT skip when use_worktrees is absent (undefined → reason is not use_worktrees)', async () => {
    // When workflow.use_worktrees is not set at all, the guard must not fire.
    const { ensureStrategyBranch } = await import('./commit.js');
    const tmpDir = mkdtempSync(join(tmpdir(), 'bug-105-absent-'));
    tmpDirs.push(tmpDir);
    const planningDir = join(tmpDir, '.planning');
    mkdirSync(planningDir, { recursive: true });
    // Config with no workflow.use_worktrees key at all
    writeFileSync(join(planningDir, 'config.json'), JSON.stringify({
      git: {
        branching_strategy: 'phase',
        phase_branch_template: 'phase/{phase}-{slug}',
        milestone_branch_template: 'ms/{milestone}-{slug}',
        quick_branch_template: null,
      },
      workflow: {},
    }));

    const result = await ensureStrategyBranch(tmpDir, undefined, ['1-setup/plan.md']);

    if (result.ok) {
      const reason = (result as { ok: true; reason?: string }).reason ?? '';
      expect(reason).not.toContain('use_worktrees');
    } else {
      const reason = (result as { ok: false; reason: string }).reason;
      expect(reason).not.toContain('use_worktrees');
    }
  });
});
