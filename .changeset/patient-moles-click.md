---
type: Added
pr: 0
---
**`workflow.compact_content` now also covers lazily-read workflow fragments and planning-artifact templates.** With the key on, `help --full`'s reference doc and generated `SUMMARY.md`/`USER-SETUP.md` templates resolve to a terser `.compact.md` sibling at the point of their existing `Read` — two independent, complete files, picked per the same shared gate Phase 5 introduced (`gsd-core/references/compact-content-gate.md`). With the key off (default), nothing changes.
