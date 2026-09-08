'use strict';

/**
 * tests/compact-content-template-variant-parity.test.cjs — ADR-4139, epic #4139, Phase 6 (#4406).
 *
 * Check 5 of `.gsd/phase/enhance-4406-lazy-remainder/40-design.md`'s variant-pair checklist:
 * template consumer parity. Only two `gsd-core/templates/**` files got a `.compact.md` variant
 * wired to a genuine runtime `Read` this phase — `summary.md` and `user-setup.md` (see
 * `40-design.md`'s "a size-only candidate list was also the wrong test here" for why `spec.md`
 * was dropped and why `summary.md`'s wiring is scoped to one call site only).
 *
 * The actual guarantee that makes compacting these templates safe: downstream consumers parse
 * the GENERATED artifact (a real SUMMARY.md / USER-SETUP.md an agent wrote), never the template
 * file itself. So the only way a compact variant could silently break a real consumer is if it
 * changed the artifact's OUTPUT-FORMAT CONTRACT — the `## File Template` fenced block — relative
 * to the canonical file. Both compact variants were authored to leave that block byte-identical
 * and compact only the surrounding illustrative material (examples, guidelines prose). This test
 * proves that invariant directly, rather than assuming it from the authoring process, and then
 * proves the shared contract really is what the one real deterministic consumer
 * (`gsd-core/bin/lib/coverage.cjs`'s `classifyContent`, backing `gsd-tools uat classify-coverage`)
 * accepts and classifies correctly.
 *
 * `user-setup.md` has no deterministic content parser anywhere in this repo (confirmed by
 * repo-wide search — the only "consumption" beyond an agent `Read` is a human `grep -r
 * "USER-SETUP" .planning/` search over filenames, insensitive to internal structure). Its parity
 * check is therefore limited to the File Template identity assertion; there is no real parser
 * round trip to run against it.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { classifyContent } = require(path.join(ROOT, 'gsd-core', 'bin', 'lib', 'coverage.cjs'));

/**
 * Extract the fenced code block immediately following a `## File Template` heading.
 * Returns the block's inner content (without the opening/closing fences), or null if
 * the heading or a following fence isn't found.
 * @param {string} content
 * @returns {string | null}
 */
function extractFileTemplateBlock(content) {
  const headingIdx = content.indexOf('## File Template');
  if (headingIdx === -1) return null;
  const fenceStart = content.indexOf('```', headingIdx);
  if (fenceStart === -1) return null;
  const afterOpenFence = content.indexOf('\n', fenceStart) + 1;
  const fenceEnd = content.indexOf('\n```', afterOpenFence);
  if (fenceEnd === -1) return null;
  return content.slice(afterOpenFence, fenceEnd);
}

describe('template consumer parity — File Template contract identity', () => {
  test('summary.md and summary.compact.md share a byte-identical File Template block', () => {
    const canonical = fs.readFileSync(path.join(ROOT, 'gsd-core', 'templates', 'summary.md'), 'utf8');
    const compact = fs.readFileSync(path.join(ROOT, 'gsd-core', 'templates', 'summary.compact.md'), 'utf8');
    const canonicalBlock = extractFileTemplateBlock(canonical);
    const compactBlock = extractFileTemplateBlock(compact);
    assert.ok(canonicalBlock, 'canonical summary.md must have an extractable File Template block');
    assert.ok(compactBlock, 'summary.compact.md must have an extractable File Template block');
    assert.strictEqual(
      compactBlock,
      canonicalBlock,
      'summary.compact.md must not alter the output-format contract any downstream consumer parses',
    );
  });

  test('user-setup.md and user-setup.compact.md share a byte-identical File Template block', () => {
    const canonical = fs.readFileSync(path.join(ROOT, 'gsd-core', 'templates', 'user-setup.md'), 'utf8');
    const compact = fs.readFileSync(path.join(ROOT, 'gsd-core', 'templates', 'user-setup.compact.md'), 'utf8');
    const canonicalBlock = extractFileTemplateBlock(canonical);
    const compactBlock = extractFileTemplateBlock(compact);
    assert.ok(canonicalBlock, 'canonical user-setup.md must have an extractable File Template block');
    assert.ok(compactBlock, 'user-setup.compact.md must have an extractable File Template block');
    assert.strictEqual(
      compactBlock,
      canonicalBlock,
      'user-setup.compact.md must not alter the output-format contract',
    );
  });
});

describe('template consumer parity — real classify-coverage round trip (summary.md)', () => {
  const REALISTIC_SUMMARY = `---
phase: 07-example
plan: 01
subsystem: testing
tags: [example]
requires: []
provides: []
affects: []
coverage:
  - id: D1
    description: "Deterministic deliverable"
    verification:
      - kind: unit
        ref: "tests/example.test.cjs#does the thing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deliverable needing a human"
    verification: []
    human_judgment: true
    rationale: "UI screenshot review"
duration: 5min
completed: 2026-01-01
status: complete
---

# Phase 7: Example Summary

**A deterministic deliverable and a human-judgment deliverable.**
`;

  test('a SUMMARY.md built from the shared File Template coverage schema classifies correctly', () => {
    const result = classifyContent(REALISTIC_SUMMARY, '07-example-01-SUMMARY.md');
    assert.strictEqual(result.mode, 'coverage');
    assert.strictEqual(result.errors.length, 0, `expected no validation errors: ${JSON.stringify(result.errors)}`);
    assert.strictEqual(result.auto_passed.length, 1, 'D1 (human_judgment:false, all verification pass) must auto-pass');
    assert.strictEqual(result.present.length, 1, 'D2 (human_judgment:true) must route to a human');
    assert.strictEqual(result.all_auto_covered, false);
  });

  test('boundary: a legacy SUMMARY.md with no coverage block still classifies (byte-identical fallback)', () => {
    const legacy = REALISTIC_SUMMARY.replace(/coverage:[\s\S]*?rationale: "UI screenshot review"\n/, '');
    const result = classifyContent(legacy, '07-example-01-SUMMARY.md');
    assert.strictEqual(result.mode, 'legacy');
  });

  test('negative: a coverage block that fails validation is presented to a human, never silently auto-passed', () => {
    const malformed = REALISTIC_SUMMARY.replace('human_judgment: false', '');
    const result = classifyContent(malformed, '07-example-01-SUMMARY.md');
    assert.strictEqual(result.mode, 'coverage');
    assert.ok(
      result.present.some((p) => p.id === 'D1'),
      'D1 missing human_judgment must route to present, never auto-pass',
    );
  });
});
