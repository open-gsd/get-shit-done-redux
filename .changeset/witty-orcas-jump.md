---
type: Fixed
pr: 4542
---
**`/gsd-autonomous` and `/gsd-complete-milestone` now correctly scope STATE/ROADMAP/MILESTONES/PROJECT/REQUIREMENTS reads and writes to the active workstream** — with `GSD_WORKSTREAM` set, these two workflows previously still read and wrote the root `.planning/` copies of these files instead of the selected workstream's own files, silently ignoring or corrupting the wrong scope's planning state (and, for `/gsd-complete-milestone`'s safety commit, silently missing the actual files just archived). `todos` remains the one deliberately shared, root-scoped exception (#4256).
