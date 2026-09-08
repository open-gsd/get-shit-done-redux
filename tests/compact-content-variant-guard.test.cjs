'use strict';

/**
 * tests/compact-content-variant-guard.test.cjs — ADR-4139, epic #4139, Phase 6 (#4406).
 *
 * Implements the four mechanical checks `.gsd/phase/enhance-4406-lazy-remainder/40-design.md`
 * describes for the variant-swap shape (two independent, complete files; the gate picks which
 * one gets `Read`) covering `gsd-core/workflows/<name>/{modes,steps,templates}/*.compact.md`
 * and `gsd-core/templates/**\/*.compact.md`. This is a DIFFERENT shape from
 * `tests/compact-content-partition-guard.test.cjs` (stream 1's spine+detail partition) — see
 * `tests/helpers/compact-content-variant.cjs` for why disjointness/completeness do not apply
 * here. Template consumer parity (the fifth check) lives in its own file,
 * `tests/compact-content-template-variant-parity.test.cjs`, because it needs a real
 * artifact-generation + real-parser round trip per template rather than a generic file-shape
 * check.
 *
 * Each check gets a RED (deliberately broken) and GREEN (fixed) fixture pair, built against
 * synthetic temp files — never against this repo's own real variants — per this repo's rule
 * that a guard nobody has seen go red is not yet a guard.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanup } = require('./helpers.cjs');
const {
  discoverRegisteredVariants,
  checkRegistration,
  checkReachability,
  checkProtectedContentPreserved,
  checkSizeSmaller,
} = require('./helpers/compact-content-variant.cjs');

describe('compact-content variant guard — real repo state (ADR-4139, Phase 6 #4406)', () => {
  test('check 1 (registration): every .compact.md file has a canonical sibling', () => {
    const pairs = discoverRegisteredVariants();
    const violations = checkRegistration(pairs);
    assert.deepStrictEqual(violations, [], `registration violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('check 2 (reachability): every registered compact variant is named by at least one spine', () => {
    const pairs = discoverRegisteredVariants();
    const violations = checkReachability(pairs);
    assert.deepStrictEqual(violations, [], `reachability violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('check 3 (protected content preserved): every protected block in a canonical file survives in its compact sibling', () => {
    const pairs = discoverRegisteredVariants();
    const violations = checkProtectedContentPreserved(pairs);
    assert.deepStrictEqual(violations, [], `protected-content violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('check 4 (size smaller): every compact file is strictly smaller than its canonical sibling', () => {
    const pairs = discoverRegisteredVariants();
    const violations = checkSizeSmaller(pairs);
    assert.deepStrictEqual(violations, [], `size violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('non-vacuity: this repo actually has registered variant pairs to check', () => {
    const pairs = discoverRegisteredVariants();
    assert.ok(pairs.length > 0, 'expected at least one registered .compact.md pair — an empty result proves nothing');
  });
});

describe('failing-first fixture: check 1 (registration)', () => {
  test('RED — a .compact.md file exists with no canonical sibling (orphan)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-orphan-'));
    try {
      const workflowsDir = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(path.join(workflowsDir, 'bar.compact.md'), 'Compact content with no canonical pair.\n');

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkRegistration(pairs);
      assert.ok(violations.length > 0, 'expected at least one registration violation');
      assert.ok(
        violations.some((v) => v.kind === 'orphan_compact_file' && v.compactPath.endsWith('bar.compact.md')),
        `expected the orphan file to be named: ${JSON.stringify(violations)}`,
      );
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('GREEN — the canonical sibling is added', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-orphan-ok-'));
    try {
      const workflowsDir = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsDir, { recursive: true });
      fs.writeFileSync(path.join(workflowsDir, 'bar.compact.md'), 'Terser.\n');
      fs.writeFileSync(path.join(workflowsDir, 'bar.md'), 'Canonical, longer content.\n');

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkRegistration(pairs);
      assert.deepStrictEqual(violations, []);
    } finally {
      cleanup(tmpRoot);
    }
  });
});

describe('failing-first fixture: check 2 (reachability)', () => {
  test('RED — a registered pair whose compact path is never named by any spine', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-unreached-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows');
      const stepsDir = path.join(workflowsRoot, 'foo', 'steps');
      fs.mkdirSync(stepsDir, { recursive: true });
      fs.writeFileSync(path.join(stepsDir, 'bar.md'), 'Canonical, longer content.\n');
      fs.writeFileSync(path.join(stepsDir, 'bar.compact.md'), 'Terser.\n');
      fs.writeFileSync(path.join(workflowsRoot, 'foo.md'), 'Spine with entirely unrelated content and no path reference of any kind.\n');

      const pairs = discoverRegisteredVariants([workflowsRoot]);
      const violations = checkReachability(pairs, [workflowsRoot]);
      assert.ok(violations.length > 0, 'expected at least one reachability violation');
      assert.ok(
        violations.some((v) => v.kind === 'unreachable_compact_file' && v.compactPath.endsWith('bar.compact.md')),
        `expected the unreached file to be named: ${JSON.stringify(violations)}`,
      );
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('GREEN — the spine names the compact path via the variant-resolution rule', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-unreached-ok-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows');
      const stepsDir = path.join(workflowsRoot, 'foo', 'steps');
      fs.mkdirSync(stepsDir, { recursive: true });
      fs.writeFileSync(path.join(stepsDir, 'bar.md'), 'Canonical, longer content.\n');
      fs.writeFileSync(path.join(stepsDir, 'bar.compact.md'), 'Terser.\n');
      fs.writeFileSync(
        path.join(workflowsRoot, 'foo.md'),
        'Read and execute `gsd-core/workflows/foo/steps/bar.md` (or its `gsd-core/workflows/foo/steps/bar.compact.md` variant per the shared gate).\n',
      );

      const pairs = discoverRegisteredVariants([workflowsRoot]);
      const violations = checkReachability(pairs, [workflowsRoot]);
      assert.deepStrictEqual(violations, []);
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('a vendored path ending in the same filename does not grant false reachability', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-unreached-prefix-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows');
      const stepsDir = path.join(workflowsRoot, 'foo', 'steps');
      fs.mkdirSync(stepsDir, { recursive: true });
      fs.writeFileSync(path.join(stepsDir, 'bar.md'), 'Canonical, longer content.\n');
      fs.writeFileSync(path.join(stepsDir, 'bar.compact.md'), 'Terser.\n');
      fs.writeFileSync(
        path.join(workflowsRoot, 'foo.md'),
        'This mentions vendor/foo/steps/bar.compact.md, a different tree entirely.\n',
      );

      const pairs = discoverRegisteredVariants([workflowsRoot]);
      const violations = checkReachability(pairs, [workflowsRoot]);
      assert.ok(
        violations.some((v) => v.kind === 'unreachable_compact_file'),
        'a prefixed match must not count as reachability',
      );
    } finally {
      cleanup(tmpRoot);
    }
  });
});

describe('failing-first fixture: check 3 (protected content preserved)', () => {
  test('RED — a protected block in the canonical file is absent from the compact sibling', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-protected-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsRoot, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsRoot, 'bar.md'),
        'Intro.\n\n<!-- gsd:protected -->\nNever weaken this exact guardrail sentence.\n\nMore filler text that is safe to shorten elsewhere in this file to pad it out longer than the compact sibling.\n',
      );
      fs.writeFileSync(path.join(workflowsRoot, 'bar.compact.md'), 'Terser intro with the guardrail dropped.\n');

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkProtectedContentPreserved(pairs);
      assert.ok(violations.length > 0, 'expected at least one protected-content violation');
      assert.ok(
        violations.some((v) => v.missing.includes('Never weaken this exact guardrail sentence.')),
        `expected the dropped sentence to be named: ${JSON.stringify(violations)}`,
      );
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('GREEN — the guardrail sentence is preserved verbatim in the compact sibling', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-protected-ok-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsRoot, { recursive: true });
      fs.writeFileSync(
        path.join(workflowsRoot, 'bar.md'),
        'Intro.\n\n<!-- gsd:protected -->\nNever weaken this exact guardrail sentence.\n\nMore filler text that is safe to shorten elsewhere in this file to pad it out longer than the compact sibling.\n',
      );
      fs.writeFileSync(
        path.join(workflowsRoot, 'bar.compact.md'),
        'Terser intro.\n\nNever weaken this exact guardrail sentence.\n',
      );

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkProtectedContentPreserved(pairs);
      assert.deepStrictEqual(violations, []);
    } finally {
      cleanup(tmpRoot);
    }
  });
});

describe('failing-first fixture: check 4 (size smaller)', () => {
  test('RED — a "compact" file the same size as its canonical sibling', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-size-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsRoot, { recursive: true });
      fs.writeFileSync(path.join(workflowsRoot, 'bar.md'), 'x'.repeat(100));
      fs.writeFileSync(path.join(workflowsRoot, 'bar.compact.md'), 'y'.repeat(100));

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkSizeSmaller(pairs);
      assert.ok(violations.length > 0, 'expected at least one size violation');
      assert.ok(
        violations.some((v) => v.kind === 'compact_not_smaller' && v.canonicalSize === 100 && v.compactSize === 100),
        `expected the equal-size pair to be named: ${JSON.stringify(violations)}`,
      );
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('RED — a "compact" file one byte LARGER than its canonical sibling (boundary point)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-size-over-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsRoot, { recursive: true });
      fs.writeFileSync(path.join(workflowsRoot, 'bar.md'), 'x'.repeat(100));
      fs.writeFileSync(path.join(workflowsRoot, 'bar.compact.md'), 'y'.repeat(101));

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkSizeSmaller(pairs);
      assert.ok(violations.length > 0, 'expected at least one size violation');
    } finally {
      cleanup(tmpRoot);
    }
  });

  test('GREEN — a compact file exactly one byte smaller (boundary point)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-variant-size-ok-'));
    try {
      const workflowsRoot = path.join(tmpRoot, 'gsd-core', 'workflows', 'foo', 'steps');
      fs.mkdirSync(workflowsRoot, { recursive: true });
      fs.writeFileSync(path.join(workflowsRoot, 'bar.md'), 'x'.repeat(100));
      fs.writeFileSync(path.join(workflowsRoot, 'bar.compact.md'), 'y'.repeat(99));

      const pairs = discoverRegisteredVariants([path.join(tmpRoot, 'gsd-core', 'workflows')]);
      const violations = checkSizeSmaller(pairs);
      assert.deepStrictEqual(violations, []);
    } finally {
      cleanup(tmpRoot);
    }
  });
});
