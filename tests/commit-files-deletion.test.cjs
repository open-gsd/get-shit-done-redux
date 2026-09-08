/**
 * Regression test for #2014: gsd-tools commit --files silently deletes
 * planning files when a filename passed via --files does not exist on disk.
 *
 * Prior to this fix, when --files STATE.md was passed and STATE.md did not
 * exist on disk, the code called `git rm --cached --ignore-unmatch STATE.md`
 * which staged and committed a deletion. The caller passed explicit --files
 * expecting only those specific files to be staged -- missing files should
 * be skipped, not deleted.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempGitProject, cleanup, runGsdTools } = require('./helpers.cjs');
const fc = require('fast-check');
const { collectListFlagValues, COMMIT_LIST_FLAGS } = require('../gsd-core/bin/gsd-tools.cjs');
const { gitOrThrow } = require('./helpers/git-fixture.cjs');
// #3145: class-norm timeout, not a per-suite value — see helpers/timeouts.cjs.
const { GIT_TIMEOUT_MS } = require('./helpers/timeouts.cjs');

describe('commit --files: missing files must not stage deletions (#2014)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    // Commit STATE.md so it exists in git history
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State\n\nInitial state.\n');
    gitOrThrow(['add', '.planning/STATE.md'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'add STATE.md'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    // Delete STATE.md from disk -- now missing but tracked in git
    fs.unlinkSync(path.join(tmpDir, '.planning', 'STATE.md'));
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passing --files for a missing tracked file does not commit a deletion', () => {
    // STATE.md is tracked in git but deleted from disk.
    // commit --files .planning/STATE.md should skip it (no deletion committed).
    runGsdTools(
      ['commit', 'test commit', '--files', '.planning/STATE.md'],
      tmpDir
    );

    // Check git log: the new commit (HEAD) must NOT have deleted STATE.md.
    // git diff HEAD~1 HEAD --name-status shows what changed between commits.
    let diffOutput = '';
    try {
      diffOutput = gitOrThrow(['diff', 'HEAD~1', 'HEAD', '--name-status'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    } catch (e) {
      // If nothing to commit, there is no HEAD~1 -- that's also acceptable
      return;
    }
    assert.ok(
      !diffOutput.includes('D\t.planning/STATE.md'),
      'commit --files must not commit a deletion of a missing file, diff was:\n' + diffOutput
    );
  });

  test('passing --files for a file that exists stages and commits it normally', () => {
    // Create ROADMAP.md -- this file exists, should be staged normally
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n\nPhase 01.\n');

    const result = runGsdTools(
      ['commit', 'add roadmap', '--files', '.planning/ROADMAP.md'],
      tmpDir
    );

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, true, 'should have committed when file exists');

    // Verify ROADMAP.md was added in the commit
    const diffOutput = gitOrThrow(['diff', 'HEAD~1', 'HEAD', '--name-status'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    assert.ok(
      diffOutput.includes('A\t.planning/ROADMAP.md'),
      'ROADMAP.md should appear as added in the commit'
    );
  });

  test('--files with mix of existing and missing files only stages the existing ones', () => {
    // ROADMAP.md exists on disk, STATE.md does not
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n');

    runGsdTools(
      ['commit', 'partial files', '--files', '.planning/ROADMAP.md', '.planning/STATE.md'],
      tmpDir
    );

    // The commit must not include a deletion of STATE.md
    let diffOutput = '';
    try {
      diffOutput = gitOrThrow(['diff', 'HEAD~1', 'HEAD', '--name-status'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    } catch (e) {
      return; // nothing committed is fine
    }
    assert.ok(
      !diffOutput.includes('D\t.planning/STATE.md'),
      'missing file in --files list must not be committed as a deletion'
    );
  });
});

/**
 * Regression tests for #4208: `commit --files` could not record a file move.
 *
 * The #2014 guard above skips a missing `--files` entry, so the only form that
 * recorded a move was a DIRECTORY entry — which also committed any unrelated
 * file sitting in that directory (a concurrent session's in-flight todo, in
 * the execute-phase sweep). `--files-removed` is the caller-declared deletion
 * intent that lets a move be recorded at file granularity, with the #2014
 * skip-if-missing contract on `--files` left untouched.
 */
