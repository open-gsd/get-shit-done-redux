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
 * Mirrors the issue's own verified reproduction methodology: extract the
 * Tier 1 and Tier 3 fences VERBATIM from code-review.md (never
 * reimplemented), set only the prerequisite variables, run against a real
 * constructed git fixture.
 *
 * Tier 2's own fence is DELIBERATELY NOT extracted-and-executed here — a
 * code-review pass on this fix found it is not currently parseable bash at
 * all (two unescaped `"` characters inside its embedded `node -e "..."`
 * regex literal terminate the outer double-quoted string early, breaking
 * bash's parse of the WHOLE script even though Tier 2's body never
 * executes under `--files`). That defect is real, already reported, and
 * already queued as its own issue (#4461, filed separately by #4460's own
 * reporter: "the Tier-2 SUMMARY-extraction fence is not parseable bash
 * (same file, different defect)") — fixing it here would be exactly the
 * scope creep the reporter took care to avoid. Until #4461 lands, the
 * "without --files" case below seeds the REVIEW_FILES state Tier 2 would
 * have produced directly, rather than sourcing Tier 2's broken fence.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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
 * Runs Tier 1 (verbatim) then Tier 3 (verbatim) in sequence. `seedReviewFiles`
 * stands in for what Tier 2 would have produced when `filesOverride` is unset
 * (Tier 2 itself is not sourced — see the module docblock for why) — an empty
 * array when omitted, matching Tier 2's own real behavior when no SUMMARY
 * yields anything.
 */
function runTiers(tmpDir, { filesOverride, seedReviewFiles = [] }) {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  // #4460 CI finding: Tier 1's `realpath -m` is a pre-existing, out-of-scope
  // portability gap (BSD/macOS realpath has no -m; confirmed CI-reproducible
  // on Windows too, where it likewise makes every --files entry look "outside
  // the repository" and REVIEW_FILES stays empty, tripping the OUTER `if
  // [ ${#REVIEW_FILES[@]} -eq 0 ]` fallback instead of exercising the gated
  // elif this test targets). Not this fix's concern (see #4460's review
  // notes) and every path in these fixtures already exists, so `-m` (which
  // only changes behavior for a MISSING path) is a no-op here — stripped so
  // this test exercises Tier 3's gate on every platform gsd-test runs on,
  // not Tier 1's realpath compatibility.
  const tier1 = extractFirstBashBlockAfter(content, '**Tier 1 — --files override', '**Tier 2 —')
    .replace(/\brealpath -m\b/, 'realpath');
  const tier3 = extractFirstBashBlockAfter(content, '**Tier 3 — Git diff fallback', '**Post-processing');

  const filesArrayInit = filesOverride
    ? `FILES_ARRAY=(${filesOverride})`
    : 'FILES_ARRAY=()';
  const seedInit = seedReviewFiles.length
    ? `REVIEW_FILES=(${seedReviewFiles.map((f) => `"${f}"`).join(' ')})`
    : 'REVIEW_FILES=()';

  const script = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    `FILES_OVERRIDE="${filesOverride || ''}"`,
    filesArrayInit,
    // Both tiers print diagnostic "File scope: ..." / "Warning: ..." lines to
    // stdout as documentation for a human running code-review.md interactively
    // — a brace group (not a subshell: variables set inside still persist to
    // the enclosing shell) redirects that chatter to stderr (captured
    // separately below) instead of discarding it, so a failure carries the
    // actual reason Tier 1 accepted/rejected each path, rather than forcing
    // another guess-and-push cycle (three of which have already failed
    // identically on Windows CI — see the round-4/round-5 review notes).
    '{',
    tier1,
    // Diagnostic-only: what Tier 1 actually decided, before Tier 3 runs.
    'echo "[diag] REPO_ROOT=$REPO_ROOT"',
    'for f in "${REVIEW_FILES[@]:-}"; do echo "[diag] REVIEW_FILES(post-tier1)+=$f"; done',
    // Tier 1 unconditionally resets REVIEW_FILES=() when FILES_OVERRIDE is
    // set; the seed only matters (and only applies) when it is not, exactly
    // mirroring Tier 2 running in FILES_OVERRIDE's absence.
    `if [ -z "$FILES_OVERRIDE" ]; then ${seedInit}; fi`,
    'PHASE_DIR=".planning/phases/03-demo"',
    'PADDED_PHASE="03"',
    'LAST_REVIEW_COMMIT=""',
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
  const files = result.stdout.split('\n').map((l) => l.trim()).filter(Boolean).sort();
  files.__diagnostics = result.stderr;
  return files;
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
    // fs.realpathSync.native: tests/helpers.cjs's tmpRootCandidates() documents
    // GitHub's Windows runners reporting os.tmpdir() in the 8.3 SHORT form and
    // plain fs.realpathSync() not reliably expanding it. Applied as a
    // plausible, evidence-grounded fix for the same widened-to-5-files
    // Windows CI failure this test kept hitting -- but it did NOT resolve it
    // (identical symptom recurred after this fix landed), so the true cause
    // is still unconfirmed. Left in place because it's still a correct fix
    // for its own documented bug class, but see runTiers()'s stderr
    // diagnostics wiring below: rather than guess a fourth time, the next
    // Windows CI failure carries Tier 1's own "[diag] REPO_ROOT=..." /
    // "[diag] REVIEW_FILES(post-tier1)+=..." lines so the actual cause is
    // read off the failure, not inferred.
    const tmpDir = fs.realpathSync.native(createTempDir('gsd-4460-'));
    try {
      buildFixture(tmpDir);
      const files = runTiers(tmpDir, { filesOverride: 'src/alpha.js' });
      assert.deepEqual(
        files,
        ['src/alpha.js'],
        `--files override must not be widened by Tier 3's cross-check, got: ${JSON.stringify(files)}\ndiagnostics:\n${files.__diagnostics || '(none)'}`,
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
      // why Tier 2's own fence isn't sourced here.
      const files = runTiers(tmpDir, { filesOverride: '', seedReviewFiles: ['src/alpha.js'] });
      assert.deepEqual(
        files,
        ['src/alpha.js', 'src/beta.js', 'src/delta.js', 'src/epsilon.js', 'src/gamma.js'],
        `without --files, the cross-check must still widen a partial scope, got: ${JSON.stringify(files)}\ndiagnostics:\n${files.__diagnostics || '(none)'}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });
});
