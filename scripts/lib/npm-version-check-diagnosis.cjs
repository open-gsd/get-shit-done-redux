'use strict';

/**
 * #4460: distinguishes WHY scripts/check-env.cjs's npm-version check's
 * `spawnSync(npmCmd, ['--version'], ...)` produced no usable output,
 * instead of collapsing every case into "npm binary not found on PATH" -- a
 * message that used to fire identically for a genuinely-missing binary AND
 * for a spawnSync TIMEOUT under CI load (status stays null, stdout stays
 * empty, either way). Root-caused live: an unrelated PR's Windows CI shard
 * failed this check while running 51 concurrent test files; npm.cmd's own
 * cold-start plausibly exceeded the 10s window under that contention, and
 * the misleading message made a real timeout indistinguishable from npm
 * actually being absent.
 *
 * Kept out of scripts/check-env.cjs itself (which runs its CLI unconditionally
 * on require, with no `require.main === module` guard) so this pure logic
 * can be required directly by tests without triggering a real environment
 * check as a side effect.
 *
 * @param {import('child_process').SpawnSyncReturns<string>|null} spawnResult
 * @param {Error|null} spawnThrew
 * @param {number} timeoutMs
 * @returns {string}
 */
function describeNpmVersionCheckFailure(spawnResult, spawnThrew, timeoutMs) {
  if (spawnResult && spawnResult.error && spawnResult.error.code === 'ENOENT') {
    return 'npm binary not found on PATH';
  }
  if (spawnResult && spawnResult.signal) {
    return `npm --version was killed (signal ${spawnResult.signal}) -- likely the ${timeoutMs}ms timeout under CI load, not a missing binary`;
  }
  if (spawnResult && spawnResult.status != null && spawnResult.status !== 0) {
    return `npm --version exited ${spawnResult.status} with no usable output`;
  }
  if (spawnThrew) {
    return `npm --version could not be spawned: ${spawnThrew.message}`;
  }
  return 'npm binary not found on PATH';
}

module.exports = { describeNpmVersionCheckFailure };
