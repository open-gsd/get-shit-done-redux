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
  test('quick workflow install hint references get-shit-done-redux (not @gsd-redux/sdk)', () => {
    const content = read('get-shit-done/workflows/quick.md');
    // After #3668: quick.md uses local-first preflight which may reference
    // get-shit-done-redux via npx or npm install -g. Either form is acceptable.
    const referencesGsdRedux = content.includes('npm install -g get-shit-done-redux') ||
      content.includes('npx get-shit-done-redux');
    assert.ok(referencesGsdRedux, 'quick.md install hint must reference get-shit-done-redux');
    assert.ok(!content.includes('npm install -g @gsd-redux/sdk'));
    assert.ok(!content.includes('npm install -g @gsd-build/sdk'));
  });

  test('agent docs no longer reference node_modules/@gsd-redux/sdk/dist/cli.js query fallback', () => {
    const files = [
      'agents/gsd-planner.md',
      'agents/gsd-executor.md',
      'agents/gsd-plan-checker.md',
      'agents/gsd-roadmapper.md',
    ];

    const offenders = files.filter((f) => read(f).includes('@gsd-redux/sdk/dist/cli.js query'));
    assert.deepStrictEqual(offenders, [], `stale @gsd-redux/sdk query fallback references: ${offenders.join(', ')}`);
  });
});
