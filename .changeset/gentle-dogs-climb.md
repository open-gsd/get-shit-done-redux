---
type: Fixed
pr: 4539
---
**`git commit` with a large `-m` message is no longer slow** — the commit-message validator hook computed the text after the message with a pattern match that is quadratic in the message length, on the path every commit takes and before the pass/fail branch, so conforming and non-conforming messages cost the same: 10.0s at a 64KB message, 30.2s at 112KB. Claude Code blocks on PreToolUse hooks, so that was dead time in front of the user. The suffix is now derived by arithmetic from the match already located on the preceding line — byte-identical output, flat 0.2s at every size measured. (#4492)
