'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci-test-scope.cjs');

function scopeFor(files) {
  const r = spawnSync(process.execPath, [SCRIPT, '--files', files.join(' ')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  return JSON.parse(r.stdout);
}

describe('ci-test-scope.cjs', () => {
  test('docs-only changes do not request code matrix work', () => {
    const result = scopeFor(['docs/usage.md']);
    assert.strictEqual(result.code_changed, false);
    assert.strictEqual(result.full_matrix, false);
    assert.deepStrictEqual(result.targeted_tests, []);
    assert.deepStrictEqual(result.windows_tests, []);
  });

  test('workflow changes request full matrix and workflow contract tests', () => {
    const result = scopeFor(['.github/workflows/test.yml']);
    assert.strictEqual(result.code_changed, true);
    assert.strictEqual(result.full_matrix, true);
    assert.ok(result.targeted_tests.includes('tests/workflow-shell-pinning.test.cjs'));
    assert.ok(result.targeted_tests.includes('tests/release-tarball-smoke-workflow.test.cjs'));
    assert.ok(result.windows_tests.includes('tests/workflow-shell-pinning.test.cjs'));
  });

  test('command changes request command tests without full parity matrix', () => {
    const result = scopeFor(['commands/gsd/plan-phase.md']);
    assert.strictEqual(result.code_changed, true);
    assert.strictEqual(result.full_matrix, false);
    assert.ok(result.targeted_tests.includes('tests/command-contract.test.cjs'));
    assert.ok(result.targeted_tests.includes('tests/commands.test.cjs'));
  });

  test('changed test files are selected directly', () => {
    const result = scopeFor(['tests/run-tests-harness.test.cjs']);
    assert.strictEqual(result.code_changed, true);
    assert.ok(result.targeted_tests.includes('tests/run-tests-harness.test.cjs'));
  });

  test('installer-sensitive changes request full matrix and install tests', () => {
    const result = scopeFor(['bin/gsd']);
    assert.strictEqual(result.code_changed, true);
    assert.strictEqual(result.full_matrix, true);
    assert.ok(result.targeted_tests.includes('tests/install.test.cjs'));
    assert.ok(result.targeted_tests.includes('tests/release-tarball-smoke.install.test.cjs'));
  });

  test('missing required CLI values fail with usage', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--files'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /--files requires a value/);
    assert.match(r.stderr, /Usage:/);
  });
});
