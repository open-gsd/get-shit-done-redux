// allow-test-rule: source-text-is-the-product see #4455
// Workflow .md files — their text IS what the runtime loads. Testing text
// content (as extracted, executed bash fences) tests the deployed contract.
// Per CONTRIBUTING.md exception matrix.

/**
 * GSD Tools Tests - autonomous.md and complete-milestone.md workstream-scoped
 * STATE/ROADMAP/archive paths (#4455)
 *
 * Both workflows used to read/write hardcoded literal `.planning/STATE.md` /
 * `.planning/ROADMAP.md` / `.planning/milestones/...` paths in their shell
 * fences — bypassing workstream scoping entirely. When GSD_WORKSTREAM is set,
 * `init.manager`/`init.complete-milestone` resolve `state_path`/`roadmap_path`/
 * `archive_dir` into the workstream, but the literal reads/writes still hit
 * root `.planning/` (or silently returned empty).
 *
 * These tests extract the real bash fences from the workflow files and
 * execute them (with a stubbed `gsd_run`) rather than string-matching the
 * markdown — the same idiom tests/new-milestone-clear-phases.test.cjs uses.
 *
 * One file (not two) per scripts/lint-test-file-count.cjs's per-module cap —
 * tests/workstream.test.cjs already owns the "workstream" module name, so
 * this is the second and last slot; the two workflows are kept apart via
 * top-level describe blocks instead of separate files.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runHook: runHookSeam } = require('./helpers/process-seam.cjs');
const { throwIfFailed } = require('./helpers/git-fixture.cjs');
const { scanFencedBlocks } = require('../gsd-core/bin/lib/markdown-sectionizer.cjs');
const { cleanup } = require('./helpers.cjs');

/** Return the raw text of every ```bash fenced block in `text`. */
function extractBashBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (const block of scanFencedBlocks(lines)) {
    if (block.closeLineIdx === -1) continue;
    if ((block.infoString || '').trim() !== 'bash') continue;
    blocks.push(lines.slice(block.openLineIdx + 1, block.closeLineIdx).join('\n'));
  }
  return blocks;
}

// Locate the first ```bash fence strictly between two boundary strings.
function extractFenceBetween(markdown, startMarker, endMarker) {
  const startIdx = markdown.indexOf(startMarker);
  const endIdx = markdown.indexOf(endMarker);
  assert.ok(startIdx !== -1, `marker not found: ${startMarker}`);
  assert.ok(endIdx !== -1, `marker not found: ${endMarker}`);
  assert.ok(startIdx < endIdx, `${startMarker} must precede ${endMarker}`);
  const section = markdown.slice(startIdx, endIdx);
  const bashBlocks = extractBashBlocks(section);
  assert.ok(bashBlocks.length > 0, `no bash fence found between "${startMarker}" and "${endMarker}"`);
  return bashBlocks[0];
}

// Locate the ```bash fence containing `marker`, between two boundary strings.
function extractFenceContaining(markdown, startMarker, endMarker, marker) {
  const startIdx = markdown.indexOf(startMarker);
  const endIdx = markdown.indexOf(endMarker);
  assert.ok(startIdx !== -1 && endIdx !== -1 && startIdx < endIdx, 'boundary markers not found in order');
  const section = markdown.slice(startIdx, endIdx);
  for (const block of extractBashBlocks(section)) {
    if (block.includes(marker)) return block;
  }
  assert.fail(`no bash fence containing "${marker}" found between "${startMarker}" and "${endMarker}"`);
  return null;
}

