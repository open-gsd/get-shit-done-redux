// allow-test-rule: source-text-is-the-product (see #4460)
// Workflow markdown is the installed orchestration contract — this file's
// text IS what the reviewer flow runs at runtime.

'use strict';

/**
 * Regression coverage for #4460: code-review.md states (line 144) "Skip
 * SUMMARY/git scoping entirely when --files is provided." Tier 2 honors
 * this via `if [ -z "$FILES_OVERRIDE" ]`, but Tier 3's `#2666` cross-check
 * had no `FILES_OVERRIDE` reference at all — reached via `elif [ -n
 * "$DIFF_BASE" ]` whenever `REVIEW_FILES` was already non-empty (true
 * under `--files`, since Tier 1 fills it), so it silently appended the
 * whole phase diff onto an explicit user-supplied file list.
 *
 * Only Tier 3's own fence is extracted-and-executed VERBATIM from
 * code-review.md (never reimplemented) against a real constructed git
 * fixture. Tiers 1 and 2 are NOT sourced — both are seeded instead,
 * mimicking each tier's real successful output rather than running its
 * actual fence:
 *
 * - Tier 2's fence is not currently parseable bash at all (two unescaped
 *   `"` characters inside its embedded `node -e "..."` regex literal
 *   terminate the outer double-quoted string early, breaking bash's parse
 *   of the WHOLE script even though Tier 2's body never executes under
 *   `--files`). Real, already reported, already queued as its own issue
 *   (#4461, filed separately by #4460's own reporter) — fixing it here
 *   would be exactly the scope creep the reporter took care to avoid.
 * - Tier 1's fence IS parseable bash, but its REPO_ROOT-prefix containment
 *   check is confirmed non-functional on Windows CI: `git rev-parse
 *   --show-toplevel` there returns a mixed-format path (`C:/Users/...` —
 *   drive letter, forward slashes) while GNU `realpath` (also bundled with
 *   Git for Windows) returns a genuine POSIX path for the IDENTICAL
 *   location (`/c/Users/...`) — confirmed via this test's own stderr
 *   diagnostics captured on a live Windows CI run of PR #4552, after three
 *   prior guesses at the same "--files widened to all 5 files" symptom
 *   (stripping `-m`, then two rounds of Node-side realpath-expansion
 *   fixes) each failed identically because none of them was the actual
 *   cause. The two path forms can never share a string prefix, so Tier 1
 *   misclassifies every `--files` entry as "outside the repository" on
 *   every Windows run, unconditionally and deterministically — a real,
 *   structural, pre-existing Tier 1 defect, not something introduced or
 *   fixable by this test. Same out-of-scope bucket as #4461 (this file's
 *   fences not being cross-platform-robust); not this fix's concern (see
 *   cr-2 in #4460's review notes).
 *
 * Seeding REVIEW_FILES directly for both tiers isolates the test to Tier
 * 3's own logic — the actual subject of #4460 — independent of either
 * earlier tier's unrelated defects.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitOrThrow } = require('./helpers/git-fixture.cjs');
const { GIT_FIXTURE_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

const WORKFLOW_PATH = path.join(__dirname, '..', 'gsd-core', 'workflows', 'code-review.md');

/**
 * Extract the FIRST ```bash fence appearing after `startAnchor` and before
 * `stopAnchor` (or end of file when `stopAnchor` is null).
 */
function extractFirstBashBlockAfter(content, startAnchor, stopAnchor) {
  const start = content.indexOf(startAnchor);
  assert.ok(start !== -1, `code-review.md must contain the anchor "${startAnchor}"`);
  const stop = stopAnchor ? content.indexOf(stopAnchor, start + startAnchor.length) : content.length;
  assert.ok(!stopAnchor || stop !== -1, `code-review.md must contain the anchor "${stopAnchor}" after "${startAnchor}"`);
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

// Matches the issue's own fixture exactly: a phase dir with one SUMMARY
// listing only src/alpha.js, and 5 commits adding src/{alpha,beta,gamma,
// delta,epsilon}.js.
function buildFixture(tmpDir) {
  seedFixtureRepo(tmpDir);
  writeAndCommit(tmpDir, 'README.md', '# init\n', 'chore: init');
  writeAndCommit(
    tmpDir,
    '.planning/phases/03-demo/03-01-SUMMARY.md',
    '---\nkey_files:\n  created:\n    - src/alpha.js\n---\n# Summary\n',
    'feat(03-01): phase 3 plan 1',
  );
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    writeAndCommit(tmpDir, `src/${name}.js`, `${name}\n`, `feat(03-01): add ${name}`);
  }
}

/**
 * Runs ONLY Tier 3 (verbatim), seeded with the REVIEW_FILES state a working
 * Tier 1 (`filesOverride` set) or Tier 2 (`filesOverride` empty) would have
 * produced — see the module docblock for why neither earlier tier's own
 * fence is sourced here.
 */
