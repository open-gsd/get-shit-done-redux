---
type: Fixed
pr: 0
---
**`/gsd-new-project`'s sub-repo detection now finds linked git worktrees** — a linked worktree's `.git` is a file rather than a directory, and the previous detection predicate silently excluded it from the multi-repo prompt.