describe('autonomous.md workstream-scoped paths (#4455)', () => {
  const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'autonomous.md');
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  const discoverPhasesFence = extractFenceBetween(content, '## 2. Discover Phases', '## 3. Execute Phase');
  const iterateFence = extractFenceBetween(content, '## 4. Iterate', '## 5. Lifecycle');
  const lifecycle5bFence = extractFenceContaining(content, '## 5. Lifecycle', '## 6. Handle Blocker', 'ARCHIVE_DIR');

  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-autonomous-ws-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  /**
   * Write a canned init.manager-shaped JSON payload and a gsd_run stub that
   * returns it verbatim. Each call also appends one byte to a call-log file
   * — NOT a shell variable increment, because `INIT_MANAGER=$(gsd_run ...)`
   * runs gsd_run inside the command-substitution SUBSHELL, so a variable
   * mutated there never survives back into the caller's shell.
   */
  function stubGsdRun(jsonPayload) {
    const jsonPath = path.join(tmpDir, 'init-manager.json');
    const callLogPath = path.join(tmpDir, 'gsd-run-calls.log');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload));
    fs.writeFileSync(callLogPath, '');
    return `gsd_run() { printf 'x' >> "${callLogPath}"; cat "${jsonPath}"; }\n`;
  }

  /** Number of gsd_run invocations recorded by the most recent stubGsdRun-backed script. */
  function gsdRunCallCount() {
    return fs.readFileSync(path.join(tmpDir, 'gsd-run-calls.log'), 'utf8').length;
  }

  describe('discover_phases step: reads STATE.md from init.manager state_path, not a hardcoded literal', () => {
    test('flat mode: no GSD_WORKSTREAM — resolves the root STATE.md path (regression guard)', () => {
      const statePath = path.join(tmpDir, 'STATE-root.md');
      fs.writeFileSync(statePath, '# Root State\n');
      const script = `${stubGsdRun({ state_path: statePath })}${discoverPhasesFence}\nprintf 'STATE_CONTENT=[%s]\\n' "$STATE_CONTENT"`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <discover_phases fence>');
      assert.ok(r.stdout.includes('STATE_CONTENT=[# Root State'),
        `expected root STATE.md content, got: ${r.stdout}`);
    });

    test('GSD_WORKSTREAM=alpha: reads the workstream-scoped STATE.md, not the root one (#4455 regression)', () => {
      const rootStatePath = path.join(tmpDir, 'STATE-root.md');
      fs.writeFileSync(rootStatePath, '# Root State — must not be read\n');
      const wsStatePath = path.join(tmpDir, 'STATE-alpha.md');
      fs.writeFileSync(wsStatePath, '# Workstream Alpha State\n');

      const script = `${stubGsdRun({ state_path: wsStatePath })}${discoverPhasesFence}\nprintf 'STATE_CONTENT=[%s]\\n' "$STATE_CONTENT"`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <discover_phases fence>');
      assert.ok(r.stdout.includes('STATE_CONTENT=[# Workstream Alpha State'),
        `expected workstream STATE.md content, got: ${r.stdout}`);
      assert.ok(!r.stdout.includes('Root State'),
        `must not have read the root STATE.md, got: ${r.stdout}`);
    });
  });

  describe('iterate step: single init.manager fetch backs both the re-filter and the fresh re-read', () => {
    test('flat mode: resolves the root STATE.md path (regression guard)', () => {
      const statePath = path.join(tmpDir, 'STATE-root.md');
      fs.writeFileSync(statePath, '# Root State\n');
      const script = `${stubGsdRun({ state_path: statePath })}${iterateFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <iterate fence>');
      // The fence's own `cat "$STATE_PATH"` line prints the raw re-read to stdout.
      assert.ok(r.stdout.includes('# Root State'), `expected root STATE.md content, got: ${r.stdout}`);
    });

    test('GSD_WORKSTREAM=alpha: re-reads the workstream STATE.md, not root (#4455 regression)', () => {
      const rootStatePath = path.join(tmpDir, 'STATE-root.md');
      fs.writeFileSync(rootStatePath, '# Root State — must not be read\n');
      const wsStatePath = path.join(tmpDir, 'STATE-alpha.md');
      fs.writeFileSync(wsStatePath, '# Workstream Alpha State\n');

      const script = `${stubGsdRun({ state_path: wsStatePath })}${iterateFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <iterate fence>');
      assert.ok(r.stdout.includes('# Workstream Alpha State'),
        `expected workstream STATE.md content, got: ${r.stdout}`);
      assert.ok(!r.stdout.includes('Root State'),
        `must not have read the root STATE.md, got: ${r.stdout}`);
    });

    test('does not double-fetch init.manager within the iterate fence (no-double-fetch requirement)', () => {
      const statePath = path.join(tmpDir, 'STATE-root.md');
      fs.writeFileSync(statePath, '# Root State\n');
      const script = `${stubGsdRun({ state_path: statePath })}${iterateFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <iterate fence>');
      assert.strictEqual(gsdRunCallCount(), 1,
        `iterate fence must call gsd_run exactly once (no double-fetch), got ${gsdRunCallCount()}; stdout: ${r.stdout}`);
    });
  });

  describe('lifecycle step 5b: archive existence check uses init.manager archive_dir, not a hardcoded literal', () => {
    test('flat mode: checks the root milestones/ archive dir (regression guard)', () => {
      const archiveDir = path.join(tmpDir, 'milestones-root');
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(path.join(archiveDir, 'v1.0-ROADMAP.md'), '# Archived Roadmap\n');

      const script = `milestone_version="1.0"\n${stubGsdRun({ archive_dir: archiveDir })}${lifecycle5bFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <lifecycle 5b fence>');
      assert.ok(r.stdout.includes(path.join(archiveDir, 'v1.0-ROADMAP.md')),
        `expected ls to find the root archive file, got: ${r.stdout}`);
    });

    test('GSD_WORKSTREAM=alpha: checks the workstream-scoped archive dir, not root (#4455 regression)', () => {
      const rootArchiveDir = path.join(tmpDir, 'milestones-root');
      fs.mkdirSync(rootArchiveDir, { recursive: true });
      fs.writeFileSync(path.join(rootArchiveDir, 'v1.0-ROADMAP.md'), '# Root Archived Roadmap — must not be found\n');

      const wsArchiveDir = path.join(tmpDir, 'milestones-alpha');
      fs.mkdirSync(wsArchiveDir, { recursive: true });
      fs.writeFileSync(path.join(wsArchiveDir, 'v1.0-ROADMAP.md'), '# Workstream Archived Roadmap\n');

      const script = `milestone_version="1.0"\n${stubGsdRun({ archive_dir: wsArchiveDir })}${lifecycle5bFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <lifecycle 5b fence>');
      assert.ok(r.stdout.includes(path.join(wsArchiveDir, 'v1.0-ROADMAP.md')),
        `expected ls to find the workstream archive file, got: ${r.stdout}`);
      assert.ok(!r.stdout.includes(rootArchiveDir),
        `must not have checked the root archive dir, got: ${r.stdout}`);
    });
  });
});

describe('complete-milestone.md workstream-scoped paths (#4455)', () => {
  const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'complete-milestone.md');
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  const STEP_START = '<step name="reorganize_roadmap_and_delete_originals">';
  const STEP_END = '<step name="write_retrospective">';

  const backlogFence = extractFenceContaining(content, STEP_START, STEP_END, 'BACKLOG_SECTION');
  const sentinelFence = extractFenceContaining(content, STEP_START, STEP_END, '.gsd-allow-shrink');
  const commitFilesFence = extractFenceContaining(content, STEP_START, STEP_END, 'gsd_run query commit');
  const requirementsRmFence = extractFenceContaining(content, STEP_START, STEP_END, 'git rm');

  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-complete-milestone-ws-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  /**
   * Write a canned init.complete-milestone-shaped JSON payload and a gsd_run
   * stub that returns it for the `query init.complete-milestone` fetch, and
   * echoes `gsd_run_call:<argv>` for every OTHER call (e.g. `query commit
   * ...`) — the same recording-stub idiom tests/new-milestone-clear-phases.
   * test.cjs uses, so the commit `--files` list can be asserted on directly.
   */
  function stubGsdRun(jsonPayload) {
    const jsonPath = path.join(tmpDir, 'init-cm.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload));
    return `gsd_run() { if [ "$1" = "query" ] && [ "$2" = "init.complete-milestone" ]; then cat "${jsonPath}"; else printf 'gsd_run_call:%s\\n' "$*"; fi; }\n`;
  }

  describe('backlog extraction: reads ROADMAP.md from init.complete-milestone roadmap_path', () => {
    test('flat mode: no GSD_WORKSTREAM — resolves the root ROADMAP.md path (regression guard)', () => {
      const roadmapPath = path.join(tmpDir, 'ROADMAP-root.md');
      fs.writeFileSync(roadmapPath, '# Roadmap\n\n## Backlog\n\n- 999.1 Root backlog item\n');
      const script = `${stubGsdRun({ roadmap_path: roadmapPath })}${backlogFence}\nprintf 'BACKLOG=[%s]\\n' "$BACKLOG_SECTION"`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <backlog fence>');
      assert.ok(r.stdout.includes('Root backlog item'),
        `expected root ROADMAP.md backlog content, got: ${r.stdout}`);
    });

    test('GSD_WORKSTREAM=alpha: reads the workstream-scoped ROADMAP.md, not root (#4455 regression)', () => {
      const rootRoadmapPath = path.join(tmpDir, 'ROADMAP-root.md');
      fs.writeFileSync(rootRoadmapPath, '# Roadmap\n\n## Backlog\n\n- 999.1 Root backlog item — must not be read\n');
      const wsRoadmapPath = path.join(tmpDir, 'ROADMAP-alpha.md');
      fs.writeFileSync(wsRoadmapPath, '# Roadmap\n\n## Backlog\n\n- 999.1 Workstream Alpha backlog item\n');

      const script = `${stubGsdRun({ roadmap_path: wsRoadmapPath })}${backlogFence}\nprintf 'BACKLOG=[%s]\\n' "$BACKLOG_SECTION"`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <backlog fence>');
      assert.ok(r.stdout.includes('Workstream Alpha backlog item'),
        `expected workstream ROADMAP.md backlog content, got: ${r.stdout}`);
      assert.ok(!r.stdout.includes('Root backlog item'),
        `must not have read the root ROADMAP.md, got: ${r.stdout}`);
    });
  });

  describe('write-guard sentinel: arms with init.complete-milestone roadmap_path', () => {
    test('flat mode: sentinel names the root ROADMAP.md path (regression guard)', () => {
      const roadmapPath = path.join(tmpDir, 'ROADMAP-root.md');
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      const script = `${stubGsdRun({ roadmap_path: roadmapPath })}${sentinelFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <sentinel fence>');
      const sentinelContent = fs.readFileSync(path.join(tmpDir, '.planning', '.gsd-allow-shrink'), 'utf8').trim();
      assert.strictEqual(sentinelContent, roadmapPath);
    });

    test('GSD_WORKSTREAM=alpha: sentinel names the workstream ROADMAP.md, not root (#4455 regression)', () => {
      const wsRoadmapPath = path.join(tmpDir, 'ROADMAP-alpha.md');
      fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
      const script = `${stubGsdRun({ roadmap_path: wsRoadmapPath })}${sentinelFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <sentinel fence>');
      const sentinelContent = fs.readFileSync(path.join(tmpDir, '.planning', '.gsd-allow-shrink'), 'utf8').trim();
      assert.strictEqual(sentinelContent, wsRoadmapPath);
      assert.notStrictEqual(sentinelContent, path.join(tmpDir, '.planning', 'ROADMAP.md'));
    });
  });

  describe('safety commit --files list: STATE/ROADMAP/archive/MILESTONES/PROJECT paths all scoped together', () => {
    function runCommitFence(cmJson) {
      const script = `${stubGsdRun(cmJson)}${commitFilesFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <commit --files fence>');
      return r.stdout;
    }

    test('flat mode: --files lists root STATE/ROADMAP/archive/MILESTONES/PROJECT paths (regression guard)', () => {
      const statePath = path.join(tmpDir, 'STATE-root.md');
      const roadmapPath = path.join(tmpDir, 'ROADMAP-root.md');
      const archiveDir = path.join(tmpDir, 'milestones-root');
      const milestonesPath = path.join(tmpDir, 'MILESTONES-root.md');
      const projectPath = path.join(tmpDir, 'PROJECT-root.md');
      const out = runCommitFence({
        state_path: statePath, roadmap_path: roadmapPath, archive_dir: archiveDir,
        milestones_path: milestonesPath, project_path: projectPath,
      });

      assert.ok(out.includes('gsd_run_call:query commit'), `expected the commit call to be recorded, got: ${out}`);
      assert.ok(out.includes(statePath), `expected root STATE.md in --files, got: ${out}`);
      assert.ok(out.includes(roadmapPath), `expected root ROADMAP.md in --files, got: ${out}`);
      assert.ok(out.includes(`${archiveDir}/v[X.Y]-ROADMAP.md`), `expected root archive ROADMAP in --files, got: ${out}`);
      assert.ok(out.includes(milestonesPath), `expected root MILESTONES.md in --files, got: ${out}`);
      assert.ok(out.includes(projectPath), `expected root PROJECT.md in --files, got: ${out}`);
    });

    test('GSD_WORKSTREAM=alpha: --files lists workstream-scoped STATE/ROADMAP/archive/MILESTONES/PROJECT paths, not root (#4455 regression)', () => {
      const wsStatePath = path.join(tmpDir, 'STATE-alpha.md');
      const wsRoadmapPath = path.join(tmpDir, 'ROADMAP-alpha.md');
      const wsArchiveDir = path.join(tmpDir, 'milestones-alpha');
      const wsMilestonesPath = path.join(tmpDir, 'MILESTONES-alpha.md');
      const wsProjectPath = path.join(tmpDir, 'PROJECT-alpha.md');
      const out = runCommitFence({
        state_path: wsStatePath, roadmap_path: wsRoadmapPath, archive_dir: wsArchiveDir,
        milestones_path: wsMilestonesPath, project_path: wsProjectPath,
      });

      assert.ok(out.includes(wsStatePath), `expected workstream STATE.md in --files, got: ${out}`);
      assert.ok(out.includes(wsRoadmapPath), `expected workstream ROADMAP.md in --files, got: ${out}`);
      assert.ok(out.includes(`${wsArchiveDir}/v[X.Y]-ROADMAP.md`), `expected workstream archive ROADMAP in --files, got: ${out}`);
      // MILESTONES.md and PROJECT.md are workstream-scoped too — cmdMilestoneComplete
      // (src/milestone.cts) writes MILESTONES.md via planningPaths(cwd).planning (the
      // workstream base), and PROJECT.md resolves the same way (planningPaths().project).
      // An earlier version of this fix wrongly pinned both as shared root files, which
      // would have made this safety commit silently miss the actual files
      // `milestone complete` just wrote under an active workstream (#4455 follow-up,
      // caught by isolated code review).
      assert.ok(out.includes(wsMilestonesPath), `expected workstream MILESTONES.md in --files, got: ${out}`);
      assert.ok(out.includes(wsProjectPath), `expected workstream PROJECT.md in --files, got: ${out}`);
      assert.ok(!out.includes(path.join(tmpDir, '.planning', 'STATE.md')),
        `must not fall back to the flat root STATE.md path, got: ${out}`);
      assert.ok(!out.includes(path.join(tmpDir, '.planning', 'ROADMAP.md')),
        `must not fall back to the flat root ROADMAP.md path, got: ${out}`);
      assert.ok(!out.includes(path.join(tmpDir, '.planning', 'MILESTONES.md')),
        `must not fall back to the flat root MILESTONES.md path, got: ${out}`);
      assert.ok(!out.includes(path.join(tmpDir, '.planning', 'PROJECT.md')),
        `must not fall back to the flat root PROJECT.md path, got: ${out}`);
    });
  });

  describe('REQUIREMENTS.md removal: git rm uses init.complete-milestone requirements_path, not a hardcoded literal', () => {
    test('flat mode: removes the root REQUIREMENTS.md path (regression guard)', () => {
      const requirementsPath = path.join(tmpDir, 'REQUIREMENTS-root.md');
      fs.writeFileSync(requirementsPath, '# Requirements\n');
      fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true }); // git rm needs a repo; the stub below intercepts it
      const script = `git() { printf 'git_call:%s\\n' "$*"; }\n${stubGsdRun({ requirements_path: requirementsPath })}${requirementsRmFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <requirements rm fence>');
      assert.ok(r.stdout.includes(`git_call:rm ${requirementsPath}`),
        `expected git rm to target the root REQUIREMENTS.md, got: ${r.stdout}`);
    });

    test('GSD_WORKSTREAM=alpha: removes the workstream-scoped REQUIREMENTS.md, not root (#4455 follow-up regression)', () => {
      const wsRequirementsPath = path.join(tmpDir, 'REQUIREMENTS-alpha.md');
      fs.writeFileSync(wsRequirementsPath, '# Requirements\n');
      const script = `git() { printf 'git_call:%s\\n' "$*"; }\n${stubGsdRun({ requirements_path: wsRequirementsPath })}${requirementsRmFence}`;
      const r = runHookSeam('-c', [script], { interpreter: 'bash', cwd: tmpDir });
      throwIfFailed(r, 'bash <requirements rm fence>');
      assert.ok(r.stdout.includes(`git_call:rm ${wsRequirementsPath}`),
        `expected git rm to target the workstream REQUIREMENTS.md, got: ${r.stdout}`);
      assert.ok(!r.stdout.includes('git_call:rm .planning/REQUIREMENTS.md'),
        `must not have targeted the literal root REQUIREMENTS.md path, got: ${r.stdout}`);
    });
  });
});
