---
type: Fixed
pr: 0
---
**`/gsd-quick`'s post-execute review no longer scopes past its own last commit** — the review-scoping step diffed against bare HEAD instead of the quick task's own newest commit, so any later commit landing on the same tree before the review ran (a worktree merge-back, a shared tree) was silently folded into the quick task's own code-review scope.
