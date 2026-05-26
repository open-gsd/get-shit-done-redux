'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRelativeSpecifiers,
  pickAffectedTests,
  shouldRunFullSuite,
  resolveBaseRef,
} = require('../scripts/affected-tests-lib.cjs');

test('parseRelativeSpecifiers captures local require/import paths', () => {
  const source = `
    const a = require('./alpha.cjs');
    const b = require("node:assert/strict");
    import c from "../beta.js";
    import d from "external-lib";
  `;
  const out = parseRelativeSpecifiers(source);
  assert.deepEqual(out, ['./alpha.cjs', '../beta.js']);
});

test('shouldRunFullSuite true when critical paths change', () => {
  assert.equal(shouldRunFullSuite(['package-lock.json']), true);
  assert.equal(shouldRunFullSuite(['.github/workflows/test.yml']), true);
  assert.equal(shouldRunFullSuite(['tests/foo.test.cjs']), false);
});

test('pickAffectedTests includes direct test changes and reverse-index matches', () => {
  const allTests = [
    'tests/alpha.test.cjs',
    'tests/install.test.cjs',
    'tests/release-tarball-smoke.install.test.cjs',
  ];
  const reverse = new Map([
    ['bin/install.js', new Set(['tests/install.test.cjs'])],
  ]);
  const selected = pickAffectedTests(
    ['tests/alpha.test.cjs', 'bin/install.js'],
    allTests,
    reverse,
    ['tests/release-tarball-smoke.install.test.cjs'],
  );
  assert.deepEqual(selected, [
    'tests/alpha.test.cjs',
    'tests/install.test.cjs',
    'tests/release-tarball-smoke.install.test.cjs',
  ]);
});

test('pickAffectedTests falls back to smoke test when no matches found', () => {
  const allTests = ['tests/release-tarball-smoke.install.test.cjs'];
  const selected = pickAffectedTests(
    ['docs/README.md'],
    allTests,
    new Map(),
    ['tests/release-tarball-smoke.install.test.cjs'],
  );
  assert.deepEqual(selected, ['tests/release-tarball-smoke.install.test.cjs']);
});

test('resolveBaseRef prefers explicit env override', () => {
  const original = {
    GSD_AFFECTED_BASE: process.env.GSD_AFFECTED_BASE,
    GITHUB_BASE_REF: process.env.GITHUB_BASE_REF,
  };
  try {
    process.env.GSD_AFFECTED_BASE = 'origin/next';
    process.env.GITHUB_BASE_REF = 'main';
    assert.equal(resolveBaseRef(), 'origin/next');

    delete process.env.GSD_AFFECTED_BASE;
    process.env.GITHUB_BASE_REF = 'next';
    assert.equal(resolveBaseRef(), 'origin/next');

    delete process.env.GSD_AFFECTED_BASE;
    delete process.env.GITHUB_BASE_REF;
    assert.equal(resolveBaseRef(), 'origin/main');
  } finally {
    if (original.GSD_AFFECTED_BASE === undefined) delete process.env.GSD_AFFECTED_BASE;
    else process.env.GSD_AFFECTED_BASE = original.GSD_AFFECTED_BASE;
    if (original.GITHUB_BASE_REF === undefined) delete process.env.GITHUB_BASE_REF;
    else process.env.GITHUB_BASE_REF = original.GITHUB_BASE_REF;
  }
});
