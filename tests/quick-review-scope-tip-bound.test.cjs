'use strict';

/**
 * Regression coverage for #4466: quick.md's post-execute review scoping step
 * computes `CHANGED_FILES` as `git diff --name-only "${DIFF_BASE}..HEAD"`.
 * `DIFF_BASE` (the parent of QUICK_COMMITS's oldest entry) is correctly
 * bound to the quick task's start, but the tip is bare HEAD — unbounded.
 * Anything landing on the shared tree between the task's own commits and
 * this review step running (a worktree merge-back, another session sharing
 * the tree) gets folded into the quick task's own review scope.
 *
 * QUICK_COMMITS (newest-first) already holds the correct tip as its first
 * line — the fix reads that instead of using HEAD, no new git call needed.
 *
 * Mirrors the issue's own verified reproduction methodology: extract the
 * fence VERBATIM from quick.md (never reimplemented), run it against a real
 * constructed git fixture matching the issue's own exact scenario (an
 * unrelated commit landing after the quick task's own work, before review).
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitOrThrow } = require('./helpers/git-fixture.cjs');
const { GIT_FIXTURE_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'quick.md');

function extractFirstBashBlockAfter(content, startAnchor, stopAnchor) {
  const start = content.indexOf(startAnchor);
  assert.ok(start !== -1, `quick.md must contain the anchor "${startAnchor}"`);
  const stop = stopAnchor ? content.indexOf(stopAnchor, start + startAnchor.length) : content.length;
  assert.ok(!stopAnchor || stop !== -1, `quick.md must contain the anchor "${stopAnchor}" after "${startAnchor}"`);
  const region = content.slice(start, stop);

  const fenceStart = region.indexOf('```bash');
  assert.ok(fenceStart !== -1, `no \`\`\`bash fence found between "${startAnchor}" and its stop anchor`);
  const fenceEnd = region.indexOf('```', fenceStart + '```bash'.length);
  assert.ok(fenceEnd !== -1, `unterminated \`\`\`bash fence after "${startAnchor}"`);
  return region.slice(fenceStart + '```bash'.length, fenceEnd);
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

// Matches the issue's own fixture exactly: init, then the quick task's own
// commit (referencing quick_id in its message), then an unrelated later
// commit landing on the same tree before the review step runs.
const QUICK_ID = '260906-abc';

function buildFixture(tmpDir) {
  seedFixtureRepo(tmpDir);
  writeAndCommit(tmpDir, 'README.md', '# init\n', 'chore: init');
  writeAndCommit(tmpDir, 'src/quick-a.js', 'quick-a\n', `feat(quick-${QUICK_ID}): the quick task's own work`);
  writeAndCommit(tmpDir, 'src/unrelated.js', 'unrelated\n', 'fix: an unrelated commit from another session on the shared tree');
}

function runScopingFence(tmpDir) {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const fence = extractFirstBashBlockAfter(content, "**Scope files from executor's commits:**", '**Invoke review:**');

  const script = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    `quick_id="${QUICK_ID}"`,
    '{',
    fence,
    '} 1>&2',
    'printf \'%s\\n\' "$CHANGED_FILES"',
  ].join('\n');

  const scriptPath = path.join(tmpDir, '.scope-script.sh');
  fs.writeFileSync(scriptPath, script);

  const result = spawnSync('bash', [scriptPath], {
    cwd: tmpDir,
    encoding: 'utf8',
    timeout: GIT_FIXTURE_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(`bash spawn failed: ${result.error.message}\ndiagnostics:\n${result.stderr || '(none)'}`);
  }
  if (result.status !== 0) {
    throw new Error(`bash exited ${result.status} (signal ${result.signal})\ndiagnostics:\n${result.stderr || '(none)'}`);
  }
  const files = result.stdout.trim().split(/\s+/).filter(Boolean).sort();
  return { files, diagnostics: result.stderr };
}

describe('#4466: quick.md review scoping bounds the tip at the quick task\'s own last commit', () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const fence = extractFirstBashBlockAfter(workflowContent, "**Scope files from executor's commits:**", '**Invoke review:**');

  test('the diff uses a bounded tip, not bare HEAD (the gate exists)', () => {
    assert.ok(
      /git diff --name-only "\$\{DIFF_BASE\}\.\.\$\{QUICK_TIP\}"/.test(fence),
      'the scoping fence must diff against a bounded QUICK_TIP, not bare HEAD',
    );
  });

  test('real execution: a later unrelated commit on the shared tree is excluded from scope (issue #4466 repro)', () => {
    const tmpDir = fs.realpathSync.native(createTempDir('gsd-4466-'));
    try {
      buildFixture(tmpDir);
      const { files, diagnostics } = runScopingFence(tmpDir);
      assert.deepEqual(
        files,
        ['src/quick-a.js'],
        `quick task's review scope must not include a later unrelated commit, got: ${JSON.stringify(files)}\ndiagnostics:\n${diagnostics || '(none)'}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });
});
