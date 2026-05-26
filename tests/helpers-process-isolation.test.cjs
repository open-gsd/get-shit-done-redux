const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { withIsolatedProcessState } = require('./helpers.cjs');

describe('withIsolatedProcessState', () => {
  test('restores env, cwd, and exitCode after callback', () => {
    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    const originalMarker = process.env.GSD_TEST_ISOLATION_MARKER;

    const tempCwd = path.dirname(originalCwd);

    withIsolatedProcessState(() => {
      process.env.GSD_TEST_ISOLATION_MARKER = 'changed';
      process.exitCode = 73;
      process.chdir(tempCwd);
    });

    assert.strictEqual(process.cwd(), originalCwd);
    assert.strictEqual(process.exitCode, originalExitCode);
    assert.strictEqual(process.env.GSD_TEST_ISOLATION_MARKER, originalMarker);
  });

  test('restores state even when callback throws', () => {
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;

    assert.throws(() => {
      withIsolatedProcessState(() => {
        process.env.PATH = '';
        process.chdir(path.dirname(originalCwd));
        throw new Error('boom');
      });
    }, /boom/);

    assert.strictEqual(process.cwd(), originalCwd);
    assert.strictEqual(process.env.PATH, originalPath);
  });
});
