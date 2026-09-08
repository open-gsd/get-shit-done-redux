---
type: Fixed
pr: 0
---
**`state begin-phase` no longer rewrites prose that merely quotes the Current-focus field label** — the bold-form rewrite was unanchored, so a bold label quoted mid-sentence elsewhere in the body (e.g. a historical note documenting the format) captured the update and silently destroyed the rest of its line while the real field went unset. Same fix shape as the #4243 fix to the shared field-replacement helper: anchored to line start, same-line whitespace only.
