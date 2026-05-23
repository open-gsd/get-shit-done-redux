'use strict';

/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: sdk/src/query/validate.ts
 * Regenerate: cd sdk && npm run gen:validate
 *
 * Validate Helpers — pure computation helpers for phase variant normalization,
 * roadmap phase variant set construction, and unchecked-phase skip set construction.
 * No I/O. No async. No filesystem operations.
 *
 * These three helpers cure the three drift items from issue #6:
 *   1. phaseVariants() — replaces parseInt-based padded/unpadded check in verify.cjs
 *      Check 8 (W006 disk-existence and W007 roadmap-membership checks).
 *   2. buildRoadmapPhaseVariants() — replaces raw roadmapPhases set in W007 loop.
 *   3. buildNotStartedPhaseVariants() — replaces raw+zero-padded notStartedPhases
 *      in W006 skip logic.
 *
 * I/O adapter pattern (ADR-3524 §4): pure transforms extracted from the SDK.
 *
 * References:
 *   - ADR-3524 (docs/adr/3524-cjs-sdk-hard-seam.md)
 *   - Issue #6 (open-gsd/get-shit-done-redux)
 *   - PR #154 (issue #4) — generator pattern precedent
 */

function phaseVariants(phase) {

                const variants = new Set([phase]);
                const dotIdx = phase.indexOf('.');
                const head = dotIdx === -1 ? phase : phase.slice(0, dotIdx);
                const tail = dotIdx === -1 ? '' : phase.slice(dotIdx);
                const headMatch = head.match(/^(\d+)([A-Z]?)$/i);
                if (!headMatch)
                    return variants;
                const numericHead = headMatch[1];
                const letterSuffix = headMatch[2] || '';
                variants.add(`${String(parseInt(numericHead, 10))}${letterSuffix}${tail}`);
                variants.add(`${numericHead.padStart(2, '0')}${letterSuffix}${tail}`);
                return variants;
            
}

function buildRoadmapPhaseVariants(roadmapContent) {
  const roadmapPhases = new Set();
  const roadmapPhaseVariants = new Set();
  const phasePattern = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:/gi;
  let m;
  while ((m = phasePattern.exec(roadmapContent)) !== null) {
    roadmapPhases.add(m[1]);
    for (const variant of phaseVariants(m[1])) roadmapPhaseVariants.add(variant);
  }
  return { roadmapPhases, roadmapPhaseVariants };
}

function buildNotStartedPhaseVariants(roadmapContent) {
  const notStartedPhases = new Set();
  const uncheckedPattern = /-\s*\[\s\]\s*\*{0,2}Phase\s+(\d+[A-Z]?(?:\.\d+)*)[:\s*]/gi;
  let um;
  while ((um = uncheckedPattern.exec(roadmapContent)) !== null) {
    for (const variant of phaseVariants(um[1])) notStartedPhases.add(variant);
  }
  return notStartedPhases;
}

module.exports = {
  phaseVariants,
  buildRoadmapPhaseVariants,
  buildNotStartedPhaseVariants,
};
