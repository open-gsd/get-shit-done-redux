#!/usr/bin/env node
/**
 * Generator for the Phase Lifecycle CJS artifact.
 *
 * Emits get-shit-done/bin/lib/phase-lifecycle.generated.cjs which provides
 * the pure-computation functions extracted from sdk/src/query/phase-lifecycle.ts.
 *
 * The phase-lifecycle.ts module contains mutation handlers (phaseAdd, phaseInsert,
 * phaseRemove, phaseComplete) that are inherently async and I/O-bound. Per
 * ADR-3524 Section 4: "I/O stays per-side." These mutation handlers are NOT generated.
 *
 * What IS generated: the pure-computation logic used by phaseComplete that was
 * the root cause of issue #4:
 *   - deriveProgressFromRoadmap(roadmapContent): computes completed_phases,
 *     total_phases, total_plans from ROADMAP progress table content.
 *     This is the idempotency fix: deriving from ROADMAP instead of blind +1.
 *   - clampPercent(completed, total): percent computation with 100 ceiling.
 *
 * The CJS shim (bin/lib/phase.cjs) calls these pure functions with
 * synchronously-read ROADMAP content. The SDK handler calls them with
 * asynchronously-read content. Same logic, different I/O adapters.
 *
 * I/O adapter pattern from ADR-3524 Section 4 applied to mutation helpers:
 * pure computation is shared; each side supplies its own I/O.
 *
 * Run:    cd sdk && npm run gen:phase-lifecycle
 * Check:  node sdk/scripts/check-phase-lifecycle-fresh.mjs
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
 * Source: sdk/src/query/phase-lifecycle.ts
 * Regenerate: cd sdk && npm run gen:phase-lifecycle
 *
 * Phase Lifecycle Pure Helpers — pure-computation functions extracted from
 * the phase-lifecycle SDK handler.
 *
 * I/O adapter pattern (ADR-3524 Section 4): each side supplies its own I/O
 * (sync readFileSync for CJS, async readFile for SDK); the pure computation
 * logic is shared via this generated artifact.
 *
 * Scope:
 *   - deriveProgressFromRoadmap(roadmapContent): count Complete rows => idempotent
 *   - clampPercent(completed, total): percent with 100 ceiling
 *
 * These two functions are the root-cause fix for issue #4.
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #4 (open-gsd/get-shit-done-redux)
 */

`;

// ─── Pure functions defined here so they can be serialized via .toString() ───
//
// These are hand-authored pure functions (not extracted from compiled SDK output
// via .toString()) because the SDK versions are embedded inside async closures
// and cannot be cleanly extracted. The logic is a direct transcription of the
// SDK's "Root cause 1 fix" block in phase-lifecycle.ts (~line 1644).
//
// IMPORTANT: These functions must remain pure (no I/O, no closures over module
// state) so that .toString() serialization to CJS works correctly.

/**
 * Derive completed_phases, total_phases, and total_plans from ROADMAP content.
 *
 * Root cause fix for issue #4: instead of blindly incrementing Completed Phases
 * by 1 on every call, derive the count from the ROADMAP progress table.
 * This makes phase.complete idempotent: running it twice produces the same value.
 *
 * Transcribed from sdk/src/query/phase-lifecycle.ts "Root cause 1 fix" block.
 * References: ADR-3524 Section 4, issue #4.
 */
function deriveProgressFromRoadmap(roadmapContent) {
  let completedPhases = null;
  let totalPhases = null;
  let totalPlans = null;

  try {
    // Count Complete rows in the progress table (Status column = "Complete").
    // Pattern: row where the phase cell starts with a digit (data row, not header),
    // followed by any cell content, then a "Complete" status cell.
    // Handles both short form ("| 4. |") and long form ("| 01. Foundation |").
    // See phase-lifecycle.ts ~line 1655 for the original SDK pattern.
    const tableCompletePattern = /\|\s*\d+[^|]*\|\s*[^|]*\|\s*Complete\s*\|/gi;
    const completeMatches = roadmapContent.match(tableCompletePattern);
    completedPhases = completeMatches ? completeMatches.length : null;

    // Count total phase rows in the progress table.
    // Identify the table by looking for Phase|...|Status|...|Completed header.
    const progressTableMatch = roadmapContent.match(
      /\|\s*Phase\s*\|[^|]*\|[^|]*Status[^|]*\|[^|]*Completed[^|]*\|[\s\S]*?(?=\n\n|\n##|$)/i,
    );
    if (progressTableMatch) {
      const tableText = progressTableMatch[0];
      // Count data rows (rows starting with pipe then a phase number)
      const dataRowPattern = /^\|\s*\d+/gm;
      const dataRows = tableText.match(dataRowPattern);
      totalPhases = dataRows ? dataRows.length : null;
    }

    // Sum plan counts from M/N columns in progress table
    let totalPlansSum = 0;
    const planCellPattern = /\|\s*\d+[^|]*\|\s*(\d+)\/(\d+)\s*\|/gi;
    let pm;
    // eslint-disable-next-line no-cond-assign
    while ((pm = planCellPattern.exec(roadmapContent)) !== null) {
      totalPlansSum += parseInt(pm[2], 10);
    }
    if (totalPlansSum > 0) totalPlans = totalPlansSum;
  } catch { /* intentionally empty — fall through to existing values */ }

  return { completedPhases, totalPhases, totalPlans };
}

/**
 * Compute progress percent with a 100% ceiling.
 *
 * Root cause fix for issue #4: without this clamp, blind-increment + recalculate
 * can produce >100% when Completed Phases exceeds Total Phases.
 *
 * References: ADR-3524 Section 4, issue #4.
 */
function clampPercent(completed, total) {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export async function buildPhaseLifecycleCjs() {
  // Serialize the pure functions via .toString() — same technique as gen-project-root.mjs.
  // These functions have no external dependencies (no closures over module scope),
  // so serialization is clean.
  const deriveBody = deriveProgressFromRoadmap.toString();
  const clampBody = clampPercent.toString();

  const parts = [
    BANNER.trimEnd(),
    '',
    '/**',
    ' * Derive completed_phases, total_phases, and total_plans from ROADMAP content.',
    ' * Root cause fix for issue #4 — see gen-phase-lifecycle.mjs for full documentation.',
    ' */',
    deriveBody,
    '',
    '/**',
    ' * Compute progress percent clamped to 100.',
    ' * Root cause fix for issue #4 — see gen-phase-lifecycle.mjs for full documentation.',
    ' */',
    clampBody,
    '',
    `module.exports = {`,
    `  deriveProgressFromRoadmap,`,
    `  clampPercent,`,
    `};`,
    '',
  ];

  return parts.join('\n');
}

async function main() {
  const content = await buildPhaseLifecycleCjs();
  const outPath = fileURLToPath(
    new URL('../../get-shit-done/bin/lib/phase-lifecycle.generated.cjs', import.meta.url),
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
