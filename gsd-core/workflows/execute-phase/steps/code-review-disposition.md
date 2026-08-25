# `code_review_gate` — record a per-finding disposition

Read and executed by `execute-phase.md`'s `code_review_gate` step when the review reported issues
(REVIEW_STATUS not `clean`, not `skipped`, not empty). It consumes `REVIEW_FILE`,
`DISPOSITION_FILE`, `PHASE_DIR` and `PADDED`, all set by that step.

**What it is for.** The counts the gate prints say how many findings there were, not what happened
to any of them. Without a record, the phase directory carries no answer to *what happened to CR-01*
and a phase can reach `phase.complete` with a Critical standing and no trace it was ever seen.

**Why a sibling artifact rather than a section inside REVIEW.md.** `--auto`'s re-review loop
rewrites REVIEW.md on every iteration, so a ledger kept inside it would not survive the next pass;
and REVIEW.md has a single writer, `gsd-code-reviewer`, which this step is not.

**Advisory — it never blocks.** Every failure path reports and steps over.

**Record a per-finding disposition.** The counts say how many findings there were, not what
happened to any of them. On the same condition as the message above — REVIEW_STATUS not "clean",
not "skipped" and not empty — write `${DISPOSITION_FILE}`: one row per finding ID, defaulting to
`open`, reconciling `fixed`/`skipped` from REVIEW-FIX.md and preserving any disposition already
recorded, its stated reason included. It is a sibling artifact because `--auto` rewrites
REVIEW.md every iteration and `gsd-code-reviewer` is its single writer. Advisory like the rest of
the step — never blocks:

