'use strict';

/**
 * Regression coverage for #4460 (discovered blocking this PR's own Windows
 * CI, unrelated to this PR's actual diff -- fixed inline per this repo's
 * no-defer policy): scripts/check-env.cjs's npm-version check used to
 * collapse every spawnSync failure mode into one message, "npm binary not
 * found on PATH" -- including a TIMEOUT under CI load, which looks
 * identical to a genuine ENOENT (status stays null, stdout stays empty
 * either way). describeNpmVersionCheckFailure is the extracted, pure
 * reason-selection logic; kept in scripts/lib/ (not scripts/check-env.cjs
 * itself, which runs its CLI unconditionally on require) so it can be
 * required directly here without triggering a real environment check.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { describeNpmVersionCheckFailure } = require('../scripts/lib/npm-version-check-diagnosis.cjs');

describe('describeNpmVersionCheckFailure (#4460)', () => {
  test('a genuine ENOENT (npm truly absent) reports the original message', () => {
    const spawnResult = { status: null, stdout: '', signal: null, error: Object.assign(new Error('spawnSync npm.cmd ENOENT'), { code: 'ENOENT' }) };
    assert.equal(
      describeNpmVersionCheckFailure(spawnResult, null, 10_000),
      'npm binary not found on PATH',
    );
  });

  test('a signal-killed spawn (the timeout case) is reported as a timeout, not a missing binary', () => {
    const spawnResult = { status: null, stdout: '', signal: 'SIGTERM', error: null };
    const reason = describeNpmVersionCheckFailure(spawnResult, null, 10_000);
    assert.match(reason, /killed \(signal SIGTERM\)/);
    assert.match(reason, /10000ms timeout under CI load/);
    assert.doesNotMatch(reason, /^npm binary not found on PATH$/);
  });

  test('a non-zero exit with no stdout is reported with the actual exit code', () => {
    const spawnResult = { status: 1, stdout: '', signal: null, error: null };
    assert.equal(
      describeNpmVersionCheckFailure(spawnResult, null, 10_000),
      'npm --version exited 1 with no usable output',
    );
  });

  test('spawnSync itself throwing (not just returning a failure result) is reported with the thrown message', () => {
    const thrown = new Error('EACCES: permission denied');
    assert.equal(
      describeNpmVersionCheckFailure(null, thrown, 10_000),
      'npm --version could not be spawned: EACCES: permission denied',
    );
  });

  test('no spawn result and no thrown error (defensive default) falls back to the original message', () => {
    assert.equal(
      describeNpmVersionCheckFailure(null, null, 10_000),
      'npm binary not found on PATH',
    );
  });
});
