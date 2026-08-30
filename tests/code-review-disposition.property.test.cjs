'use strict';

/**
 * code-review-disposition.property.test.cjs
 *
 * RULESET.TESTS.property-based-testing — the disposition ledger is a
 * parse/transformation contract with a render/re-parse fixed point, which is
 * the textbook case for a property rather than a fixture.
 *
 * The step file states the contract in prose: "Re-running the gate preserves
 * every disposition except `open`", and it rewrites nothing when nothing
 * changed. Both are invariants over an input space that fixtures sample at a
 * handful of points — id ordering, severity mix, hand-edited source cells with
 * escaped AND bare pipes, carried rows from a review that no longer reports them.
 *
 * Two properties, both over the SHIPPED script (extracted from the step file
 * and executed), never over a model of it:
 *
 *   idempotency — running the gate twice leaves the ledger byte-identical and
 *                 the second run reports `unchanged`.
 *   round-trip  — every decided disposition and its source cell survives that
 *                 second run, i.e. render → re-parse → render is the identity
 *                 on the decision.
 *
 * numRuns is lowered from the shared 200 because each case spawns the shipped
 * script twice through the process seam; the seed stays pinned, so failures
 * still reproduce. Deviating silently would be the worse trade.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('./helpers/fast-check-setup.cjs');
const { runNode, OUTCOME } = require('./helpers/process-seam.cjs');
const { PROBE_TIMEOUT_MS } = require('./helpers/timeouts.cjs');
const { cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const DISPOSITION_STEP_PATH = path.join(
  ROOT, 'gsd-core', 'workflows', 'execute-phase', 'steps', 'code-review-disposition.md'
);

const RUNS = { numRuns: 40 };

// The SHIPPED node script, undoing exactly the two escapes its surrounding
// double-quoted shell string requires. Deliberately not a model of it.
function shippedDispositionScript() {
  const src = fs.readFileSync(DISPOSITION_STEP_PATH, 'utf8').replace(/\r\n/g, '\n');
  const open = src.indexOf('node -e "');
  assert.ok(open !== -1, 'the disposition step must still embed a node -e script');
  const body = src.slice(open + 'node -e "'.length);
  const end = body.indexOf('\n" || echo ');
  assert.ok(end !== -1, 'the node -e script must still be closed by its || echo fallback');
  return body.slice(0, end).replace(/\\([\\$`"])/g, '$1');
}

const SCRIPT = shippedDispositionScript();

function runOnce(dir, padded) {
  const res = runNode(['-e', SCRIPT], {
    timeoutMs: PROBE_TIMEOUT_MS,
    env: {
      ...process.env,
      REVIEW_FILE: path.join(dir, padded + '-REVIEW.md'),
      DISPOSITION_FILE: path.join(dir, padded + '-REVIEW-DISPOSITION.md'),
      FIX_REPORT_FILE: path.join(dir, padded + '-REVIEW-FIX.md'),
      PADDED: padded,
    },
  });
  assert.strictEqual(res.outcome, OUTCOME.EXITED, 'the shipped script must run to completion');
  assert.strictEqual(res.exitCode, 0, 'the shipped script must exit 0: ' + res.stderr);
  const p = path.join(dir, padded + '-REVIEW-DISPOSITION.md');
  return {
    ledger: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null,
    unchanged: /disposition unchanged/.test(res.stdout),
  };
}

// The id prefixes gsd-code-reviewer.md's body template and its Label-equivalence
// paragraph can emit — the domain the step's own enumeration is a subset of.
const PREFIX = fc.constantFrom('CR', 'BL', 'WR', 'IN');
const DECIDED = fc.constantFrom('fixed', 'skipped', 'deferred');

// The vocabulary the ledger documents, and a generator for its COMPLEMENT.
// DECIDED is drawn from the vocabulary, so no property built on it can ever present the parser
// with an out-of-vocabulary token — the round-trip property below is structurally unable to fail
// on one, which is precisely how a bare ([a-z]+) capture shipped past it. JUNK is the arbitrary
// that reaches the class DECIDED cannot: lowercase, so it stays inside the old capture's own
// character set, because a token OUTSIDE it ('Deferred') already failed safe. The unsafe half is
// the one that looks like a decision and is not.
const VOCABULARY = ['open', 'fixed', 'skipped', 'deferred'];
const JUNK = fc.stringMatching(/^[a-z]{2,10}$/).filter((s) => !VOCABULARY.includes(s));

// A hand-written Source cell: the one place a human writes prose into the
// ledger, so it carries the escaped pipe the rendered instruction asks for — AND the bare
// pipe a human actually types. Round 3 of #3861 found that this generator only ever emitted
// the escaped form, so the property built to stress this cell was structurally unable to
// reach the one input that broke it: a bare | failed the whole-line prior-row match, the
// finding reset to open and the reason was destroyed. A generator that reaches only the
// inputs the parser was written for is a fixture with extra steps.
// The reserved suffix is generated DELIBERATELY. The gate strips a carried marker before storing
// it, so a hand-written reason that merely ENDS in that phrase is the input most likely to be
// eaten — and a generator drawn only from innocuous characters can never produce it. Found by
// adversarial review of this file's first cut, which is the argument for putting it in.
const SOURCE_CELL = fc.stringMatching(/^[A-Za-z0-9 .,()-]{0,24}$/)
  .map((s) => s.trim() || 'recorded')
  .chain((s) => fc.boolean().map((withPipe) => (withPipe ? s + ' \\| see ADR-9' : s)))
  .chain((s) => fc.boolean().map((barePipe) => (barePipe ? s + ' | team B to align' : s)))
  // Adjacent pipes and a backslash of either parity before a pipe: the first render escape got both
  // wrong while passing every input above (round 3, adversarial pass over the fix).
  .chain((s) => fc.constantFrom('', ' A||B', ' C\\\\|D', ' E\\\\\\|F').map((t) => s + t))
  .chain((s) => fc.boolean().map((reserved) => (reserved ? s + ' (not in the current review)' : s)));

const FINDINGS = fc.uniqueArray(
  fc.tuple(PREFIX, fc.integer({ min: 1, max: 99 })).map(([p, n]) => p + '-' + String(n).padStart(2, '0')),
  { minLength: 1, maxLength: 6 }
);

function reviewFor(ids) {
  return ['---', 'phase: 01', 'status: issues_found', '---', '']
    .concat(ids.map((id, i) => '### ' + id + ': finding number ' + i + '\n')).join('\n');
}

describe('#3829 — the disposition ledger is a render/re-parse fixed point', () => {
  test('re-running the gate rewrites nothing and changes nothing', () => {
    fc.assert(fc.property(FINDINGS, (ids) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-3829-prop-'));
      try {
        fs.writeFileSync(path.join(dir, '01-REVIEW.md'), reviewFor(ids));
        const first = runOnce(dir, '01');
        assert.ok(first.ledger !== null, 'a review with findings must produce a ledger');
        const second = runOnce(dir, '01');
        // Idempotency: the second run is a no-op, and says so. The timestamp is
        // the one field that always differs, so a gate that stamped it
        // unconditionally would dirty the tree on every phase re-run.
        assert.ok(second.unchanged, 'the second run must report the ledger unchanged');
        assert.strictEqual(second.ledger, first.ledger, 'the second run must not rewrite the ledger');
      } finally {
        cleanup(dir);
      }
    }), RUNS);
  });

  test('a recorded decision and its reason survive re-rendering', () => {
    fc.assert(fc.property(FINDINGS, DECIDED, SOURCE_CELL, (ids, decision, source) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-3829-prop-'));
      try {
        fs.writeFileSync(path.join(dir, '01-REVIEW.md'), reviewFor(ids));
        // A human decides the first finding by hand, reason included — the case
        // the Source cell exists for.
        const target = ids[0];
        fs.writeFileSync(
          path.join(dir, '01-REVIEW-DISPOSITION.md'),
          '| ' + target + ' | critical | ' + decision + ' | ' + source + ' |\n'
        );
        const out = runOnce(dir, '01');
        const row = out.ledger.split('\n').find((l) => l.startsWith('| ' + target + ' '));
        assert.ok(row, 'the decided finding must still have a row');
        const cells = row.split(/\s\|\s/).map((c) => c.replace(/^\|\s*|\s*\|$/g, '').trim());
        // Round-trip: render -> re-parse -> render is the identity on the
        // decision AND on the reason. `open` never overwrites either.
        assert.strictEqual(cells[2], decision, 'the recorded disposition must survive');
        // The reason survives verbatim EXCEPT for one trailing carried marker, which the parse
        // removes because it is indistinguishable from the one the render appends. That is the
        // contract, not a weakened assertion: leaving a stored marker in place makes the ledger
        // claim a finding is 'not in the current review' on the very run that reports it, and
        // stripping unboundedly ate the cell. One occurrence, one direction, stated here so the
        // trade is visible rather than discovered.
        const MARK = /\s*\(not in the current review\)\s*$/;
        // A bare | in the reason is kept as prose and ESCAPED on re-render, so the rendered
        // cell is the escaped form of what the human wrote — same text under any markdown
        // renderer, and the file converges on the second run. Before this the row simply
        // failed to parse and the decision was lost, which is the defect this arbitrary now reaches.
        // An INDEPENDENT oracle, deliberately not the render's own scan: a pipe is escaped iff an
        // EVEN number of backslashes (including zero) immediately precedes it, counted by walking
        // the string. A copy of the production regex here would agree with it when both are wrong
        // (the round-3 adversarial pass refused exactly that shape), and a single-character
        // look-behind agreed with the first, wrong render -- the negative control caught the mirror.
        const escapePipes = (t) => {
          let out = '', run = 0;
          for (const ch of t) {
            if (ch === '\\') { run += 1; out += ch; continue; }
            if (ch === '|' && run % 2 === 0) out += '\\|'; else out += ch;
            run = 0;
          }
          return out;
        };
        assert.strictEqual(
          cells[3], escapePipes(source.replace(MARK, '')),
          'the reason survives, bare pipes escaped, less at most one trailing carried marker'
        );
        assert.doesNotMatch(cells[3], MARK, 'and a current finding is never marked as carried');
      } finally {
        cleanup(dir);
      }
    }), RUNS);
  });

  test('an out-of-vocabulary disposition is coerced to open, never treated as a decision', () => {
    fc.assert(fc.property(FINDINGS, JUNK, SOURCE_CELL, (ids, junk, source) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-3829-prop-'));
      try {
        fs.writeFileSync(path.join(dir, '01-REVIEW.md'), reviewFor(ids));
        const target = ids[0];
        // One transposed character is the whole input. Under ([a-z]+) this was stored as a
        // decision: not the literal 'open', so it beat the default, was excluded from the open:
        // headline count, and was carried forward forever — a ledger reporting a phase fully
        // triaged off a typo. ADR-227's rule is that a value failing the enum check is coerced
        // to the contract's safe default, and 'open' is that default.
        fs.writeFileSync(
          path.join(dir, '01-REVIEW-DISPOSITION.md'),
          '| ' + target + ' | critical | ' + junk + ' | ' + source + ' |\n'
        );
        const out = runOnce(dir, '01');
        const row = out.ledger.split('\n').find((l) => l.startsWith('| ' + target + ' '));
        assert.ok(row, 'the finding must still have a row');
        const cells = row.split(/\s\|\s/).map((c) => c.replace(/^\|\s*|\s*\|$/g, '').trim());
        assert.strictEqual(cells[2], 'open', 'a junk token is not a decision');
        // And the headline count must AGREE with the row it renders. This is the half the
        // original defect actually reported wrongly: the row said one thing, `open: N` another.
        assert.match(out.ledger, /^open: (\d+)$/m);
        const open = Number(/^open: (\d+)$/m.exec(out.ledger)[1]);
        assert.strictEqual(open, ids.length, 'every finding is open, and the count says so');
      } finally {
        cleanup(dir);
      }
    }), RUNS);
  });
});
