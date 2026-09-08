---
type: Fixed
pr: 0
---
**Structural pre-pass now documents that its fallow scope has no upper bound** — the phase-directory-anchored base is correct and lockstep with Tier 3's own scope step, but nothing bounds the tip, so reviewing an earlier phase after a later one has landed could silently pull the later phase's files into the audit. The limitation is now documented at the point the scope is derived.
