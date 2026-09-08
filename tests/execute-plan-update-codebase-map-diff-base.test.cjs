// allow-test-rule: source-text-is-the-product
// Workflow markdown is the installed orchestration contract — this file's
// text IS what the executor runs at runtime.

'use strict';

/**
 * Regression coverage for #4459: execute-plan.md's `update_codebase_map`
 * step used a commit-subject `--grep` with no milestone bound to find the
 * diff base for the codebase-map update. A phase NUMBER is unique within a
 * MILESTONE, not a repository — on a project that reuses a phase number
 * across milestones, the old `--reverse | head -1` deliberately picked the
 * OLDEST matching commit subject, dragging the previous milestone's
 * same-numbered phase's files into the diff.
 *
 * The fix (matching the already-established anchor in code-review.md's
 * structural-pre-pass step, #3995) anchors on the phase's own DIRECTORY
 * instead: the parent of the first commit that added anything under it.
 *
 * This test extracts the step's real bash fence from the workflow file and
 * runs it against a constructed git fixture that reproduces the issue's
 * exact scenario — two milestones, phase number reused with a different
 * slug (the realistic case; same-number-same-slug reuse is a documented
 * residual limitation shared with code-review.md's own anchor) — so a
 * regression in the fix is caught by real git behavior, not just text
 * matching.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitOrThrow } = require('./helpers/git-fixture.cjs');
const { GIT_FIXTURE_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'execute-plan.md');

function extractNamedBlock(markdown, blockName) {
  const openStep = `<step name="${blockName}">`;
  const start = markdown.indexOf(openStep);
  assert.ok(start !== -1, `execute-plan.md must contain a <step name="${blockName}"> block`);
  const end = markdown.indexOf('</step>', start + openStep.length);
  assert.ok(end !== -1, `<step name="${blockName}"> must be closed with </step>`);
  return markdown.slice(start + openStep.length, end);
}

function extractFirstBashBlock(block) {
  const lines = block.split('\n');
  let inFence = false;
  const buffer = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```bash')) {
      inFence = true;
      continue;
    }
    if (inFence && trimmed.startsWith('```')) break;
    if (inFence) buffer.push(line);
  }
  assert.ok(buffer.length > 0, 'update_codebase_map must contain a ```bash fence');
  return buffer.join('\n');
}

function seedFixtureRepo(dir) {
  gitOrThrow(['init', '-q'], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
  gitOrThrow(['config', 'user.email', 't@example.com'], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
  gitOrThrow(['config', 'user.name', 'T'], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
  gitOrThrow(['config', 'commit.gpgsign', 'false'], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
}

function writeAndCommit(dir, relPath, content, message) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  gitOrThrow(['add', '-A'], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
  gitOrThrow(['commit', '-q', '-m', message], { cwd: dir, timeoutMs: GIT_FIXTURE_TIMEOUT_MS });
}

describe('#4459: update_codebase_map diff base is anchored to the phase directory, not an unbounded commit-subject grep', () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const stepBlock = extractNamedBlock(workflowContent, 'update_codebase_map');
  const bashFence = extractFirstBashBlock(stepBlock);

  test('the old unbounded commit-subject grep is gone', () => {
    assert.ok(
      !bashFence.includes('--grep="feat({phase}-{plan}):"'),
      'update_codebase_map must no longer derive its diff base from an unbounded --grep',
    );
  });

  test('the new fence anchors on the phase directory via --diff-filter=A, matching code-review.md\'s #3995 pattern', () => {
    assert.ok(
      bashFence.includes('--diff-filter=A') && bashFence.includes('.planning/phases/'),
      'update_codebase_map must derive PHASE_START from the first commit that added the phase directory',
    );
  });

  test('real execution: milestone-2 reusing phase 03 scopes the diff to milestone-2\'s own files, not milestone-1\'s (issue #4459 repro)', () => {
    const tmpDir = fs.realpathSync(createTempDir('gsd-4459-'));
    try {
      seedFixtureRepo(tmpDir);
      writeAndCommit(tmpDir, 'README.md', '# init\n', 'chore: init');

      // Milestone 1, phase 03 (slug "alpha") — this occupant must NOT leak
      // into milestone 2's diff.
      writeAndCommit(tmpDir, '.planning/phases/03-alpha/03-01-PLAN.md', '# plan\n', 'feat(03-01): milestone-1 phase 3 first task');
      writeAndCommit(tmpDir, 'm1/alpha.js', 'm1 alpha\n', 'feat(03-01): milestone-1 phase 3 work');
      writeAndCommit(tmpDir, 'm1/beta.js', 'm1 beta\n', 'test(03-01): milestone-1 phase 3 tests');

      // Unrelated intervening work (a later phase in milestone 1).
      for (let i = 1; i <= 3; i++) {
        writeAndCommit(tmpDir, `src/f${i}.js`, `f${i}\n`, `feat(07-0${i}): unrelated later work ${i}`);
      }

      // Milestone 2 reuses phase NUMBER 03 with a DIFFERENT slug ("beta") —
      // the realistic reuse case (same-number-same-slug is code-review.md's
      // own documented residual, not this fix's regression target).
      writeAndCommit(tmpDir, '.planning/phases/03-beta/03-01-PLAN.md', '# plan\n', 'feat(03-01): milestone-2 phase 3 first task');
      writeAndCommit(tmpDir, 'm2/gamma.js', 'm2 gamma\n', 'feat(03-01): milestone-2 phase 3 work');
      writeAndCommit(tmpDir, 'm2/delta.js', 'm2 delta\n', 'test(03-01): milestone-2 phase 3 tests');

      const substituted = bashFence.replace('.planning/phases/XX-name', '.planning/phases/03-beta');
      const scriptPath = path.join(tmpDir, '.diff-base-script.sh');
      fs.writeFileSync(scriptPath, substituted);

      const output = execFileSync('bash', [scriptPath], {
        cwd: tmpDir,
        encoding: 'utf8',
        timeout: GIT_FIXTURE_TIMEOUT_MS,
      });
      const files = output.split('\n').map((l) => l.trim()).filter(Boolean).sort();

      assert.deepEqual(
        files,
        ['.planning/phases/03-beta/03-01-PLAN.md', 'm2/delta.js', 'm2/gamma.js'].sort(),
        `diff must be scoped to milestone-2's own phase 03-beta files only, got: ${JSON.stringify(files)}`,
      );
      // The defect this test guards against: milestone-1's files must NOT
      // leak into the diff.
      assert.ok(!files.includes('m1/alpha.js'), 'milestone-1 files must not appear in the diff');
      assert.ok(!files.includes('.planning/phases/03-alpha/03-01-PLAN.md'), 'milestone-1 phase dir must not appear in the diff');
    } finally {
      cleanup(tmpDir);
    }
  });
});
