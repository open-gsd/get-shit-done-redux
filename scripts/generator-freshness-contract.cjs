'use strict';

const GENERATOR_FRESHNESS_REASON = Object.freeze({
  FRESH: 'fresh',
  STALE: 'stale',
  MISSING_SOURCE: 'missing_source',
  MISSING_GENERATED: 'missing_generated',
});

/**
 * Compare source and generated artifacts by content hash-equivalence contract.
 * @param {{source?:string, generated?:string}} input
 * @returns {{ok:boolean, reason:string}}
 */
function evaluateGeneratorFreshness(input) {
  const source = input?.source;
  const generated = input?.generated;

  if (typeof source !== 'string') {
    return { ok: false, reason: GENERATOR_FRESHNESS_REASON.MISSING_SOURCE };
  }
  if (typeof generated !== 'string') {
    return { ok: false, reason: GENERATOR_FRESHNESS_REASON.MISSING_GENERATED };
  }
  if (source === generated) {
    return { ok: true, reason: GENERATOR_FRESHNESS_REASON.FRESH };
  }
  return { ok: false, reason: GENERATOR_FRESHNESS_REASON.STALE };
}

module.exports = { GENERATOR_FRESHNESS_REASON, evaluateGeneratorFreshness };
