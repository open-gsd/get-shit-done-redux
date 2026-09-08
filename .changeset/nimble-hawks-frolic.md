---
type: Fixed
pr: 4549
---
**`update_codebase_map` (execute-plan.md) now scopes its diff to the current milestone** — its diff-base derivation used an unbounded commit-subject search that, on a milestone reusing a phase number, picked up the previous milestone's same-numbered phase and mis-attributed its files to the codebase map.
