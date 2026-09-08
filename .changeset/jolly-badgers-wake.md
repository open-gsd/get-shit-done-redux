---
type: Added
pr: 0
---
**Six more workflow spines split into a terser form under `workflow.compact_content`** — `execute-phase`, `docs-update`, `new-project`, `verify-work`, and `complete-milestone` join `plan-phase` (#4402), each moving genuinely optional or rare content (interactive-mode flows, crash-resume gates, off-by-default features, gap-closure loops, cross-AI delegation, branch-merge mechanics) into a deferred `<workflow>/detail/*.md` elaboration read only when the key is off. The refreshed benchmark reports a 16.75% aggregate token reduction across the six splits. The remaining eagerly-included workflows were reviewed and recorded as not worth splitting, with reasons, in `docs/PARTITION-RULES.md`. (#4405)