```bash
REVIEW_FILE="${REVIEW_FILE}" DISPOSITION_FILE="${DISPOSITION_FILE}" PADDED="${PADDED}" \
FIX_REPORT_FILE="${PHASE_DIR}/${PADDED}-REVIEW-FIX.md" node -e "
  const fs = require('fs'), path = require('path');
  const norm = (s) => s.replace(/\r\n/g, '\n');
  // Captures the id AND the title: the title is what tells a stale fix report apart from a
  // current one, because finding ids are reused across re-reviews.
  const ID_RE = /^###\s+((?:CR|BL|WR|IN)-\d+)\s*:\s*(.*)\$/;
  // BL- is Critical-tier-equivalent to CR- (gsd-code-reviewer.md 'Label equivalence').
  const sev = (id) => ({ CR: 'critical', BL: 'critical', WR: 'warning' }[id.split('-')[0]] || 'info');
  const headings = (text) => {
    // Fenced blocks are skipped: review and fix bodies quote example findings, and a heading
    // inside a fence is an illustration, not a finding.
    const out = [];
    let fenced = false;
    for (const l of norm(text).split('\n')) {
      if (/^\s*(\`{3,}|~{3,})/.test(l)) { fenced = !fenced; out.push({ fence: true }); continue; }
      if (fenced) { out.push({ skip: true, line: l }); continue; }
      const m = l.match(ID_RE);
      out.push(m ? { id: m[1], title: m[2].trim(), line: l } : { line: l });
    }
    return out;
  };
  const order = [], title = new Map();
  for (const h of headings(fs.readFileSync(process.env.REVIEW_FILE, 'utf-8'))) {
    if (h.id && order.indexOf(h.id) === -1) { order.push(h.id); title.set(h.id, h.title); }
  }
  // A review that reports nothing still has to reconcile an EXISTING ledger: its decided rows
  // become carried and its untriaged rows are dropped. Exiting here would freeze a stale ledger
  // showing findings as open that the review no longer reports.
  if (order.length === 0 && !fs.existsSync(process.env.DISPOSITION_FILE)) process.exit(0);
  // Prior rows: keep the disposition AND its source cell — the source is where a human writes
  // the reason a finding was deferred, and rewriting it would discard the very thing the
  // 'set deferred by hand, with the reason' instruction asks for. An escaped \\| is legal in a
  // table cell (the rendered instruction says to escape it), and the trailing pipe is optional
  // so a hand-mangled row loses no decision.
  const prior = new Map();
  if (fs.existsSync(process.env.DISPOSITION_FILE)) {
    for (const l of norm(fs.readFileSync(process.env.DISPOSITION_FILE, 'utf-8')).split('\n')) {
      const m = l.match(/^\|\s*((?:CR|BL|WR|IN)-\d+)\s*\|[^|]*\|\s*([a-z]+)\s*\|\s*((?:[^|\\\\]|\\\\.)*?)\s*\|?\s*\$/);
      // Strip the carried marker before storing: it is rendered from the carried flag, so
      // leaving it on the stored value would re-append it every run — the cell grows without
      // bound AND the file changes on every run, defeating the unchanged-run check below.
      if (m) prior.set(m[1], { d: m[2], src: m[3].replace(/(\s*\(not in the current review\))+\s*\$/, '') });
    }
  }
  // Section headings are matched WHOLE: a prefix match would let '## Fixed Issues Verification'
  // classify every finding under it as fixed.
  const applied = new Map();
  if (fs.existsSync(process.env.FIX_REPORT_FILE)) {
    let sect = null;
    for (const h of headings(fs.readFileSync(process.env.FIX_REPORT_FILE, 'utf-8'))) {
      if (h.fence || h.skip) continue;
      if (/^##\s+Fixed Issues\s*\$/.test(h.line)) { sect = 'fixed'; continue; }
      if (/^##\s+Skipped Issues\s*\$/.test(h.line)) { sect = 'skipped'; continue; }
      if (/^##\s+/.test(h.line)) { sect = null; continue; }
      // First occurrence wins, so an id listed under BOTH sections is not decided by row order.
      // And the fix report must name the SAME finding: ids are reused across re-reviews, so a
      // stale REVIEW-FIX.md would otherwise mark a brand-new CR-01 as already fixed.
      if (h.id && sect && !applied.has(h.id) && title.get(h.id) === h.title) applied.set(h.id, sect);
    }
  }
  // Precedence: an applied outcome is evidence of an action on code and wins; a recorded
  // non-'open' decision wins over the default. 'open' never overwrites a decision.
  const row = (id) => {
    if (applied.has(id)) return { id, sev: sev(id), d: applied.get(id), src: process.env.PADDED + '-REVIEW-FIX.md' };
    const was = prior.get(id);
    if (was && was.d !== 'open') return { id, sev: sev(id), d: was.d, src: was.src || 'recorded' };
    return { id, sev: sev(id), d: 'open', src: '-' };
  };
  const rows = order.map(row);
  // A decided finding the current review no longer reports is CARRIED, never dropped: losing
  // the row would erase the record that it was seen and triaged, which is the whole point.
  for (const [id, was] of prior) {
    if (order.indexOf(id) === -1 && was.d !== 'open') rows.push({ id, sev: sev(id), d: was.d, src: was.src || 'recorded', carried: true });
  }
  const open = rows.filter((r) => r.d === 'open').length;
  if (rows.length === 0 && !fs.existsSync(process.env.DISPOSITION_FILE)) process.exit(0);
  const body = ['# Phase ' + process.env.PADDED + ': Code Review Disposition', '', '| Finding | Severity | Disposition | Source |', '|---------|----------|-------------|--------|']
    .concat(rows.map((r) => '| ' + r.id + ' | ' + r.sev + ' | ' + r.d + ' | ' + (r.src || '-') + (r.carried ? ' (not in the current review)' : '') + ' |'))
    .concat(['', 'Dispositions: \`open\` (recorded, not yet triaged), \`fixed\`, \`skipped\`, \`deferred\`.', 'Set \`deferred\` by hand and put the reason in the Source cell; both are preserved. Escape any \`|\`.', 'Re-running the gate preserves every disposition except \`open\`.', '']).join('\n');
  const head = ['---', 'phase: ' + process.env.PADDED, 'review: ' + path.basename(process.env.REVIEW_FILE), 'findings:']
    .concat(rows.map((r) => '  - id: ' + r.id + '\n    severity: ' + r.sev + '\n    disposition: ' + r.d))
    .concat(['open: ' + open, 'total: ' + rows.length]).join('\n');
  // Rewrite only on a real change. The timestamp is the one field that always differs, so
  // stamping unconditionally would dirty the tree and produce a docs commit on every phase
  // re-run with nothing to report.
  const render = (stamp) => head + '\nrecorded: ' + stamp + '\n---\n\n' + body;
  const stripTs = (t) => t.replace(/^recorded:.*\$/m, 'recorded:');
  const prev = fs.existsSync(process.env.DISPOSITION_FILE) ? norm(fs.readFileSync(process.env.DISPOSITION_FILE, 'utf-8')) : '';
  if (prev && stripTs(prev) === stripTs(render(''))) {
    console.log('Code review disposition unchanged: ' + open + ' of ' + rows.length + ' finding(s) open');
    process.exit(0);
  }
  fs.writeFileSync(process.env.DISPOSITION_FILE, render(new Date().toISOString()));
  console.log('Code review disposition recorded: ' + open + ' of ' + rows.length + ' finding(s) open — ' + process.env.DISPOSITION_FILE);
" || echo "Code review disposition record skipped (non-blocking)."

COMMIT_DOCS=$(gsd_run query config-get commit_docs 2>/dev/null || echo "true")
if [ "$COMMIT_DOCS" = "true" ] && [ -f "${DISPOSITION_FILE}" ]; then
  gsd_run query commit "docs(${PADDED}): record code review disposition" --files "${DISPOSITION_FILE}" || true
fi
```
