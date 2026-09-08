---
type: Fixed
pr: 4542
---
**The catastrophic-shrink write-guard now protects workstream- and project-scoped planning files** — `hooks/gsd-write-guard.js`'s curated-file patterns only matched root-level `.planning/STATE.md`/`ROADMAP.md`/milestone archives, so a large-shrink Write to a workstream-scoped (`.planning/[<project>/]workstreams/<ws>/...`) or project-only-scoped (`.planning/<project>/...`) copy of the same files was never blocked. Found while fixing #4455's workstream-scoped path resolution, which makes such writes reachable via `/gsd-complete-milestone`'s own instructions.
