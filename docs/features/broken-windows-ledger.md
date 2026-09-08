---
id: 158
title: Broken-Windows Ledger
group: v1.7.0 Features
---

**Behavior:** A cross-phase defect register at `.planning/WINDOWS.md` accumulates stubs, TODOs, skipped tests, unrun verifies, and unmet truths (#1950). `/gsd-ship` blocks while any entry is `open`; an entry can be `waived` only with a recorded reason (auditable) or marked `fixed` (removed from the blocking set). `/gsd-progress` surfaces the open + waived counts.

**Commands:** `gsd-tools windows status | append | waive | fixed`.

**Config:** `workflow.windows_enforce` (gate active, default `false` — opt-in enforcement). Enable with `gsd config-set workflow.windows_enforce true`. Tracking (the ledger itself, populated by the executor) is always on; only the ship gate is opt-in.

**Backward compatibility:** A project with no `.planning/WINDOWS.md` reports `open_count: 0` and ships cleanly; the gate only activates once windows are recorded.

**Milestone attribution (#4487):** each entry carries a `milestone` field, stamped at record time from the workstream's resolved milestone version (STATE.md `milestone:` frontmatter, or the ROADMAP.md in-progress marker as a fallback). Phase numbers are unique only within one active `phases/` directory — `milestone complete` frees them for reuse — so this is what lets an entry be attributed to the milestone it was actually recorded under, even after that milestone is archived and its phase numbers reused. `null` when no milestone could be resolved, including every entry recorded before this field existed.

**Configuration:** `graphify.graph_path`
