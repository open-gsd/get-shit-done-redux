---
type: Fixed
pr: 0
---
**`/gsd-new-milestone --ws <name>` now correctly scopes every downstream operation to the requested workstream** — the parsed `--ws` flag was silently dropped by every step after the one that parsed it (each workflow step runs in its own shell), so `init.new-milestone`, `state.milestone-switch`, `phases.clear`, the phase-archive `git add`, and the milestone-start commit all operated on the wrong (ambient or root) scope instead of the explicitly requested workstream. `config.json` (like `PROJECT.md`) is a shared file, not per-workstream — a related resolution bug fixed in the same change.