describe('commit --files-removed: caller-declared deletions record a move (#4208)', () => {
  let tmpDir;
  const PENDING = path.join('.planning', 'todos', 'pending');
  const COMPLETED = path.join('.planning', 'todos', 'completed');

  function nameStatus() {
    // `--no-renames`: a clean move would otherwise collapse to one `R100` row
    // and hide whether the old path's deletion was actually recorded.
    return gitOrThrow(['diff', '--no-renames', 'HEAD~1', 'HEAD', '--name-status'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS })
      .trim().split('\n').filter(Boolean).sort();
  }

  function status() {
    // `-uall`: once the move empties pending/ of tracked files, plain
    // `--porcelain` collapses its untracked contents to the bare directory.
    return gitOrThrow(['status', '--porcelain', '-uall'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();
  }

  beforeEach(() => {
    tmpDir = createTempGitProject();
    fs.mkdirSync(path.join(tmpDir, PENDING), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, COMPLETED), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PENDING, 'mine.md'), '---\nresolves_phase: 5\n---\nmine\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State\n');
    gitOrThrow(['add', '.planning/'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'seed todo'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    // The move this phase performs, plus a peer's unrelated in-flight todo.
    fs.renameSync(path.join(tmpDir, PENDING, 'mine.md'), path.join(tmpDir, COMPLETED, 'mine.md'));
    fs.writeFileSync(path.join(tmpDir, PENDING, 'peer-inflight.md'), '---\nresolves_phase: 99\n---\npeer\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# State\n\nphase 5 closed\n');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('records the move at file granularity and leaves the peer file alone', () => {
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md', '.planning/STATE.md',
        '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, true, 'move commit must succeed: ' + result.output);

    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md', 'M\t.planning/STATE.md'],
      'commit must contain exactly the move and STATE.md',
    );
    // The peer's file is untouched: still untracked, never committed — and
    // nothing about the moved todo is left dangling.
    const st = status();
    assert.ok(st.includes('?? .planning/todos/pending/peer-inflight.md'), 'peer file must stay untracked: ' + st);
    assert.ok(!st.includes('mine.md'), 'no dangling state for the moved todo: ' + st);
    // No dual-tracking: the todo is tracked at the new path only.
    const tracked = gitOrThrow(['ls-files', '--', '.planning/todos'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();
    assert.strictEqual(tracked, '.planning/todos/completed/mine.md');
  });

  test('a directory entry stages only the tracked files that are absent from disk', () => {
    // A second tracked todo that stays put must NOT be touched by the
    // directory form, and the untracked peer file must stay invisible to it.
    fs.writeFileSync(path.join(tmpDir, PENDING, 'stays.md'), 'stays\n');
    gitOrThrow(['add', path.join(PENDING, 'stays.md')], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'seed a todo that stays'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    fs.appendFileSync(path.join(tmpDir, PENDING, 'stays.md'), 'edited by a peer, uncommitted\n');

    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md',
        '--files-removed', '.planning/todos/pending/'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md'],
    );
    const st = status();
    assert.ok(st.includes(' M .planning/todos/pending/stays.md'), 'present tracked file must stay uncommitted: ' + st);
    assert.ok(st.includes('?? .planning/todos/pending/peer-inflight.md'), 'untracked peer file must stay untracked: ' + st);
  });

  test('a --files-removed file entry that is still on disk fails closed and rolls back', () => {
    // The declaration is wrong: pending/mine.md was put back.
    fs.copyFileSync(path.join(tmpDir, COMPLETED, 'mine.md'), path.join(tmpDir, PENDING, 'mine.md'));
    const head = gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();

    const result = runGsdTools(
      ['commit', 'docs(phase-5): bad declaration',
        '--files', '.planning/todos/completed/mine.md',
        '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false);
    assert.strictEqual(parsed.reason, 'staging_failed');
    assert.strictEqual(parsed.file, '.planning/todos/pending/mine.md');
    assert.strictEqual(
      gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(),
      head,
      'nothing may be committed on a refused declaration',
    );
    // Rollback: the addition this call staged is unstaged again.
    assert.strictEqual(
      gitOrThrow(['diff', '--cached', '--name-only'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(),
      '',
    );
  });

  test('a --files-removed path git never tracked is a no-op, not an error', () => {
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md',
        '--files-removed', '.planning/todos/pending/mine.md', '.planning/todos/pending/never-tracked.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md'],
    );
  });

  test('--files-removed alone is a declared scope, not the unscoped .planning/ sweep', () => {
    const result = runGsdTools(
      ['commit', 'docs: drop a todo', '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    // Only the deletion — not completed/mine.md, STATE.md, or the peer file.
    assert.deepStrictEqual(nameStatus(), ['D\t.planning/todos/pending/mine.md']);
  });

  test('--files keeps its #2014 skip-if-missing contract when --files-removed is also given', () => {
    // A tracked file that is temporarily absent (NOT moved) named via --files
    // must still be skipped, even though the same call declares a removal.
    fs.unlinkSync(path.join(tmpDir, '.planning', 'STATE.md'));
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md', '.planning/STATE.md',
        '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md'],
      'the temporarily-absent STATE.md must not be committed as a deletion',
    );
  });

  test('a tracked symlink whose target is gone is present, not a removal', () => {
    // `stat`/`existsSync` follow the link and read it as absent; `lstat` does
    // not. Declaring it removed while it still sits in the worktree must fail
    // closed like any other present entry, with nothing left staged.
    const link = path.join(PENDING, 'dangling');
    fs.symlinkSync('target-that-will-vanish.md', path.join(tmpDir, link));
    gitOrThrow(['add', link], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'seed a symlink'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    const head = gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();

    const result = runGsdTools(
      ['commit', 'docs: bad declaration',
        '--files', '.planning/todos/completed/mine.md',
        '--files-removed', '.planning/todos/pending/dangling'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false, result.output);
    assert.strictEqual(parsed.reason, 'staging_failed');
    assert.strictEqual(parsed.file, '.planning/todos/pending/dangling');
    assert.strictEqual(gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(), head);
    assert.strictEqual(gitOrThrow(['diff', '--cached', '--name-only'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(), '');
  });

  test('a deletion the caller already staged is committed, not reported as nothing to commit', () => {
    // `git rm` before the call empties the index entry; `ls-files` alone would
    // never list it, so the path would miss the pathspec.
    gitOrThrow(['rm', '-q', '--cached', path.join(PENDING, 'mine.md')], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    const result = runGsdTools(
      ['commit', 'docs: drop a todo', '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(nameStatus(), ['D\t.planning/todos/pending/mine.md']);
  });

  test('a deletion staged by this call is rolled back when a later entry fails', () => {
    // Ordering: the good removal is processed first, then the contradicted one.
    fs.copyFileSync(path.join(tmpDir, COMPLETED, 'mine.md'), path.join(tmpDir, PENDING, 'stays-put.md'));
    gitOrThrow(['add', path.join(PENDING, 'stays-put.md')], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'seed a second todo'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    const head = gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();

    const result = runGsdTools(
      ['commit', 'docs: bad declaration',
        '--files-removed', '.planning/todos/pending/mine.md', '.planning/todos/pending/stays-put.md'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.strictEqual(parsed.file, '.planning/todos/pending/stays-put.md');
    assert.strictEqual(gitOrThrow(['rev-parse', 'HEAD'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(), head);
    // The staged deletion of mine.md was restored to the index by the rollback.
    assert.strictEqual(gitOrThrow(['diff', '--cached', '--name-only'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim(), '');
    assert.ok(
      gitOrThrow(['ls-files', '--', PENDING], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).includes('mine.md'),
      'mine.md must be back in the index after rollback',
    );
  });

  test('a caller-pre-staged deletion with a non-ASCII name survives the rollback', () => {
    // `diff --cached --name-only` without -z quotes `café.md` as
    // `"caf\303\251.md"`, which never matched the raw path, so the rollback
    // treated the caller's own staged deletion as this call's and undid it.
    const cafe = path.join(PENDING, 'café.md');
    fs.writeFileSync(path.join(tmpDir, cafe), 'accent\n');
    gitOrThrow(['add', cafe], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['commit', '-m', 'seed café'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['rm', '-q', cafe], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });   // caller-staged deletion
    fs.copyFileSync(path.join(tmpDir, COMPLETED, 'mine.md'), path.join(tmpDir, PENDING, 'mine.md'));   // contradiction

    const result = runGsdTools(
      ['commit', 'docs: bad declaration',
        '--files-removed', '.planning/todos/pending/café.md', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).reason, 'staging_failed', result.output);
    const cached = gitOrThrow(['diff', '--cached', '--name-only', '-z'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).split('\0').filter(Boolean);
    assert.deepStrictEqual(cached, ['.planning/todos/pending/café.md'], 'the caller\'s own staged deletion must survive');
  });

  test('on an unborn HEAD an absent index-only path is unstaged, never a pathspec entry', (t) => {
    // A root commit has no parent to delete from; naming the path would make
    // `git commit` refuse with "pathspec did not match".
    const fresh = createTempGitProject();
    t.after(() => cleanup(fresh));
    // The fixture may seed commits; make an unborn branch explicitly.
    gitOrThrow(['checkout', '-q', '--orphan', 'unborn'], { cwd: fresh, timeoutMs: GIT_TIMEOUT_MS });
    gitOrThrow(['rm', '-rfq', '--cached', '.'], { cwd: fresh, timeoutMs: GIT_TIMEOUT_MS });
    fs.mkdirSync(path.join(fresh, PENDING), { recursive: true });
    fs.writeFileSync(path.join(fresh, PENDING, 'a.md'), 'a\n');
    fs.writeFileSync(path.join(fresh, PENDING, 'gone.md'), 'gone\n');
    gitOrThrow(['add', PENDING], { cwd: fresh, timeoutMs: GIT_TIMEOUT_MS });
    fs.unlinkSync(path.join(fresh, PENDING, 'gone.md'));

    const result = runGsdTools(
      ['commit', 'docs: root commit',
        '--files', '.planning/todos/pending/a.md',
        '--files-removed', '.planning/todos/pending/gone.md'],
      fresh,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    const tree = gitOrThrow(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: fresh, timeoutMs: GIT_TIMEOUT_MS }).trim().split('\n');
    assert.ok(tree.includes('.planning/todos/pending/a.md'), tree.join(','));
    assert.ok(!tree.includes('.planning/todos/pending/gone.md'), tree.join(','));
    assert.strictEqual(gitOrThrow(['diff', '--cached', '--name-only'], { cwd: fresh, timeoutMs: GIT_TIMEOUT_MS }).trim(), '');
  });

  test('a boolean flag inside a list does not end it: the positional after it stays in that list', () => {
    // `--files a --no-verify b --files-removed c`: before #4208 the single
    // slice-to-end list swept `b` into --files; a list that stops at ANY
    // `--` token silently drops it instead (review of #4253). A list runs to
    // the next LIST flag and skips boolean flags on the way.
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md', '--no-verify', '.planning/STATE.md',
        '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md', 'M\t.planning/STATE.md'],
      'STATE.md, wedged between --no-verify and --files-removed, must still be in the --files list',
    );
  });

  test('a repeated list flag merges its runs, as the old parser did', () => {
    // `--files a --files b`: the pre-#4208 slice-to-end parse yielded [a, b];
    // a parser that stops at the next list flag — including a repeat of the
    // same one — silently dropped b (found by the round's comment audit).
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), '# Roadmap\n');
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files', '.planning/todos/completed/mine.md', '--files', '.planning/ROADMAP.md',
        '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/ROADMAP.md', 'A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md'],
      'both --files runs must reach the commit',
    );
  });

  test('--files-removed before --files parses both lists and the message', () => {
    const result = runGsdTools(
      ['commit', 'docs(phase-5): close 1 resolved todo(s)',
        '--files-removed', '.planning/todos/pending/mine.md',
        '--files', '.planning/todos/completed/mine.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(
      nameStatus(),
      ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md'],
    );
    const subject = gitOrThrow(['log', '-1', '--format=%s'], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS }).trim();
    assert.strictEqual(subject, 'docs(phase-5): close 1 resolved todo(s)');
  });
});

/**
 * #4253 review: absence from the worktree is not removal. Some index entries
 * are absent BY DESIGN — a submodule gitlink whose directory was deleted by
 * hand, a skip-worktree path a sparse checkout never materialised, an
 * assume-unchanged path — and `lstat` cannot tell them from a moved-away file.
 * Under a directory entry they are left alone, exactly like a present file;
 * named directly they contradict the declaration and fail closed. And a
 * staging failure restores every index entry this call removed EXACTLY,
 * including on an unborn HEAD, where `git reset` has nothing to restore from.
 */
describe('commit --files-removed: index states absent by design are never removals (#4208 review)', () => {
  let tmpDir;
  let stray;
  const PENDING = path.join('.planning', 'todos', 'pending');
  const COMPLETED = path.join('.planning', 'todos', 'completed');

  function git(args, cwd = tmpDir) {
    return gitOrThrow(args, { cwd, timeoutMs: GIT_TIMEOUT_MS }).trim();
  }
  function nameStatus() {
    return git(['diff', '--no-renames', 'HEAD~1', 'HEAD', '--name-status']).split('\n').filter(Boolean).sort();
  }
  // Untrimmed: porcelain's leading column is significant (` D` = unstaged deletion).
  function porcelain(...pathspec) {
    return gitOrThrow(['status', '--porcelain', '--', ...pathspec], { cwd: tmpDir, timeoutMs: GIT_TIMEOUT_MS });
  }
  // Seed the standard move: pending/mine.md -> completed/mine.md, committed at pending/.
  function seedMove() {
    fs.mkdirSync(path.join(tmpDir, PENDING), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, COMPLETED), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PENDING, 'mine.md'), 'mine\n');
    git(['add', '.planning/']);
    git(['commit', '-q', '-m', 'seed todo']);
    fs.renameSync(path.join(tmpDir, PENDING, 'mine.md'), path.join(tmpDir, COMPLETED, 'mine.md'));
  }
  // A submodule at pending/sub whose directory is then deleted by hand — the
  // one gitlink shape that reads as absent (an uninitialised submodule leaves
  // an empty directory behind, which lstat sees as present).
  function addSubmoduleThenDeleteDir() {
    const subSrc = path.join(tmpDir, '..', path.basename(tmpDir) + '-sub');
    stray = subSrc;
    fs.mkdirSync(subSrc, { recursive: true });
    git(['init', '-q', '.'], subSrc);
    git(['config', 'user.email', 't@t'], subSrc);
    git(['config', 'user.name', 't'], subSrc);
    fs.writeFileSync(path.join(subSrc, 'f.txt'), 'v1\n');
    git(['add', 'f.txt'], subSrc);
    git(['commit', '-q', '-m', 'v1'], subSrc);
    git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrc, '.planning/todos/pending/sub']);
    git(['commit', '-q', '-m', 'add submodule']);
    cleanup(path.join(tmpDir, PENDING, 'sub'));
    assert.match(porcelain(PENDING), /^ D \.planning\/todos\/pending\/sub$/m, 'git itself reads the gitlink as deleted');
  }

  beforeEach(() => { tmpDir = createTempGitProject(); stray = null; });
  afterEach(() => { cleanup(tmpDir); if (stray) cleanup(stray); });

  test('a directory entry leaves a hand-deleted submodule gitlink in the index and records only the file move', () => {
    seedMove();
    addSubmoduleThenDeleteDir();
    const result = runGsdTools(
      ['commit', 'docs: close a todo', '--files', '.planning/todos/completed/mine.md', '--files-removed', '.planning/todos/pending/'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, true, result.output);
    assert.deepStrictEqual(nameStatus(), ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md']);
    // The gitlink is still tracked, at mode 160000, and git still reports the
    // hand-deletion as the caller's unstaged business — not this call's.
    assert.match(git(['ls-files', '-s', '--', PENDING]), /^160000 [0-9a-f]+ 0\t\.planning\/todos\/pending\/sub$/m);
    assert.match(porcelain(PENDING), /^ D \.planning\/todos\/pending\/sub$/m);
  });

  test('a submodule gitlink named directly under --files-removed fails closed, naming the state', () => {
    seedMove();
    addSubmoduleThenDeleteDir();
    const head = git(['rev-parse', 'HEAD']);
    const result = runGsdTools(
      ['commit', 'docs: bad declaration', '--files', '.planning/todos/completed/mine.md', '--files-removed', '.planning/todos/pending/sub'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false, result.output);
    assert.strictEqual(parsed.reason, 'staging_failed');
    assert.strictEqual(parsed.file, '.planning/todos/pending/sub');
    assert.match(parsed.error, /submodule gitlink/);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head);
    assert.strictEqual(git(['diff', '--cached', '--name-only']), '', 'the addition this call staged is rolled back');
    assert.match(git(['ls-files', '-s', '--', PENDING]), /^160000 /m, 'the gitlink is untouched');
  });

  test('a skip-worktree path is absent by checkout, not removed: skipped under a directory entry, refused when named', () => {
    seedMove();
    // A second tracked todo that a sparse checkout would not materialise.
    fs.writeFileSync(path.join(tmpDir, PENDING, 'sparse.md'), 'sparse\n');
    git(['add', path.join(PENDING, 'sparse.md')]);
    git(['commit', '-q', '-m', 'seed sparse']);
    git(['update-index', '--skip-worktree', '--', '.planning/todos/pending/sparse.md']);
    fs.unlinkSync(path.join(tmpDir, PENDING, 'sparse.md'));
    assert.strictEqual(porcelain(path.join(PENDING, 'sparse.md')), '', 'git itself does not report a skip-worktree path as deleted');

    const dirForm = runGsdTools(
      ['commit', 'docs: close a todo', '--files', '.planning/todos/completed/mine.md', '--files-removed', '.planning/todos/pending/'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(dirForm.output).committed, true, dirForm.output);
    assert.deepStrictEqual(nameStatus(), ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md']);
    assert.match(git(['ls-files', '-v', '--', PENDING]), /^S \.planning\/todos\/pending\/sparse\.md$/m, 'the sparse entry stays in the index, still skip-worktree');

    const head = git(['rev-parse', 'HEAD']);
    const named = runGsdTools(['commit', 'docs: bad declaration', '--files-removed', '.planning/todos/pending/sparse.md'], tmpDir);
    const parsed = JSON.parse(named.output);
    assert.strictEqual(parsed.reason, 'staging_failed', named.output);
    assert.strictEqual(parsed.file, '.planning/todos/pending/sparse.md');
    assert.match(parsed.error, /skip-worktree/);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head);
    assert.match(git(['ls-files', '-v', '--', PENDING]), /^S \.planning\/todos\/pending\/sparse\.md$/m);
  });

  test('a directly named path is recognised by any spelling that resolves to it (absolute path)', () => {
    // The direct-vs-directory decision is made on resolved paths. A string
    // compare against git's cwd-relative output silently took the directory
    // polarity for an absolute path, so a named gitlink SKIPPED instead of
    // refusing (found by review, driven).
    seedMove();
    addSubmoduleThenDeleteDir();
    const head = git(['rev-parse', 'HEAD']);
    const result = runGsdTools(
      ['commit', 'docs: bad declaration', '--files', '.planning/todos/completed/mine.md', '--files-removed', path.join(tmpDir, PENDING, 'sub')],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.match(parsed.error, /submodule gitlink/);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head);
    assert.match(git(['ls-files', '-s', '--', PENDING]), /^160000 /m, 'the gitlink is untouched');

    // And through a SYMLINKED spelling of the same directory — the macOS
    // `/var` → `/private/var` shape, where `process.cwd()` is the real path
    // and the caller's absolute path is not (CI, first push of this round).
    const alias = tmpDir + '-alias';
    fs.symlinkSync(tmpDir, alias, 'dir');
    try {
      const viaLink = runGsdTools(
        ['commit', 'docs: bad declaration', '--files', '.planning/todos/completed/mine.md', '--files-removed', path.join(alias, PENDING, 'sub')],
        tmpDir,
      );
      const p2 = JSON.parse(viaLink.output);
      assert.strictEqual(p2.reason, 'staging_failed', viaLink.output);
      assert.match(p2.error, /submodule gitlink/);
      assert.strictEqual(git(['rev-parse', 'HEAD']), head);
    } finally {
      fs.unlinkSync(alias);
    }
  });

  test('an intent-to-add entry is not tracked content: skipped under a directory entry, refused when named', () => {
    // `git add -N` renders as a plain `H 100644 <empty blob>` entry, yet there
    // is nothing committed to remove and a cacheinfo rollback cannot restore
    // the flag (found by review, driven).
    seedMove();
    fs.writeFileSync(path.join(tmpDir, PENDING, 'planned.md'), 'planned\n');
    git(['add', '-N', path.join(PENDING, 'planned.md')]);
    fs.unlinkSync(path.join(tmpDir, PENDING, 'planned.md'));
    const before = git(['ls-files', '-s', '--', path.join(PENDING, 'planned.md')]);
    assert.match(before, /^100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0/, 'fixture: intent-to-add entry present');

    const dirForm = runGsdTools(
      ['commit', 'docs: close a todo', '--files', '.planning/todos/completed/mine.md', '--files-removed', '.planning/todos/pending/'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(dirForm.output).committed, true, dirForm.output);
    assert.deepStrictEqual(nameStatus(), ['A\t.planning/todos/completed/mine.md', 'D\t.planning/todos/pending/mine.md']);
    assert.strictEqual(git(['ls-files', '-s', '--', path.join(PENDING, 'planned.md')]), before, 'the intent-to-add entry is left alone');

    const named = runGsdTools(['commit', 'docs: bad declaration', '--files-removed', '.planning/todos/pending/planned.md'], tmpDir);
    const parsed = JSON.parse(named.output);
    assert.strictEqual(parsed.reason, 'staging_failed', named.output);
    assert.match(parsed.error, /intent-to-add/);
    assert.strictEqual(git(['ls-files', '-s', '--', path.join(PENDING, 'planned.md')]), before);
  });

  test('an assume-unchanged path named directly fails closed and stays in the index', () => {
    seedMove();
    git(['update-index', '--assume-unchanged', '--', '.planning/todos/pending/mine.md']);
    const result = runGsdTools(['commit', 'docs: drop a todo', '--files-removed', '.planning/todos/pending/mine.md'], tmpDir);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.match(parsed.error, /assume-unchanged/);
    assert.match(git(['ls-files', '-v', '--', PENDING]), /^h \.planning\/todos\/pending\/mine\.md$/m);
  });

  test('on an unborn HEAD a removal staged by this call is restored when a later entry fails', (t) => {
    // The rollback cannot `git reset` to a HEAD that does not exist; the
    // entry is put back from the record this call kept of it.
    const fresh = createTempGitProject();
    t.after(() => cleanup(fresh));
    git(['checkout', '-q', '--orphan', 'unborn'], fresh);
    git(['rm', '-rfq', '--cached', '.'], fresh);
    fs.mkdirSync(path.join(fresh, PENDING), { recursive: true });
    fs.writeFileSync(path.join(fresh, PENDING, 'gone.md'), 'gone\n');
    fs.writeFileSync(path.join(fresh, PENDING, 'stays.md'), 'stays\n');
    git(['add', PENDING], fresh);
    const before = git(['ls-files', '-s', '--', PENDING], fresh);
    fs.unlinkSync(path.join(fresh, PENDING, 'gone.md'));

    const result = runGsdTools(
      ['commit', 'docs: root commit', '--files-removed', '.planning/todos/pending/gone.md', '.planning/todos/pending/stays.md'],
      fresh,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.strictEqual(parsed.file, '.planning/todos/pending/stays.md');
    assert.throws(() => git(['rev-parse', '-q', '--verify', 'HEAD'], fresh), 'nothing may be committed');
    assert.strictEqual(git(['ls-files', '-s', '--', PENDING], fresh), before, 'gone.md is back in the index, same mode and blob');
  });

  test('on an unborn HEAD a removal-only call that stages nothing else leaves no removal behind', (t) => {
    // The rollback above fires only on a staging FAILURE. On an unborn HEAD a
    // removal never joins `stagedPaths` (there is no parent to delete from), so
    // a removal-only call that SUCCEEDS reaches the nothing-to-commit guard with
    // an empty pathspec -- and `nothing_to_commit` tells the caller no state
    // changed while `rm --cached` has already mutated the index. The removal
    // would then ride along on the caller's next commit.
    const fresh = createTempGitProject();
    t.after(() => cleanup(fresh));
    git(['checkout', '-q', '--orphan', 'unborn'], fresh);
    git(['rm', '-rfq', '--cached', '.'], fresh);
    fs.mkdirSync(path.join(fresh, PENDING), { recursive: true });
    fs.writeFileSync(path.join(fresh, PENDING, 'gone.md'), 'gone\n');
    git(['add', PENDING], fresh);
    const before = git(['ls-files', '-s', '--', PENDING], fresh);
    fs.unlinkSync(path.join(fresh, PENDING, 'gone.md'));

    const result = runGsdTools(
      ['commit', 'docs: root commit', '--files-removed', '.planning/todos/pending/gone.md'],
      fresh,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false, result.output);
    assert.throws(() => git(['rev-parse', '-q', '--verify', 'HEAD'], fresh), 'nothing may be committed');
    assert.strictEqual(
      git(['ls-files', '-s', '--', PENDING], fresh), before,
      'a call reporting no commit must leave the index as it found it',
    );
  });

  test('a removal of an index-only path leaves no removal behind when nothing is recorded', () => {
    // The same defect with a real HEAD, so the fix cannot key on `headExists`.
    // gone.md was `git add`ed and never committed, then deleted from disk: the
    // removal DOES join the pathspec here, but `diff HEAD -- gone.md` reads
    // clean because the path is absent from the worktree and from HEAD alike,
    // so the guard reports nothing_to_commit over a staged removal.
    fs.mkdirSync(path.join(tmpDir, PENDING), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PENDING, 'seed.md'), 'seed\n');
    git(['add', '.planning/']);
    git(['commit', '-q', '-m', 'seed todo']);
    fs.writeFileSync(path.join(tmpDir, PENDING, 'gone.md'), 'gone\n');
    git(['add', path.join(PENDING, 'gone.md')]);
    const before = git(['ls-files', '-s', '--', PENDING]);
    const head = git(['rev-parse', 'HEAD']);
    fs.unlinkSync(path.join(tmpDir, PENDING, 'gone.md'));

    const result = runGsdTools(
      ['commit', 'docs: remove an uncommitted path', '--files-removed', '.planning/todos/pending/gone.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).committed, false, result.output);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head, 'nothing may be committed');
    assert.strictEqual(
      git(['ls-files', '-s', '--', PENDING]), before,
      'a call reporting no commit must leave the index as it found it',
    );
  });

  test('a removal the call cannot put back is reported, never as nothing_to_commit', (t) => {
    // The restore is best-effort, so it can FAIL -- and reporting
    // nothing_to_commit over a removal we tried and could not undo is the same
    // false "no state changed" the restore exists to prevent, one level down.
    // Driven with a post-index-change hook that makes the git dir unwritable
    // the moment `rm --cached` lands, so the `update-index --cacheinfo` restore
    // cannot take its lock.
    fs.mkdirSync(path.join(tmpDir, PENDING), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PENDING, 'seed.md'), 'seed\n');
    git(['add', '.planning/']);
    git(['commit', '-q', '-m', 'seed todo']);
    fs.writeFileSync(path.join(tmpDir, PENDING, 'gone.md'), 'gone\n');
    git(['add', path.join(PENDING, 'gone.md')]);
    fs.unlinkSync(path.join(tmpDir, PENDING, 'gone.md'));
    const gitDir = path.join(tmpDir, '.git');
    const hooksDir = path.join(gitDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-index-change'),
      '#!/bin/sh\nchmod a-w "$(git rev-parse --git-dir)"\n', { mode: 0o755 });
    // Give the dir back in a FINALLY below, not only in `t.after`: t.after runs
    // AFTER the parent afterEach, so a throw between the hook and the explicit
    // chmod leaves afterEach unable to delete the fixture. t.after stays as a
    // belt for the case where the finally itself is skipped.
    t.after(() => { try { fs.chmodSync(gitDir, 0o755); } catch { /* already writable */ } });
    const emptyConfig = path.join(tmpDir, 'empty.gitconfig');
    fs.writeFileSync(emptyConfig, '');

    let result;
    try {
      result = runGsdTools(
        ['commit', 'docs: remove an uncommitted path', '--files-removed', '.planning/todos/pending/gone.md'],
        tmpDir,
        { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
      );
    } finally {
      fs.chmodSync(gitDir, 0o755);
    }
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false, result.output);
    assert.notStrictEqual(parsed.reason, 'nothing_to_commit', 'a removal left staged must never be reported as no state change');
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.match(parsed.error, /could not be restored/);
    assert.match(parsed.error, /gone\.md/);
  });

  test('a rollback that cannot restore a removal discloses it, even when the reported failure is another entry', (t) => {
    // The rollback exit reports the failure that CAUSED it -- here a
    // contradictory declaration about a path still on disk -- so a caller
    // reading `failures` would learn nothing about the removal this call had
    // already staged and then could not put back. Both must be disclosed.
    seedMove();
    fs.writeFileSync(path.join(tmpDir, PENDING, 'stays.md'), 'stays\n');
    git(['add', path.join(PENDING, 'stays.md')]);
    git(['commit', '-q', '-m', 'seed a present todo']);
    const gitDir = path.join(tmpDir, '.git');
    const hooksDir = path.join(gitDir, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-index-change'),
      '#!/bin/sh\nchmod a-w "$(git rev-parse --git-dir)"\n', { mode: 0o755 });
    t.after(() => { try { fs.chmodSync(gitDir, 0o755); } catch { /* already writable */ } });
    const emptyConfig = path.join(tmpDir, 'empty.gitconfig');
    fs.writeFileSync(emptyConfig, '');

    let result;
    try {
      // mine.md was moved away (a real removal); stays.md is still on disk, so
      // declaring it removed contradicts the declaration and fails the call.
      result = runGsdTools(
        ['commit', 'docs: bad declaration',
          '--files-removed', '.planning/todos/pending/mine.md', '.planning/todos/pending/stays.md'],
        tmpDir,
        { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
      );
    } finally {
      fs.chmodSync(gitDir, 0o755);
    }
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.strictEqual(parsed.file, '.planning/todos/pending/stays.md', 'the REPORTED failure is still the contradictory declaration');
    const disclosed = parsed.failures.filter(f => /could NOT be restored/.test(f.error));
    assert.ok(
      disclosed.length > 0,
      `a removal left staged by a failed rollback must be disclosed; failures were ${JSON.stringify(parsed.failures)}`,
    );
    assert.ok(
      disclosed.some(f => f.file === '.planning/todos/pending/mine.md'),
      `the disclosure must name the un-restored path; got ${JSON.stringify(disclosed)}`,
    );
  });




  test('a file that reappears between the absence check and the rm is refused, and the rollback restores its entry', () => {
    // The window this PR's own headline scenario names: a concurrent session
    // recreates the path after this call judged it absent. Driven
    // deterministically with a post-index-change hook, which git fires the
    // moment `rm --cached` writes the index -- the hook puts the file back
    // exactly then, so the re-check after the mutation must catch it.
    seedMove();
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'post-index-change'),
      '#!/bin/sh\n'
      + 'git ls-files --error-unmatch -- .planning/todos/pending/mine.md >/dev/null 2>&1 '
      + '|| cp .planning/todos/completed/mine.md .planning/todos/pending/mine.md\n',
      { mode: 0o755 },
    );
    // Pin the hook location against a host core.hooksPath (#3901 shape).
    const emptyConfig = path.join(tmpDir, 'empty.gitconfig');
    fs.writeFileSync(emptyConfig, '');
    const head = git(['rev-parse', 'HEAD']);

    const result = runGsdTools(
      ['commit', 'docs: close a todo', '--files', '.planning/todos/completed/mine.md', '--files-removed', '.planning/todos/pending/mine.md'],
      tmpDir,
      { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.committed, false, result.output);
    assert.strictEqual(parsed.reason, 'staging_failed');
    assert.strictEqual(parsed.file, '.planning/todos/pending/mine.md');
    assert.match(parsed.error, /reappeared on disk/);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head, 'nothing may be committed under a message that declared the path removed');
    assert.strictEqual(git(['diff', '--cached', '--name-only']), '', 'the addition is unstaged and the removed entry is back');
    assert.ok(fs.existsSync(path.join(tmpDir, PENDING, 'mine.md')), 'the hook did put the file back (the window was exercised)');
    assert.match(git(['ls-files', '--', PENDING]), /mine\.md/, 'the index entry this call removed is restored');
  });

  test('the rollback restores a caller-pre-staged blob at a removed path exactly, not HEAD\'s version', () => {
    seedMove();
    fs.writeFileSync(path.join(tmpDir, PENDING, 'present.md'), 'present\n');
    git(['add', path.join(PENDING, 'present.md')]);
    git(['commit', '-q', '-m', 'seed a present todo']);
    // The caller staged an edit to mine.md at its OLD path (index only, HEAD
    // still holds the seed blob), then moved the file and declared the old
    // path removed; a `git reset` rollback would put HEAD's blob back,
    // silently discarding the staged edit.
    fs.writeFileSync(path.join(tmpDir, PENDING, 'mine.md'), 'mine, edited and staged\n');
    git(['add', path.join(PENDING, 'mine.md')]);
    const staged = git(['ls-files', '-s', '--', path.join(PENDING, 'mine.md')]);
    assert.notEqual(staged, git(['ls-tree', 'HEAD', '--', path.join(PENDING, 'mine.md')]).replace(/\t/, ' '), 'fixture: the staged blob must differ from HEAD');
    fs.unlinkSync(path.join(tmpDir, PENDING, 'mine.md'));

    const result = runGsdTools(
      ['commit', 'docs: bad declaration', '--files-removed', '.planning/todos/pending/mine.md', '.planning/todos/pending/present.md'],
      tmpDir,
    );
    assert.strictEqual(JSON.parse(result.output).reason, 'staging_failed', result.output);
    assert.strictEqual(git(['ls-files', '-s', '--', path.join(PENDING, 'mine.md')]), staged, 'the pre-staged blob survives the rollback');
  });

  test('a symlink to a directory is one tracked path, not a directory entry', () => {
    // Review of #4253 read the `lstatSync(...).isDirectory()` test as a defect
    // because it does not follow symlinks. It is deliberate, and following the
    // link would be the bug: git tracks a symlink as a single blob (mode
    // 120000) and does NOT traverse it, so the tracked paths "under" it live
    // at the REAL directory and were never named by the caller. Treating the
    // link as a directory entry would stage those -- the directory sweep
    // #4208 exists to remove -- while the entry the caller DID name still sat
    // present on disk, contradicting its own declaration.
    fs.mkdirSync(path.join(tmpDir, PENDING, 'real'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, PENDING, 'real', 'a.md'), 'a\n');
    fs.symlinkSync('real', path.join(tmpDir, PENDING, 'link'));
    git(['add', '.planning/']);
    git(['commit', '-q', '-m', 'seed a symlinked dir']);

    // The premise, driven rather than asserted: one path, and git does not
    // traverse it.
    assert.match(git(['ls-files', '-s', '--', path.join(PENDING, 'link')]), /^120000 /, 'git tracks the symlink itself');
    assert.strictEqual(git(['ls-files', '--', path.join(PENDING, 'link') + '/']), '', 'git does not traverse the symlink');

    const head = git(['rev-parse', 'HEAD']);
    const result = runGsdTools(
      ['commit', 'docs: remove a symlinked dir', '--files-removed', '.planning/todos/pending/link'],
      tmpDir,
    );
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.reason, 'staging_failed', result.output);
    assert.match(parsed.error, /still present on disk/);
    assert.strictEqual(git(['rev-parse', 'HEAD']), head, 'nothing may be committed');
    assert.match(git(['ls-files', '--', PENDING]), /real\/a\.md/, 'the path behind the link is untouched -- the caller never named it');
  });

});

// RULESET.TESTS.property-based-testing: the two-list commit parser is a real
// parser (split argv into two lists by boundary flags, skip embedded boolean
// flags, merge repeated occurrences), and its edge cases were already the
// subject of a review round. The example cases above pin the shapes that broke;
// this pins the invariant they are instances of, over interleavings nobody
// enumerated.
describe('commit --files/--files-removed: the two-list parser upholds its partition invariant (#4208 review)', () => {
  const LIST = [...COMMIT_LIST_FLAGS];
  // The alphabet a real invocation draws from: positionals, both list flags,
  // and the boolean flags that may sit inside a run without ending it.
  const token = fc.oneof(
    fc.constantFrom('a', 'b', 'c', 'd'),
    fc.constantFrom(...LIST),
    fc.constantFrom('--amend', '--no-verify', '--raw'),
  );
  const argv = fc.array(token, { minLength: 0, maxLength: 10 })
    .map(rest => ['commit', ...rest]);

  // The invariant, stated independently of the implementation: walking argv
  // left to right, a list flag opens a run that every later positional joins
  // until the next list flag; a boolean flag is transparent; a positional
  // before any list flag belongs to the message, not to a list.
  function partition(args) {
    const out = Object.fromEntries(LIST.map(f => [f, []]));
    let open = null;
    for (const t of args.slice(1)) {
      if (COMMIT_LIST_FLAGS.has(t)) { open = t; continue; }
      if (t.startsWith('--')) continue;
      if (open !== null) out[open].push(t);
    }
    return out;
  }

  test('every positional lands in exactly the run that is open at it, whatever the flag order or count', () => {
    fc.assert(fc.property(argv, (args) => {
      const expected = partition(args);
      for (const flag of LIST) {
        assert.deepStrictEqual(collectListFlagValues(args, flag), expected[flag]);
      }
      return true;
    }), { numRuns: 500 });
  });

  test('no positional after the first list flag is dropped, and none is claimed by both lists', () => {
    fc.assert(fc.property(argv, (args) => {
      const first = args.findIndex((a, i) => i > 0 && COMMIT_LIST_FLAGS.has(a));
      if (first === -1) return true;
      const afterFirst = args.slice(first + 1).filter(a => !a.startsWith('--'));
      const collected = LIST.flatMap(f => collectListFlagValues(args, f));
      // Multiset equality: every such positional is collected exactly once.
      assert.deepStrictEqual([...collected].sort(), [...afterFirst].sort());
      return true;
    }), { numRuns: 500 });
  });

  test('with --files-removed absent the parse is the pre-#4208 slice-to-end parse', () => {
    // The compatibility half: the only intended change to an invocation that
    // never names the second list is that a second list flag now exists.
    const legacy = fc.array(
      fc.oneof(fc.constantFrom('a', 'b', 'c', 'd'), fc.constantFrom('--files'), fc.constantFrom('--amend', '--no-verify')),
      { minLength: 0, maxLength: 8 },
    ).map(rest => ['commit', ...rest]);
    fc.assert(fc.property(legacy, (args) => {
      const i = args.indexOf('--files');
      const old = i === -1 ? [] : args.slice(i + 1).filter(a => !a.startsWith('--'));
      assert.deepStrictEqual(collectListFlagValues(args, '--files'), old);
      return true;
    }), { numRuns: 500 });
  });
});
