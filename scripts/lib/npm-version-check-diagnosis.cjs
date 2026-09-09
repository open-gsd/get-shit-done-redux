'use strict';

/**
 * #4460: distinguishes WHY scripts/check-env.cjs's npm-version check's
 * execNpm(['--version']) (the canonical OS-shell-projection seam,
 * src/shell-command-projection.cts) produced no usable output, instead of
 * collapsing every case into "npm binary not found on PATH" -- a message
 * that used to fire identically for a genuinely-missing binary AND for a
 * spawnSync TIMEOUT under CI load (exitCode stays non-zero, stdout stays
 * empty, either way). Root-caused live: an unrelated PR's Windows CI shard
 * failed this check twice in a row while running ~51 concurrent test
 * files; npm.cmd's own cold-start plausibly exceeded the check's original
 * 10s window under that contention, and the misleading message made a real
 * timeout indistinguishable from npm actually being absent.
 *
 * Uses `result.timedOut` (execNpm's canonical, cross-platform-correct
 * timeout predicate -- `error.code === 'ETIMEDOUT'`, per
 * shell-command-projection.cts's isSpawnTimeout docstring) rather than
 * checking `result.signal === 'SIGTERM'` directly: that check is documented
 * there as platform-fragile, with a specifically-called-out risk of a false
 * NEGATIVE on Windows -- the exact platform this failure was discovered on.
 *
 * Kept out of scripts/check-env.cjs itself (which runs its CLI unconditionally
 * on require, with no `require.main === module` guard) so this pure logic
 * can be required directly by tests without triggering a real environment
 * check.
 *
 * @param {import('../../src/shell-command-projection.cts').SpawnResultOutput} result
 * @returns {string}
 */
function describeNpmVersionCheckFailure(result) {
  if (result.error && result.error.code === 'ENOENT') {
    return 'npm binary not found on PATH';
  }
  if (result.timedOut) {
    return `npm --version timed out under CI load -- not a missing binary`;
  }
  if (result.exitCode !== 0) {
    return `npm --version exited ${result.exitCode} with no usable output`;
  }
  return 'npm binary not found on PATH';
}

module.exports = { describeNpmVersionCheckFailure };
