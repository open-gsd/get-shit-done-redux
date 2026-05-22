'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('bug #3091: sdk install guidance and agent fallbacks use query-capable CLI', () => {
  test('quick workflow install hint references @opengsd/get-shit-done-redux (not @opengsd/gsd-sdk)', () => {
    const content = read('get-shit-done/workflows/quick.md');
    // After #3668: quick.md uses local-first preflight which references
    // @opengsd/get-shit-done-redux via npx for the --local fallback.
    const referencesGsdRedux = content.includes('npm install -g @opengsd/get-shit-done-redux') ||
      content.includes('npx @opengsd/get-shit-done-redux');
    assert.ok(referencesGsdRedux, 'quick.md install hint must reference @opengsd/get-shit-done-redux');
    assert.ok(!content.includes('@gsd-redux/sdk'));
    assert.ok(!content.includes('@gsd-build/sdk'));
    assert.ok(!content.includes('npm install -g get-shit-done-redux'));
    assert.ok(!content.includes('npx get-shit-done-redux@'));
  });

  test('agent docs no longer reference node_modules/@opengsd/gsd-sdk/dist/cli.js query fallback', () => {
    const files = [
      'agents/gsd-planner.md',
      'agents/gsd-executor.md',
      'agents/gsd-plan-checker.md',
      'agents/gsd-roadmapper.md',
    ];

    const offenders = files.filter((f) => read(f).includes('@opengsd/gsd-sdk/dist/cli.js query'));
    assert.deepStrictEqual(offenders, [], `stale @opengsd/gsd-sdk query fallback references: ${offenders.join(', ')}`);
  });
});
