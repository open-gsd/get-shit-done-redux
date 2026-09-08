---
type: Fixed
pr: 0
---
**The catastrophic-shrink write-guard now protects workstream-scoped planning files** — `hooks/gsd-write-guard.js`'s curated-file patterns only matched root-level `.planning/STATE.md`/`ROADMAP.md`/milestone archives, so a large-shrink Write to a workstream-scoped copy of the same files (`.planning/[<project>/]workstreams/<ws>/...`) was never blocked. Found while fixing #4455's workstream-scoped path resolution, which makes such writes reachable via `/gsd-complete-milestone`'s own instructions.
