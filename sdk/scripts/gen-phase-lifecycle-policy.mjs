#!/usr/bin/env node
/**
 * Generator for the Phase Lifecycle Policy CJS artifact.
 *
 * Imports the compiled ESM output from sdk/dist/query/phase-lifecycle-policy.js,
 * captures pure helper functions via Function.prototype.toString(), then emits
 * get-shit-done/bin/lib/phase-lifecycle-policy.generated.cjs.
 *
 * All functions in phase-lifecycle-policy.ts are pure transforms — no I/O,
 * no async, no filesystem operations. They are directly serializable via
 * Function.prototype.toString(). The only external dependencies are:
 *   - GSDError / ErrorClassification (from ../errors.js) → replaced with a
 *     lightweight local throw-Error stub
 *   - escapeRegex (from ./helpers.js) → inlined from compiled source text
 *
 * This is the "I/O adapter pattern" from ADR-3524 Section 4 applied to pure
 * helpers: pure logic goes into a Shared Module; the generated CJS artifact
 * provides the same API surface with the SDK's error model swapped out for
 * plain throws that CJS callers can catch and delegate to error().
 *
 * Run:    cd sdk && npm run gen:phase-lifecycle-policy
 * Check:  node sdk/scripts/check-phase-lifecycle-policy-fresh.mjs
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #4 (open-gsd/get-shit-done-redux)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BANNER = `'use strict';

/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: sdk/src/query/phase-lifecycle-policy.ts
 * Regenerate: cd sdk && npm run gen:phase-lifecycle-policy
 *
 * Phase Lifecycle Policy — pure computation helpers for phase directory naming,
 * roadmap entry generation, decimal-phase management, and ID computation.
 * No I/O. No async. No filesystem operations.
 *
 * I/O adapter pattern (ADR-3524 §4): pure transforms extracted from the SDK;
 * GSDError is replaced with plain throws that CJS callers can catch.
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #4 (open-gsd/get-shit-done-redux)
 */

`;

/**
 * Extract escapeRegex from compiled helpers.js source text.
 * Used by collectDecimalSuffixesFromDirNames and collectDecimalSuffixesFromRoadmap.
 */
function extractEscapeRegexBody(helpersSource) {
  const marker = 'function escapeRegex(';
  const start = helpersSource.indexOf(marker);
  if (start === -1) throw new Error('Could not find escapeRegex in compiled helpers.js');
  const braceOpen = helpersSource.indexOf('{', start);
  let depth = 0;
  let i = braceOpen;
  for (; i < helpersSource.length; i++) {
    if (helpersSource[i] === '{') depth++;
    else if (helpersSource[i] === '}') { depth--; if (depth === 0) break; }
  }
  return helpersSource.slice(start, i + 1);
}

export async function buildPhaseLifecyclePolicyCjs() {
  const distUrl = new URL('../dist/query/phase-lifecycle-policy.js', import.meta.url);
  const helpersUrl = new URL('../dist/query/helpers.js', import.meta.url);

  const {
    assertNoNullBytes,
    assertSafePhaseDirName,
    assertSafeProjectCode,
    generatePhaseSlug,
    parseMultiwordArg,
    extractOneLinerFromBody,
    scanSequentialMaxPhaseFromMilestone,
    scanSequentialMaxPhaseFromDirs,
    computeNextSequentialPhaseId,
    computePhaseDirectory,
    buildPhaseRoadmapEntry,
    collectDecimalSuffixesFromDirNames,
    collectDecimalSuffixesFromRoadmap,
    computeNextDecimalPhase,
  } = await import(distUrl.href);

  const helpersSource = await readFile(fileURLToPath(helpersUrl), 'utf-8');
  const escapeRegexBody = extractEscapeRegexBody(helpersSource);

  // Stub for GSDError — throws plain Error so CJS callers can catch and delegate
  // to error() (process.exit) as needed. The ErrorClassification enum values are
  // unused at runtime in the generated artifact; they exist only for TypeScript typing.
  const gsdErrorStub = `// Lightweight stub replacing sdk/src/errors.js GSDError.
// CJS callers that need to translate to process.exit(1) should catch these.
class GSDError extends Error {
  constructor(message, classification) {
    super(message);
    this.name = 'GSDError';
    this.classification = classification;
  }
}
// ErrorClassification values used by policy functions
const ErrorClassification = { Validation: 'Validation', Internal: 'Internal' };`;

  const parts = [
    BANNER.trimEnd(),
    '',
    gsdErrorStub,
    '',
    '// escapeRegex — inlined from sdk/dist/query/helpers.js',
    escapeRegexBody,
    '',
    assertNoNullBytes.toString(),
    '',
    assertSafePhaseDirName.toString(),
    '',
    assertSafeProjectCode.toString(),
    '',
    generatePhaseSlug.toString(),
    '',
    parseMultiwordArg.toString(),
    '',
    extractOneLinerFromBody.toString(),
    '',
    scanSequentialMaxPhaseFromMilestone.toString(),
    '',
    scanSequentialMaxPhaseFromDirs.toString(),
    '',
    computeNextSequentialPhaseId.toString(),
    '',
    computePhaseDirectory.toString(),
    '',
    buildPhaseRoadmapEntry.toString(),
    '',
    collectDecimalSuffixesFromDirNames.toString(),
    '',
    collectDecimalSuffixesFromRoadmap.toString(),
    '',
    computeNextDecimalPhase.toString(),
    '',
    `module.exports = {
  GSDError,
  assertNoNullBytes,
  assertSafePhaseDirName,
  assertSafeProjectCode,
  generatePhaseSlug,
  parseMultiwordArg,
  extractOneLinerFromBody,
  scanSequentialMaxPhaseFromMilestone,
  scanSequentialMaxPhaseFromDirs,
  computeNextSequentialPhaseId,
  computePhaseDirectory,
  buildPhaseRoadmapEntry,
  collectDecimalSuffixesFromDirNames,
  collectDecimalSuffixesFromRoadmap,
  computeNextDecimalPhase,
};`,
    '',
  ];

  return parts.join('\n');
}

async function main() {
  const content = await buildPhaseLifecyclePolicyCjs();
  const outPath = fileURLToPath(
    new URL('../../get-shit-done/bin/lib/phase-lifecycle-policy.generated.cjs', import.meta.url),
  );
  await writeFile(outPath, content, 'utf-8');
  console.log(`Written: ${outPath}`);
}

// Only run main() when this file is the entry point.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
