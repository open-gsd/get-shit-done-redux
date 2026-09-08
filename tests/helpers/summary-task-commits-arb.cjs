'use strict';

/**
 * fast-check arbitraries for the #3926 SUMMARY `## Task Commits` parser.
 *
 * Shared by the two property tests that hold the parser to its contract from
 * opposite sides — tests/summary-task-commits-drift-lint.test.cjs (the JS
 * model and the guard) and tests/code-review-pipeline-regression.test.cjs (the
 * SHIPPED bash pipeline, byte-for-byte against that model) — so both read the
 * same generated documents.
 *
 * The arbitrary is a CONSTRUCTION oracle: every generated line is one of a
 * handful of kinds, and each kind knows whether the hashes it carries are ones
 * the parser must read (`expected`) or decoys it must not (a hash quoted in
 * prose inside the section, the template's own `**Plan metadata:**` line, a
 * label mentioned mid-sentence, a task row whose bold never closes, a code
 * span inside the LABEL, and anything outside the section). The property is
 * then `parse(document) === expected`, which is what the round-4 review's
 * fixture — a hash in an aside inside a correctly-opened section — disproved
 * for the pre-fix parser.
 */

const fc = require('./fast-check-setup.cjs');

const HEX = '0123456789abcdef';
const hashArb = fc
  .array(fc.constantFrom(...HEX.split('')), { minLength: 7, maxLength: 40 })
  .map((cs) => cs.join(''));

// Title words: prose-shaped, and never able to form `**` or a backtick — those
// two are planted deliberately by the kinds below, never by accident.
const wordArb = fc.stringMatching(/^[A-Za-z0-9_./-]{1,12}$/);
const titleArb = fc
  .array(wordArb, { minLength: 1, maxLength: 5 })
  .map((ws) => ws.join(' '));

const sepArb = fc.constantFrom('-', '–', '—', ':');
const markerArb = fc.constantFrom('1.', '2.', '12.', '-', '*', '');
const indentArb = fc.constantFrom('', ' ', '  ', '\t');
const tailArb = fc.constantFrom('', ' (feat)', ' (fix)', ' (test → feat → refactor)');

/** One line inside (or outside) the section, with the hashes it OWES the parser. */
const lineArb = fc.oneof(
  // A task row: label closed by `**`, then one or more backticked hashes. All
  // of them are the parser's — a TDD task may record several commits.
  fc
    .record({ indent: indentArb, marker: markerArb, n: fc.nat(99), title: titleArb, sep: sepArb, hashes: fc.array(hashArb, { minLength: 1, maxLength: 3 }), tail: tailArb })
    .map(({ indent, marker, n, title, sep, hashes, tail }) => ({
      line: `${indent}${marker}${marker ? ' ' : ''}**Task ${n}: ${title}** ${sep} ${hashes.map((h) => `\`${h}\``).join(', ')}${tail}`,
      expected: hashes,
    })),
  // A task row whose LABEL carries a code-span hash (a title like
  // "revert `deadbeef1`"): the label's token is not a commit; the one after
  // the closing bold is.
  fc
    .record({ n: fc.nat(99), decoy: hashArb, title: titleArb, real: hashArb })
    .map(({ n, decoy, title, real }) => ({
      line: `1. **Task ${n}: ${title} \`${decoy}\`** - \`${real}\``,
      expected: [real],
    })),
  // The round-4 fixture: a hash quoted in an aside inside the section.
  fc
    .record({ h: hashArb, w: titleArb })
    .map(({ h, w }) => ({ line: `Note: this superseded an earlier attempt recorded at \`${h}\` (${w}).`, expected: [] })),
  // The shipped summary.md template's own non-row line inside the section.
  hashArb.map((h) => ({ line: `**Plan metadata:** \`${h}\` (docs: complete plan)`, expected: [] })),
  // A label MENTIONED mid-sentence is not a row.
  fc
    .record({ n: fc.nat(99), title: titleArb, h: hashArb })
    .map(({ n, title, h }) => ({ line: `See **Task ${n}: ${title}** above, superseded by \`${h}\`.`, expected: [] })),
  // A row whose bold never closes: no label, so nothing after it is a commit.
  fc
    .record({ n: fc.nat(99), title: titleArb, h: hashArb })
    .map(({ n, title, h }) => ({ line: `${n}. **Task ${n}: ${title} - \`${h}\``, expected: [] })),
  // Inert prose and blanks.
  titleArb.map((t) => ({ line: t, expected: [] })),
  fc.constant({ line: '', expected: [] }),
  fc.constant({ line: '_Note: TDD tasks may have multiple commits (test → feat → refactor)_', expected: [] }),
);

/**
 * A whole document: decoy-bearing prose before the section, one or two
 * `## Task Commits` sections (the shipped awk reopens on a later heading),
 * each terminated by another `## ` heading, then decoy-bearing prose after.
 * Optionally CRLF, which the parser must read identically.
 */
const documentArb = fc
  .record({
    before: fc.array(lineArb, { maxLength: 4 }),
    sections: fc.array(fc.array(lineArb, { maxLength: 8 }), { minLength: 1, maxLength: 2 }),
    after: fc.array(lineArb, { maxLength: 4 }),
    eol: fc.constantFrom('\n', '\r\n'),
    trailingHeading: fc.constantFrom('## Files Created/Modified', '## Next Phase Readiness', '## Decisions & Deviations'),
  })
  .map(({ before, sections, after, eol, trailingHeading }) => {
    const lines = ['# Phase Summary', ...before.map((l) => l.line)];
    const expected = [];
    for (const section of sections) {
      lines.push('## Task Commits');
      for (const l of section) { lines.push(l.line); expected.push(...l.expected); }
    }
    lines.push(trailingHeading, ...after.map((l) => l.line), '');
    return { text: lines.join(eol), expected };
  });

/**
 * A lint-CLEAN template: numbered canonical rows carrying the placeholder
 * `hash`, in the shape the guard pins. `substitute(template, hashes)` swaps the
 * placeholders for real hex in row order, which is what a SUMMARY authored
 * from that template looks like on disk.
 */
const cleanTemplateArb = fc
  .record({
    rows: fc.array(fc.record({ title: titleArb, sep: sepArb, tail: tailArb }), { minLength: 1, maxLength: 5 }),
    lead: fc.constantFrom('', 'Each task was committed atomically:'),
    meta: fc.boolean(),
  })
  .map(({ rows, lead, meta }) => {
    const lines = ['# Phase Summary', '', '## Task Commits'];
    if (lead) lines.push('', lead);
    lines.push('');
    rows.forEach((r, i) => lines.push(`${i + 1}. **Task ${i + 1}: ${r.title}** ${r.sep} \`hash\`${r.tail}`));
    if (meta) lines.push('', '**Plan metadata:** `hash` (docs: complete plan)');
    lines.push('', '## Files Created/Modified', '', '- src/thing.cts', '');
    return { text: lines.join('\n'), rows: rows.length };
  });

function substitute(text, hashes) {
  let i = 0;
  return text.replace(/`hash`/g, () => `\`${hashes[i++] ?? hashes[hashes.length - 1]}\``);
}

module.exports = { documentArb, cleanTemplateArb, hashArb, substitute };
