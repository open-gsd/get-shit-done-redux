---
type: Fixed
pr: 4545
---
**`/gsd-new-milestone --ws <name>` now correctly scopes every downstream operation to the requested workstream** — the parsed `--ws` flag was silently dropped by every step after the one that parsed it (each workflow step runs in its own shell), so `init.new-milestone`, `state.milestone-switch`, `phases.clear`, the phase-archive `git add`, and the requirements/roadmap/milestone-start commits all operated on the wrong (ambient or root) scope instead of the explicitly requested workstream.
