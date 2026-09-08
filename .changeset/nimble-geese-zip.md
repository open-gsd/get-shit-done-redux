---
type: Fixed
pr: 4543
---
**`/gsd-complete-milestone`'s safety commit and every `/gsd-init`-family command now correctly treat PROJECT.md as a file shared across workstreams, not a per-workstream file** — a #4455 follow-up regression (and one pre-existing, adjacent bug) resolved PROJECT.md through the workstream-scoped path instead of the documented shared root path, so under an active workstream the safety commit silently missed the real PROJECT.md and every init command's `project_title` field silently disappeared.
