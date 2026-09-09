---
type: Fixed
pr: 4552
---
**`/gsd-code-review --files` no longer silently widens back to the whole phase** — Tier 3's SUMMARY/diff cross-check ran regardless of an explicit `--files` override, appending the rest of the phase's changed files onto a scope the user had deliberately narrowed.
