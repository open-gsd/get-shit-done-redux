'use strict';

/**
 * Shared library for the compact-content VARIANT guard (ADR-4139, epic #4139,
 * Phase 6 #4406). See `gsd-core/references/compact-content-gate.md` §"Streams
 * 1b and 4 — variant resolution" for the operational rule this module checks;
 * this file is the mechanics, not the source of truth for behavior.
 *
 * This is a DIFFERENT shape from `compact-content-split.cjs` (Phase 3, stream
 * 1's spine+detail partition). A partition is one document split into two
 * halves that must never overlap (disjointness) and whose union must equal
 * the original (completeness). A variant pair is two INDEPENDENT, complete
 * documents that are EXPECTED to overlap heavily — the compact file is a
 * hand-terser rewrite of the same content, not an extracted remainder. So
 * this module has no disjointness check and no completeness-at-split-time
 * check; it has the five checks `40-design.md` (Phase 6) describes instead:
 *
 *   1. Registration        — `discoverRegisteredVariants` (a `.compact.md`
 *      file with no canonical sibling is not a registered pair; the guard
 *      test reports it as an orphan).
 *   2. Reachability         — `checkReachability` (a registered pair whose
 *      compact path is never named by any spine's "Read ... variant
 *      resolution" call site is unwired dead weight).
 *   3. Protected content preserved — `checkProtectedContentPreserved` (a
 *      `<!-- gsd:protected -->` block's lines must appear verbatim in BOTH
 *      files, since nothing is "moved" in a variant pair — it is duplicated).
 *   4. Size smaller         — `checkSizeSmaller`.
 *   5. Template consumer parity — NOT implemented here; it needs a real
 *      artifact-generation + real-parser round trip per template, which is
 *      the domain of `tests/compact-content-template-variant-parity.test.cjs`
 *      directly, not a generic file-shape check.
 *
 * This module only reads (filesystem + a search of markdown source for
 * literal path substrings). No writes, no network, no git.
 */

const fs = require('node:fs');
const path = require('node:path');

const { extractProtectedBlocks, normalizeNonTrivialLines } = require('./compact-content-split.cjs');

/** Default scan roots: everywhere a `.compact.md` sibling can legally live. */
const DEFAULT_VARIANT_ROOTS = [
  path.join(__dirname, '..', '..', 'gsd-core', 'workflows'),
  path.join(__dirname, '..', '..', 'gsd-core', 'templates'),
];

/** Every markdown-source root a spine/fragment might name a variant path from. */
const DEFAULT_SEARCH_ROOTS = [
  path.join(__dirname, '..', '..', 'gsd-core', 'workflows'),
];

const COMPACT_SUFFIX = '.compact.md';

/**
 * Recursively list every `*.compact.md` file under `dir`.
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function findCompactFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findCompactFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(COMPACT_SUFFIX)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Discover every registered compact/canonical variant pair under `roots`.
 *
 * A pair is registered by a `<dir>/<stem>.compact.md` file existing on disk —
 * there is no separate registry. Its canonical sibling is `<dir>/<stem>.md`
 * in the SAME directory. A `.compact.md` file with no canonical sibling is
 * still returned (with `canonicalExists: false`) so the registration check
 * can report it as an orphan by name, rather than silently skipping it.
 *
 * @param {string[]} roots
 * @returns {{compactPath: string, canonicalPath: string, canonicalExists: boolean}[]}
 */
function discoverRegisteredVariants(roots = DEFAULT_VARIANT_ROOTS) {
  const pairs = [];
  for (const root of roots) {
    for (const compactPath of findCompactFiles(root)) {
      const dir = path.dirname(compactPath);
      const stem = path.basename(compactPath, COMPACT_SUFFIX);
      const canonicalPath = path.join(dir, `${stem}.md`);
      pairs.push({
        compactPath,
        canonicalPath,
        canonicalExists: fs.existsSync(canonicalPath),
      });
    }
  }
  return pairs.sort((a, b) => a.compactPath.localeCompare(b.compactPath));
}

/**
 * Check 1 — registration. A `.compact.md` file must have a canonical sibling.
 * @param {ReturnType<typeof discoverRegisteredVariants>} pairs
 */
function checkRegistration(pairs) {
  const violations = [];
  for (const pair of pairs) {
    if (!pair.canonicalExists) {
      violations.push({ kind: 'orphan_compact_file', compactPath: pair.compactPath });
    }
  }
  return violations;
}

/**
 * Check 2 — reachability. A registered pair's compact path must be named by
 * at least one markdown file under `searchRoots` (a spine's "Read ... variant
 * resolution" call site). Three needle forms, matched differently, because
 * this corpus has two live conventions for naming these paths (found by
 * walking up from the compact file itself to its nearest `gsd-core` ancestor,
 * so this works the same way against the real repo and against a fixture
 * that builds its own `<tmp>/gsd-core/...` tree):
 *
 * - The `gsd-core/<rest>` form (e.g. `gsd-core/workflows/autonomous/steps/
 *   converge-fail-fast.md`'s own convention) is unambiguous on its own — a
 *   different, longer path coincidentally ending in this exact multi-segment
 *   suffix is not a realistic false positive, so a plain substring match is
 *   sufficient without the "unprefixed" guard below.
 * - The `<rest>` form without the leading `gsd-core/` (e.g. `workflows/help/
 *   modes/full.compact.md`, `help.md`'s own dispatch-table convention) is
 *   equally unambiguous for the same reason.
 * - The bare `<stem>.compact.md` form has no such guarantee — a same-named
 *   file under an unrelated nested directory (the exact class of bug already
 *   hit once this phase: `discuss-phase/templates/context.md` vs. the root
 *   `templates/context.md`) could grant it a false reachability. This form
 *   keeps the `isUnprefixedMatch` guard from `namesFragmentAsEntryPoint`
 *   (`scripts/lint-response-language-coverage.cjs`): a path character
 *   immediately before the match means this is the tail of some longer,
 *   different path, not the fragment itself.
 *
 * @param {ReturnType<typeof discoverRegisteredVariants>} pairs
 * @param {string[]} searchRoots
 */
