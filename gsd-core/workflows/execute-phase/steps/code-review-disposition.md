# `code_review_gate` — report the review and record a per-finding disposition

Read and executed by `execute-phase.md`'s `code_review_gate` step, immediately after code review
returns. It consumes `PHASE_DIR` and `PHASE_NUMBER` and derives everything else.

It lives here rather than inline in the parent because `execute-phase.md` sits against two size
ceilings — the XL hard cap in `tests/workflow-size-budget.test.cjs` and the frozen ADR-857
pre-phase-6 ceiling in `tests/claude-orchestration.test.cjs` — and both are red lines to be kept
under, not budgets to spend.

**What it is for.** The counts the gate prints say how many findings there were, not what happened
to any of them. Without a record, the phase directory carries no answer to *what happened to CR-01*
and a phase can reach `phase.complete` with a Critical standing and no trace it was ever seen.

**Why a sibling artifact rather than a section inside REVIEW.md.** `--auto`'s re-review loop
rewrites REVIEW.md on every iteration, so a ledger kept inside it would not survive the next pass;
and REVIEW.md has a single writer, `gsd-code-reviewer`, which this step is not.

**Advisory — it never blocks.** Every failure path reports and steps over.

**Check results using deterministic path (not glob):**
```bash
PADDED=$(printf "%02d" "${PHASE_NUMBER}")
REVIEW_FILE="${PHASE_DIR}/${PADDED}-REVIEW.md"
DISPOSITION_FILE="${PHASE_DIR}/${PADDED}-REVIEW-DISPOSITION.md"
# Extract ONLY the leading frontmatter block: `sed -n '/^---$/,/^---$/p'` re-opens its range
# on a body `---` and runs to EOF, which leaks body lines into the scan. That leak is benign
# for a key the frontmatter always carries (the first match still wins) but NOT for an
# optional one — a review with no `findings:` block and a body `total:` line would otherwise
# report the body's number as the count. Stop at the closing delimiter instead, and strip CR
# first so a CRLF-authored review neither breaks the delimiter match nor injects a carriage
# return into the message below (DEFECT.FRONTMATTER-SCALAR-BROAD-GREP).
# Buffered, and emitted only if the CLOSING delimiter was actually seen: an unterminated
# frontmatter block would otherwise run to EOF and hand the whole review body to the reads below,
# defeating the scoping entirely.
# Guarded and `|| true`: this step is advisory, so a REVIEW.md that is missing, a directory, or
# otherwise unreadable must leave the counts empty and let execution continue — never abort the
# step under `set -e`/`pipefail`.
REVIEW_FM=""
if [ -f "$REVIEW_FILE" ] && [ -r "$REVIEW_FILE" ]; then
  REVIEW_FM=$(tr -d '\r' < "$REVIEW_FILE" 2>/dev/null | awk 'NR==1{if($0!="---") exit; next} /^---$/{closed=1; exit} {buf = buf $0 "\n"} END{if (closed) printf "%s", buf}' || true)
fi
# `|| true` on every read: under `pipefail` a non-matching `grep` exits 1, and an assignment
# whose command substitution fails aborts the step under `set -e`. An advisory gate must survive
# a REVIEW.md with no frontmatter at all.
REVIEW_STATUS=$(echo "$REVIEW_FM" | grep -m1 "^status:" | cut -d: -f2 | tr -d ' ' || true)
# The counts sit in the block just parsed. `blocker:` is the documented tier-equivalent of
# `critical:` (gsd-code-reviewer.md § "Label equivalence") — accept either, exactly as
# code-review.md's present_results already does.
REVIEW_CRITICAL=$(echo "$REVIEW_FM" | grep -E -m1 "^[[:space:]]*(critical|blocker):" | cut -d: -f2 | tr -d ' ' || true)
REVIEW_WARNING=$(echo "$REVIEW_FM" | grep -E -m1 "^[[:space:]]*warning:" | cut -d: -f2 | tr -d ' ' || true)
REVIEW_INFO=$(echo "$REVIEW_FM" | grep -E -m1 "^[[:space:]]*info:" | cut -d: -f2 | tr -d ' ' || true)
REVIEW_TOTAL=$(echo "$REVIEW_FM" | grep -E -m1 "^[[:space:]]*total:" | cut -d: -f2 | tr -d ' ' || true)
# The breakdown is reportable only when ALL FOUR counts are numbers. Deciding on REVIEW_TOTAL
# alone would still emit `6 findings —  critical` for a review carrying a total and nothing else.
REVIEW_COUNTS_OK=1
for _c in "$REVIEW_TOTAL" "$REVIEW_CRITICAL" "$REVIEW_WARNING" "$REVIEW_INFO"; do
  case "$_c" in ''|*[!0-9]*) REVIEW_COUNTS_OK=0 ;; esac
done
```

