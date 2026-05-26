const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  GENERATOR_FRESHNESS_REASON,
  evaluateGeneratorFreshness,
} = require('../scripts/generator-freshness-contract.cjs');

describe('generator freshness contract module', () => {
  test('fresh when source and generated match exactly', () => {
    const out = evaluateGeneratorFreshness({ source: 'abc', generated: 'abc' });
    assert.deepStrictEqual(out, { ok: true, reason: GENERATOR_FRESHNESS_REASON.FRESH });
  });

  test('stale when source and generated differ', () => {
    const out = evaluateGeneratorFreshness({ source: 'abc', generated: 'abd' });
    assert.deepStrictEqual(out, { ok: false, reason: GENERATOR_FRESHNESS_REASON.STALE });
  });

  test('missing_source when source omitted', () => {
    const out = evaluateGeneratorFreshness({ generated: 'abc' });
    assert.deepStrictEqual(out, { ok: false, reason: GENERATOR_FRESHNESS_REASON.MISSING_SOURCE });
  });

  test('missing_generated when generated omitted', () => {
    const out = evaluateGeneratorFreshness({ source: 'abc' });
    assert.deepStrictEqual(out, { ok: false, reason: GENERATOR_FRESHNESS_REASON.MISSING_GENERATED });
  });
});
