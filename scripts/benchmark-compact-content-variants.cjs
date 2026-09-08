#!/usr/bin/env node
'use strict';

/**
 * Benchmarks the token-count effect of every registered variant-swap pair
 * (ADR-4139, Phase 6 #4406 — `gsd-core/workflows/<name>/{modes,steps,templates}/*.compact.md`
 * and `gsd-core/templates/**\/*.compact.md`). Sibling to
 * `scripts/benchmark-compact-content.cjs` (Phase 3's spine/detail benchmark) rather than an
 * extension of it — the two are different data shapes (a variant pair is two independent,
 * deliberately-overlapping complete files; a spine/detail split is one document partitioned in
 * two disjoint halves), and mixing them into one report would conflate an "off" total that means
 * something different in each case.
 *
 * For every registered pair it reports the "off" token count (the canonical file — what
 * `workflow.compact_content=false`, the default, pays at that call site) against the "on" token
 * count (the `.compact.md` sibling — what `workflow.compact_content=true` pays once the gate
 * resolves to it). See `gsd-core/references/compact-content-gate.md` §"Streams 1b and 4" for the
 * resolution rule this measures.
 *
 * PROXY-TOKENIZER CAVEAT: same as the sibling script — `gpt-tokenizer` is a stand-in tokenizer;
 * Anthropic publishes none for Claude 3+. The on/off comparison is exact under this one pinned
 * tokenizer applied identically to both sides; the absolute counts are not Claude's real counts.
 *
 * Discovery is REIMPLEMENTED here rather than imported from
 * `tests/helpers/compact-content-variant.cjs`, for the same reason
 * `benchmark-compact-content.cjs` reimplements spine/detail discovery instead of importing it: a
 * `scripts/` reporting tool depending on a test-only helper module inverts this repo's normal
 * layering, and a test-only module changing shape should never be able to break a benchmark.
 *
 * Usage:
 *   node scripts/benchmark-compact-content-variants.cjs                 # print JSON to stdout
 *   node scripts/benchmark-compact-content-variants.cjs --write         # write the committed baseline
 *   node scripts/benchmark-compact-content-variants.cjs --check         # recompute, diff vs committed baseline
 *   node scripts/benchmark-compact-content-variants.cjs --check --baseline-path=<path>
 *
 * Same CRITICAL contract as the sibling script: this — and `--check` especially — MUST NEVER
 * exit non-zero because a baseline is drifted, stale, or missing. Only a genuine I/O error
 * reading a SOURCE file the benchmark measures may throw. This is a reporting instrument, never
 * a gate.
 */

const fs = require('node:fs');
const path = require('node:path');

const { countTokens } = require('gpt-tokenizer');
const { runMain } = require('./lib/cli-exit.cjs');

const ROOT = path.resolve(__dirname, '..');
const VARIANT_ROOTS = [path.join(ROOT, 'gsd-core', 'workflows'), path.join(ROOT, 'gsd-core', 'templates')];
const BASELINE_PATH = path.join(ROOT, 'tests', 'fixtures', 'compact-content-variant-benchmark-baseline.json');
const COMPACT_SUFFIX = '.compact.md';

function getTokenizerVersion() {
  const pkgPath = require.resolve('gpt-tokenizer/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

/**
 * Discover every registered variant pair under `roots`: a `.compact.md` file
 * with a same-directory, same-stem canonical `.md` sibling. Mirrors
 * `tests/helpers/compact-content-variant.cjs`'s `discoverRegisteredVariants`
 * in shape but is a from-scratch, self-contained implementation (see module
 * header for why this is not a shared import). Skips an orphaned compact
 * file with no canonical sibling — that is the guard's problem, not this
 * benchmark's; a pair with no canonical baseline has no "off" number to
 * report against.
 *
 * @param {string[]} [roots]
 * @returns {Array<{name: string, canonicalPath: string, compactPath: string}>}
 */
function discoverRegisteredVariants(roots = VARIANT_ROOTS) {
  const pairs = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(COMPACT_SUFFIX)) {
        const stem = entry.name.slice(0, -COMPACT_SUFFIX.length);
        const canonicalPath = path.join(dir, `${stem}.md`);
        if (fs.existsSync(canonicalPath)) {
          const name = path.relative(ROOT, canonicalPath).split(path.sep).join('/');
          pairs.push({ name, canonicalPath, compactPath: full });
        }
      }
    }
  }

  for (const root of roots) walk(root);
  return pairs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute the off/on/reduction numbers for ONE registered variant pair.
 * Throws on a genuine read failure of a source file (the one thing allowed
 * to throw, per the module-header CRITICAL note).
 *
 * @param {{canonicalPath: string, compactPath: string}} pair
 * @returns {{offTokens: number, onTokens: number, reductionPct: number}}
 */