function checkReachability(pairs, searchRoots = DEFAULT_SEARCH_ROOTS) {
  const violations = [];
  const haystacks = [];
  for (const root of searchRoots) {
    for (const file of findMarkdownFiles(root)) {
      haystacks.push(fs.readFileSync(file, 'utf8'));
    }
  }
  for (const pair of pairs) {
    if (!pair.canonicalExists) continue; // already reported by checkRegistration
    const gsdCoreRelative = relativeToNearestGsdCore(pair.compactPath);
    const stem = path.basename(pair.compactPath, COMPACT_SUFFIX);
    const bareNeedle = `${stem}${COMPACT_SUFFIX}`;
    const reached = haystacks.some((text) => {
      if (gsdCoreRelative && (text.includes(`gsd-core/${gsdCoreRelative}`) || text.includes(gsdCoreRelative))) {
        return true;
      }
      return isUnprefixedMatch(text, bareNeedle);
    });
    if (!reached) {
      violations.push({ kind: 'unreachable_compact_file', compactPath: pair.compactPath });
    }
  }
  return violations;
}

/**
 * Walk up from `filePath` to the nearest ancestor directory literally named
 * `gsd-core`, and return the path from there to `filePath` (POSIX-separated).
 * Returns `null` if no such ancestor exists. Anchoring on the literal
 * `gsd-core` segment — rather than a hardcoded repo-root constant — is what
 * lets this match both the real repo and a fixture built under its own
 * `<tmp>/gsd-core/...` tree the same way.
 * @param {string} filePath
 * @returns {string | null}
 */
function relativeToNearestGsdCore(filePath) {
  const segments = filePath.split(path.sep);
  const idx = segments.lastIndexOf('gsd-core');
  if (idx === -1) return null;
  return segments.slice(idx + 1).join('/');
}

/** Is `needle` present in `text` with no path character immediately before it (any line)? */
function isUnprefixedMatch(text, needle) {
  return text.split(/\r?\n/).some((line) => {
    const at = line.indexOf(needle);
    if (at === -1) return false;
    const before = at > 0 ? line[at - 1] : '';
    return !/[A-Za-z0-9_\-./]/.test(before);
  });
}

function findMarkdownFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Check 3 — protected content preserved. Every protected block's non-trivial
 * lines in the canonical file must also appear (verbatim, after the same
 * normalization the partition guard uses) somewhere in the compact sibling.
 * Unlike the partition guard, this is NOT a sentinel-presence check on the
 * compact file itself — the compact file need not carry `<!-- gsd:protected -->`
 * markers of its own, since it is not itself audited for content it might
 * shed later; it only must not have DROPPED the protected wording.
 *
 * @param {ReturnType<typeof discoverRegisteredVariants>} pairs
 */
function checkProtectedContentPreserved(pairs) {
  const violations = [];
  for (const pair of pairs) {
    if (!pair.canonicalExists) continue;
    const canonical = fs.readFileSync(pair.canonicalPath, 'utf8');
    const compact = fs.readFileSync(pair.compactPath, 'utf8');
    const { blocks } = extractProtectedBlocks(canonical);
    if (blocks.length === 0) continue;
    const compactLines = new Set(normalizeNonTrivialLines(compact));
    for (const block of blocks) {
      const missing = block.lines
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => !compactLines.has(l));
      if (missing.length > 0) {
        violations.push({
          kind: 'protected_content_dropped',
          canonicalPath: pair.canonicalPath,
          compactPath: pair.compactPath,
          missing,
        });
      }
    }
  }
  return violations;
}

/**
 * Check 4 — size smaller. The compact file must be strictly smaller than its
 * canonical sibling; a same-size-or-larger "compact" file is not one.
 * @param {ReturnType<typeof discoverRegisteredVariants>} pairs
 */
function checkSizeSmaller(pairs) {
  const violations = [];
  for (const pair of pairs) {
    if (!pair.canonicalExists) continue;
    const canonicalSize = fs.statSync(pair.canonicalPath).size;
    const compactSize = fs.statSync(pair.compactPath).size;
    if (!(compactSize < canonicalSize)) {
      violations.push({
        kind: 'compact_not_smaller',
        canonicalPath: pair.canonicalPath,
        compactPath: pair.compactPath,
        canonicalSize,
        compactSize,
      });
    }
  }
  return violations;
}

module.exports = {
  DEFAULT_VARIANT_ROOTS,
  DEFAULT_SEARCH_ROOTS,
  COMPACT_SUFFIX,
  discoverRegisteredVariants,
  checkRegistration,
  checkReachability,
  checkProtectedContentPreserved,
  checkSizeSmaller,
};
