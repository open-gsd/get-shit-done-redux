#!/usr/bin/env node
/**
 * Generator for the Phase Query CJS artifact.
 *
 * Imports the compiled ESM output from sdk/dist/query/phase.js,
 * captures pure helper functions via Function.prototype.toString(), then emits
 * get-shit-done/bin/lib/phase.generated.cjs.
 *
 * Exported functions from sdk/src/query/phase.ts have two categories:
 *   (a) Pure helpers (no I/O): isCanonicalPlanFile, describeNonCanonicalPlans
 *       → serializable directly via Function.prototype.toString()
 *   (b) Async query handlers (findPhase, findPhaseByNumber, phasePlanIndex)
 *       → I/O stays per-side per ADR-3524 §4; NOT included in the generated artifact
 *
 * The phase.cjs shim continues to provide its own CJS implementations of the
 * async handlers. The generated artifact provides the shared pure helpers so
 * that phase.cjs can delegate to them rather than maintaining duplicates.
 *
 * Run:    cd sdk && npm run gen:phase
 * Check:  node sdk/scripts/check-phase-fresh.mjs
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #4 (open-gsd/get-shit-done-redux)
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BANNER = `'use strict';

/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: sdk/src/query/phase.ts
 * Regenerate: cd sdk && npm run gen:phase
 *
 * Phase Query Module — pure helper functions shared between the CJS CLI and SDK.
 * No I/O. No async. No filesystem operations.
 *
 * Scope: isCanonicalPlanFile, describeNonCanonicalPlans.
 * Async query handlers (findPhase, phasePlanIndex) are I/O-bound and remain
 * per-side per ADR-3524 §4.
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #4 (open-gsd/get-shit-done-redux)
 */

`;

export async function buildPhaseCjs() {
  const distUrl = new URL('../dist/query/phase.js', import.meta.url);

  const {
    isCanonicalPlanFile,
    describeNonCanonicalPlans,
  } = await import(distUrl.href);

  // isCanonicalPlanFile is a const arrow function; .toString() gives the arrow body
  const isCanonicalPlanFileBody = `const isCanonicalPlanFile = ${isCanonicalPlanFile.toString()};`;

  // The PLAN_OUTLINE_RE and PLAN_PRE_BOUNCE_RE constants are closed over by
  // describeNonCanonicalPlans via the looksLikePlanFile helper. Since these are
  // module-scope in the compiled ESM, we need to provide them here.
  const preamble = [
    `// Regex constants closed over by describeNonCanonicalPlans (from phase.js module scope)`,
    `const PLAN_OUTLINE_RE = /-PLAN-OUTLINE\\.md$/i;`,
    `const PLAN_PRE_BOUNCE_RE = /-PLAN.*\\.pre-bounce\\.md$/i;`,
    `const looksLikePlanFile = (f) =>`,
    `  /\\.md$/i.test(f)`,
    `  && /PLAN/i.test(f)`,
    `  && !PLAN_OUTLINE_RE.test(f)`,
    `  && !PLAN_PRE_BOUNCE_RE.test(f);`,
  ].join('\n');

  const parts = [
    BANNER.trimEnd(),
    '',
    isCanonicalPlanFileBody,
    '',
    preamble,
    '',
    describeNonCanonicalPlans.toString(),
    '',
    `module.exports = {`,
    `  isCanonicalPlanFile,`,
    `  describeNonCanonicalPlans,`,
    `};`,
    '',
  ];

  return parts.join('\n');
}

async function main() {
  const content = await buildPhaseCjs();
  const outPath = fileURLToPath(
    new URL('../../get-shit-done/bin/lib/phase.generated.cjs', import.meta.url),
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