function computePairTokens(pair) {
  const offTokens = countTokens(fs.readFileSync(pair.canonicalPath, 'utf8'));
  const onTokens = countTokens(fs.readFileSync(pair.compactPath, 'utf8'));
  const reductionPct = offTokens === 0 ? 0 : round2(((offTokens - onTokens) / offTokens) * 100);
  return { offTokens, onTokens, reductionPct };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregate per-pair numbers from SUMMED off/on totals, never averaged
 * per-pair percentages. Reports `0` (not `NaN`) for zero registered pairs.
 * @param {Record<string, {offTokens: number, onTokens: number}>} pairResults
 */
function computeAggregate(pairResults) {
  let offTokens = 0;
  let onTokens = 0;
  for (const key of Object.keys(pairResults)) {
    offTokens += pairResults[key].offTokens;
    onTokens += pairResults[key].onTokens;
  }
  const reductionPct = offTokens === 0 ? 0 : round2(((offTokens - onTokens) / offTokens) * 100);
  return { offTokens, onTokens, reductionPct };
}

const LABEL =
  "PROXY-TOKENIZER DELTA — gpt-tokenizer is a stand-in; Anthropic publishes no tokenizer for Claude 3+. " +
  "The on/off COMPARISON is exact under this pinned tokenizer; absolute counts are not Claude's real token counts.";

/**
 * @param {string[]} [roots]
 * @returns {object}
 */
function buildReport(roots = VARIANT_ROOTS) {
  const pairs = discoverRegisteredVariants(roots);
  const pairReports = {};
  for (const pair of pairs) {
    pairReports[pair.name] = computePairTokens(pair);
  }
  return {
    schema_version: 1,
    generated_by: 'scripts/benchmark-compact-content-variants.cjs',
    tokenizer: { name: 'gpt-tokenizer', version: getTokenizerVersion() },
    label: LABEL,
    pairs: pairReports,
    aggregate: computeAggregate(pairReports),
  };
}

/**
 * Format a human-readable drift summary between a (possibly missing/invalid)
 * committed baseline and a freshly-computed live report. Never throws.
 * @param {string} baselinePath
 * @param {object} live
 * @returns {string}
 */
function formatDriftReport(baselinePath, live) {
  const lines = [];
  let baseline = null;
  let baselineReadError = null;
  try {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    try {
      baseline = JSON.parse(raw);
    } catch (parseErr) {
      baselineReadError = `baseline at ${baselinePath} could not be parsed as JSON: ${parseErr.message}`;
    }
  } catch {
    baselineReadError = `no baseline found at ${baselinePath}`;
  }

  if (baselineReadError) {
    lines.push(`DRIFT: ${baselineReadError} — treating as fully drifted (this is reported, not an error).`);
    lines.push('Live pairs:');
    for (const name of Object.keys(live.pairs).sort()) {
      const p = live.pairs[name];
      lines.push(`  + ${name}: off=${p.offTokens} on=${p.onTokens} reduction=${p.reductionPct}%`);
    }
    lines.push(
      `Live aggregate: off=${live.aggregate.offTokens} on=${live.aggregate.onTokens} ` +
      `reduction=${live.aggregate.reductionPct}%`,
    );
    return lines.join('\n');
  }

  const baselinePairs = (baseline && typeof baseline === 'object' && baseline.pairs) || {};
  const livePairs = live.pairs;
  const allNames = new Set([...Object.keys(baselinePairs), ...Object.keys(livePairs)]);
  let anyDrift = false;

  if (!baseline || typeof baseline.label !== 'string' || !baseline.label.includes('PROXY-TOKENIZER')) {
    anyDrift = true;
    lines.push('DRIFT: committed baseline is missing the required "PROXY-TOKENIZER" label.');
  }

  for (const name of [...allNames].sort()) {
    const b = baselinePairs[name];
    const l = livePairs[name];
    if (!b) {
      anyDrift = true;
      lines.push(`DRIFT: pair "${name}" is new (not in committed baseline) — live off=${l.offTokens} on=${l.onTokens} reduction=${l.reductionPct}%`);
    } else if (!l) {
      anyDrift = true;
      lines.push(`DRIFT: pair "${name}" was removed (present in committed baseline, not found live) — baseline off=${b.offTokens} on=${b.onTokens} reduction=${b.reductionPct}%`);
    } else if (b.offTokens !== l.offTokens || b.onTokens !== l.onTokens || b.reductionPct !== l.reductionPct) {
      anyDrift = true;
      lines.push(
        `DRIFT: pair "${name}": off ${b.offTokens} -> ${l.offTokens} (${l.offTokens - b.offTokens >= 0 ? '+' : ''}${l.offTokens - b.offTokens}), ` +
        `on ${b.onTokens} -> ${l.onTokens} (${l.onTokens - b.onTokens >= 0 ? '+' : ''}${l.onTokens - b.onTokens}), ` +
        `reduction ${b.reductionPct}% -> ${l.reductionPct}% (${round2(l.reductionPct - b.reductionPct) >= 0 ? '+' : ''}${round2(l.reductionPct - b.reductionPct)}pp)`,
      );
    }
  }

  const ba = (baseline && baseline.aggregate) || {};
  const la = live.aggregate;
  if (ba.offTokens !== la.offTokens || ba.onTokens !== la.onTokens || ba.reductionPct !== la.reductionPct) {
    anyDrift = true;
    lines.push(
      `DRIFT: aggregate: off ${ba.offTokens} -> ${la.offTokens}, on ${ba.onTokens} -> ${la.onTokens}, ` +
      `reduction ${ba.reductionPct}% -> ${la.reductionPct}%`,
    );
  }

  if (!anyDrift) {
    lines.push(`Baseline at ${baselinePath} is up to date with the live recompute.`);
  } else {
    lines.push('');
    lines.push('Run `node scripts/benchmark-compact-content-variants.cjs --write` to refresh the committed baseline.');
    lines.push('(This is a REPORT, not a gate — exiting 0 regardless of drift, per this script\'s own contract.)');
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = { write: false, check: false, baselinePath: BASELINE_PATH };
  for (const arg of argv) {
    if (arg === '--write') opts.write = true;
    else if (arg === '--check') opts.check = true;
    else if (arg.startsWith('--baseline-path=')) opts.baselinePath = arg.slice('--baseline-path='.length);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.write) {
    const report = buildReport();
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`Wrote ${BASELINE_PATH}\n`);
    return;
  }

  if (opts.check) {
    const live = buildReport();
    process.stdout.write(formatDriftReport(opts.baselinePath, live) + '\n');
    return;
  }

  process.stdout.write(JSON.stringify(buildReport(), null, 2) + '\n');
}

/* c8 ignore next 3 -- CLI entry guard; this repo measures coverage with c8, which does not honor istanbul pragmas */
if (require.main === module) {
  runMain(main);
}

module.exports = {
  discoverRegisteredVariants,
  computePairTokens,
  computeAggregate,
  buildReport,
  formatDriftReport,
  getTokenizerVersion,
  parseArgs,
  LABEL,
  BASELINE_PATH,
  VARIANT_ROOTS,
};