If REVIEW_STATUS is not "clean" and not "skipped" and not empty, and `REVIEW_COUNTS_OK` is `1`,
display the severity breakdown. The counts were parsed above at no extra cost, and stating them is
what makes a review with one `info` finding distinguishable from a review with a Critical:
```
Code review: ${REVIEW_TOTAL} findings — ${REVIEW_CRITICAL} critical, ${REVIEW_WARNING} warning, ${REVIEW_INFO} info.
Consider running: /gsd:code-review ${PHASE_NUMBER} --fix
```

That form requires `REVIEW_COUNTS_OK` to be `1`. A REVIEW.md written without a `findings:` block
has no counts to report, and any count that is empty or non-numeric makes the whole breakdown
unavailable rather than half-filled. When `REVIEW_COUNTS_OK` is `0`, display the countless form
instead:
```
Code review found issues. Consider running:
/gsd:code-review ${PHASE_NUMBER} --fix
```

**Record a per-finding disposition.** On that same condition — REVIEW_STATUS not "clean", not
"skipped" and not empty — read and execute `gsd-core/workflows/execute-phase/steps/code-review-disposition.md`,
which records one row per finding so a triaged finding is distinguishable downstream from a
forgotten one. Advisory like the rest of the step; it never blocks.


**Record a per-finding disposition.** The counts say how many findings there were, not what
happened to any of them. On the same condition as the message above — REVIEW_STATUS not "clean",
not "skipped" and not empty — write `${DISPOSITION_FILE}`: one row per finding ID, defaulting to
`open`, reconciling `fixed`/`skipped` from REVIEW-FIX.md and preserving any disposition already
recorded, its stated reason included. It is a sibling artifact because `--auto` rewrites
REVIEW.md every iteration and `gsd-code-reviewer` is its single writer. Advisory like the rest of
the step — never blocks:

```bash
_GSD_SHIM_NAME="gsd-tools.cjs"; _GSD_RUNTIME_ROOT="${RUNTIME_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; GSD_TOOLS="${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}"; _gsd_at() { for _p; do if [ -f "$_p" ]; then GSD_TOOLS="$_p"; return 0; fi; done; return 1; }; if _gsd_at "${_GSD_RUNTIME_ROOT}/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.claude/gsd-core/bin/${_GSD_SHIM_NAME}" "${_GSD_RUNTIME_ROOT}/.codex/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; elif unset -f gsd_run; _G="$(command -v gsd_run)"; then GSD_TOOLS="$_G"; gsd_run() { "$GSD_TOOLS" "$@"; }; elif _gsd_at "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/gsd-core/bin/${_GSD_SHIM_NAME}" "${HERMES_HOME:-$HOME/.hermes}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CURSOR_CONFIG_DIR:-$HOME/.cursor}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEX_HOME:-$HOME/.codex}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GEMINI_CONFIG_DIR:-$HOME/.gemini}/gsd-core/bin/${_GSD_SHIM_NAME}" "${COPILOT_CONFIG_DIR:-$HOME/.copilot}/gsd-core/bin/${_GSD_SHIM_NAME}" "${WINDSURF_CONFIG_DIR:-$HOME/.codeium/windsurf}/gsd-core/bin/${_GSD_SHIM_NAME}" "${AUGMENT_CONFIG_DIR:-$HOME/.augment}/gsd-core/bin/${_GSD_SHIM_NAME}" "${TRAE_CONFIG_DIR:-$HOME/.trae}/gsd-core/bin/${_GSD_SHIM_NAME}" "${QWEN_CONFIG_DIR:-$HOME/.qwen}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CODEBUDDY_CONFIG_DIR:-$HOME/.codebuddy}/gsd-core/bin/${_GSD_SHIM_NAME}" "${CLINE_CONFIG_DIR:-$HOME/.cline}/gsd-core/bin/${_GSD_SHIM_NAME}" "${GROK_AGENTS_HOME:-$HOME/.agents}/gsd-core/bin/${_GSD_SHIM_NAME}" "${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/antigravity}/gsd-core/bin/${_GSD_SHIM_NAME}" "${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}/gsd-core/bin/${_GSD_SHIM_NAME}" "${KILO_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kilo}/gsd-core/bin/${_GSD_SHIM_NAME}"; then gsd_run() { node "$GSD_TOOLS" "$@"; }; else echo "ERROR: gsd-tools.cjs not found at $GSD_TOOLS and gsd_run is not on PATH. Run: npx -y @opengsd/gsd-core@latest --claude --local" >&2; exit 1; fi; GSD_IDENTITY_STATUS=unverified; case "$(gsd_run runtime-identity --raw 2>/dev/null || true)" in '{"packageName":"@opengsd/gsd-core"'*'}') GSD_IDENTITY_STATUS=ok;; esac; export GSD_IDENTITY_STATUS; [ "$GSD_IDENTITY_STATUS" = ok ] || echo "WARNING: \"$GSD_TOOLS\" did not prove it is @opengsd/gsd-core - it is either a different package or an @opengsd/gsd-core older than the runtime-identity verb. See docs/how-to/diagnose-a-foreign-gsd-tools.md" >&2; if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${GSD_TOOLS:-}" ]; then printf "export PATH='%s':\"\$PATH\"\n" "${GSD_TOOLS%/*}" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true; fi
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
