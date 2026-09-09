---
type: Fixed
pr: 4575
---
**The worktree-path guard no longer fails open under CI/process load** — it combined three sequential `git` subprocess spawns into one, cutting the worktree-escape check's worst-case latency so a busy runner can no longer push the guard past its own timeout into a silent allow. (#4515)
