#!/usr/bin/env node
/**
 * Freshness check for validate.generated.cjs.
 *
 * Regenerates the expected CJS content in-memory (without writing to disk) and
 * compares it to the committed file. Exits 0 if they match, 1 if stale.
 *
 * Uses the same pattern as check-phase-lifecycle-policy-fresh.mjs: imports
 * buildValidateCjs() from the generator directly.
 *
 * Run: node sdk/scripts/check-validate-fresh.mjs
 * (Requires sdk/dist to be built first — `npm run build` in sdk/.)
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #6 (open-gsd/get-shit-done-redux)
 *   - PR #154 (issue #4) — generator pattern precedent
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Import the generator function directly (avoids duplicating logic).
const { buildValidateCjs } = await import('./gen-validate.mjs');

const expected = await buildValidateCjs();

const committedPath = resolve(here, '..', '..', 'get-shit-done', 'bin', 'lib', 'validate.generated.cjs');
const committed = await readFile(committedPath, 'utf-8');

if (expected === committed) {
  console.log('validate.generated.cjs is fresh');
  process.exit(0);
} else {
  console.error('validate.generated.cjs is STALE.');
  console.error('Regenerate: cd sdk && npm run gen:validate');
  process.exit(1);
}
