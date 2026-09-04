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
