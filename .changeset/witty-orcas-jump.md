---
type: Fixed
pr: 0
---
**`/gsd-autonomous` and `/gsd-complete-milestone` now correctly scope state/roadmap/archive reads and writes to the active workstream** — with `GSD_WORKSTREAM` set, these two workflows previously still read and wrote the root `.planning/STATE.md`/`ROADMAP.md`/milestone archive instead of the selected workstream's own files, silently ignoring or corrupting the wrong scope's planning state. Shared files (`MILESTONES.md`, `PROJECT.md`) are unaffected, per their documented shared-file contract.
