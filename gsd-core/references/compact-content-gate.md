# Compact Content Gate

Shared by every workflow spine split under ADR-4139, and by every lazily-read fragment or
planning-artifact template given a compact variant under Phase 6 (#4406). States the config check
and both resolution rules once — a spine or fragment references this file; it never restates
either check inline.

## The check

```bash
COMPACT_CONTENT=$(gsd_run query config-get workflow.compact_content --raw 2>/dev/null || echo "false")
```

## Stream 1 — spine + detail (top-level, eagerly `@`-included workflows)

- **`COMPACT_CONTENT` is `"false"` (default):** Read every part under this workflow's own `detail/` directory (a sibling of this spine, e.g. `gsd-core/workflows/<name>/detail/*.md`) now, in full, before continuing past this point. Their content elaborates on the spine you are reading — treat everything they say as part of this document from here on.
- **`COMPACT_CONTENT` is `"true"`:** Do not read the detail file. Continue directly with the spine's own content — per ADR-4139 Decision 3, it is complete enough to run this workflow correctly on its own.

**The fail-safe this holds (ADR-4139 Decision 4):** A `Read` that does not fire for any reason (tool error, a skipped step, a misread condition) leaves you running on the spine alone. That is the same, correct, terser state an opted-in project runs in on purpose — never a state with no instructions. The spine's own completeness is what makes this safe; this gate is only ever additive.

## Streams 1b and 4 — variant resolution (lazily-read fragments and planning-artifact templates)

For a `workflows/<name>/{modes,steps,templates}/*.md` fragment or a `gsd-core/templates/**`
planning-artifact template that has a registered `.compact.md` sibling (same directory, same stem,
`.compact.md` suffix):

- **`COMPACT_CONTENT` is `"false"` (default), or the file has no registered `.compact.md` sibling:** Read the canonical path exactly as named — unchanged from today.
- **`COMPACT_CONTENT` is `"true"` and a `.compact.md` sibling is registered:** Read the `.compact.md` sibling instead of the canonical path.

Both files are complete, independently — Read exactly one, never both, and never read the compact
sibling's content as an addendum to the canonical file.

**The fail-safe this holds:** unlike stream 1, a call site this rule actually applies to is already
reached only by a runtime `Read` — a missed `Read` already means zero overlay content, with or
without `workflow.compact_content`. Selecting between two independently-complete files at that
call site does not introduce a new way to end up with nothing; the worst case is identical to
today's. This is why stream 1b/4 can use variant-swap (two independent files) where stream 1 could
not: the degradation-direction argument that ruled out converting stream 1's `@`-includes (ADR-4139
Decision 4) does not apply at a genuine runtime-`Read` call site, because there is no
host-guaranteed baseline being traded away there.

**This rule is scoped per call site, not per file.** A `gsd-core/templates/**` file can have both
kinds of reference in the corpus at once — some places name it inside an eager `@`-include or an
orchestrator build-time embed (the same mechanism as stream 1, just reaching a template path
instead of a workflow path), others name it in prose instructing a runtime `Read`. Only the latter
gets rewritten to point at this rule; an eager reference to the canonical file is left exactly as
it is, for the same reason stream 1's `@`-includes were left alone — converting it would trade a
host-guaranteed load for a conditional one. Before wiring any call site, confirm by inspection
which kind it is; do not assume every mention of a `gsd-core/templates/**` path is a runtime `Read`
just because the directory's typical case is.

## Stream 2 — agent-skill payloads (the `gsd_run query agent-skills` CLI seam)

`agents/<name>.compact.md`, same directory, same stem, `.compact.md` suffix — registered and
checked the same way as streams 1b/4. The selection is different: this seam already runs through
a real function call (`cmdAgentSkills`, `src/init.cts`), so the resolution happens **in code**,
not by a `gsd_run query config-get` prose instruction. There is nothing to state here for a
workflow author to follow, because no workflow author calls this seam directly — it fires only
inside the `#2454` persona fallback for non-Claude, AGENTS-native runtimes that cannot dispatch a
named subagent.

Same two rules as streams 1b/4, enforced in code instead of prose: `workflow.compact_content` off,
or no registered `.compact.md` sibling for that agent, serves the canonical persona unchanged; on,
with a sibling registered, serves the compact one. The one addition code gives that prose could
not: a missing sibling is disclosed in the served payload itself (a leading `<!-- gsd: no compact
payload registered ... -->` comment) rather than silently serving canonical with no signal at all.