function runTier3(tmpDir, { filesOverride, seedReviewFiles }) {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const tier3 = extractFirstBashBlockAfter(content, '**Tier 3 — Git diff fallback', '**Post-processing');

  const seedInit = `REVIEW_FILES=(${seedReviewFiles.map((f) => `"${f}"`).join(' ')})`;

  const script = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    `FILES_OVERRIDE="${filesOverride || ''}"`,
    seedInit,
    'PHASE_DIR=".planning/phases/03-demo"',
    'PADDED_PHASE="03"',
    'LAST_REVIEW_COMMIT=""',
    // Tier 3 prints diagnostic "File scope: ... files from git diff" lines to
    // stdout as documentation for a human running code-review.md interactively
    // — a brace group (not a subshell: variables set inside still persist to
    // the enclosing shell) redirects that chatter to stderr (captured
    // separately below) instead of discarding it, so a failure carries
    // Tier 3's own reasoning rather than requiring another guess-and-push
    // cycle.
    '{',
    tier3,
    '} 1>&2',
    'printf \'%s\\n\' "${REVIEW_FILES[@]}"',
  ].join('\n');

  const scriptPath = path.join(tmpDir, '.tier-script.sh');
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
    throw new Error(
      `bash exited ${result.status} (signal ${result.signal})\ndiagnostics:\n${result.stderr || '(none)'}`,
    );
  }
  // Returned as a plain object, not a decorated array: assert.deepEqual on an
  // array compares its own properties too, so an extra property attached
  // directly to the array (tried in an earlier revision of this fix) makes
  // `["src/alpha.js"]` fail deepEqual against a same-valued plain array
  // literal purely because of the decoration -- a self-inflicted false
  // failure, not a Tier 3 behavior change.
  const files = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean).sort();
  return { files, diagnostics: result.stderr };
}

describe('#4460: code-review.md Tier 3 does not widen an explicit --files override', () => {
  const workflowContent = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const tier3Fence = extractFirstBashBlockAfter(workflowContent, '**Tier 3 — Git diff fallback', '**Post-processing');

  test('the #2666 cross-check elif references FILES_OVERRIDE (the gate exists)', () => {
    const crossCheckIdx = tier3Fence.indexOf('#2666 cross-check');
    assert.ok(crossCheckIdx !== -1, 'Tier 3 fence must contain the #2666 cross-check comment');
    const elifLine = tier3Fence.slice(0, crossCheckIdx).split('\n').filter((l) => l.trim().startsWith('elif')).pop();
    assert.ok(
      elifLine && elifLine.includes('FILES_OVERRIDE'),
      `the elif guarding the #2666 cross-check must reference FILES_OVERRIDE, got: ${JSON.stringify(elifLine)}`,
    );
  });

  test('real execution: --files=src/alpha.js stays scoped to exactly that file (issue #4460 repro)', () => {
    // REVIEW_FILES is seeded to ['src/alpha.js'] directly here -- the value a
    // WORKING Tier 1 would have produced for `--files src/alpha.js` -- rather
    // than sourcing Tier 1's actual fence. See the module docblock: Tier 1's
    // own REPO_ROOT-prefix containment check is confirmed non-functional on
    // Windows CI (git rev-parse and realpath disagree on path FORMAT there,
    // not just short-vs-long names), so this test isolates Tier 3 -- the
    // actual subject of #4460 -- from that unrelated, pre-existing defect.
    const tmpDir = fs.realpathSync.native(createTempDir('gsd-4460-'));
    try {
      buildFixture(tmpDir);
      const { files, diagnostics } = runTier3(tmpDir, { filesOverride: 'src/alpha.js', seedReviewFiles: ['src/alpha.js'] });
      assert.deepEqual(
        files,
        ['src/alpha.js'],
        `--files override must not be widened by Tier 3's cross-check, got: ${JSON.stringify(files)}\ndiagnostics:\n${diagnostics || '(none)'}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  test('without --files, the #2666 cross-check still widens a partial (Tier-2-equivalent) scope (no regression to the cross-check itself)', () => {
    const tmpDir = fs.realpathSync.native(createTempDir('gsd-4460-'));
    try {
      buildFixture(tmpDir);
      // seedReviewFiles stands in for Tier 2's real output (["src/alpha.js"],
      // the file the fixture's SUMMARY lists) — see the module docblock for
      // why Tier 2's own fence isn't sourced here. Same seed value as the
      // --files case above; only FILES_OVERRIDE differs, which is exactly
      // the variable #4460's fix gates on.
      const { files, diagnostics } = runTier3(tmpDir, { filesOverride: '', seedReviewFiles: ['src/alpha.js'] });
      assert.deepEqual(
        files,
        ['src/alpha.js', 'src/beta.js', 'src/delta.js', 'src/epsilon.js', 'src/gamma.js'],
        `without --files, the cross-check must still widen a partial scope, got: ${JSON.stringify(files)}\ndiagnostics:\n${diagnostics || '(none)'}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });
});
