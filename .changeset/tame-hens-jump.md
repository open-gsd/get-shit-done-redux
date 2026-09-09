---
type: Fixed
pr: 4552
---
**`npm run check:env`'s npm-version check no longer times out under CI contention, and no longer misreports a timeout as a missing binary** — the check hand-rolled its own `spawnSync` call with a 10s timeout, duplicating (imperfectly) this repo's canonical OS-shell-projection seam. Discovered live: an unrelated PR's Windows CI shard failed this check twice under heavy concurrent test load. Now routed through `execNpm` (the same seam other npm-invoking code already uses), which gives it the canonical 15s timeout and the canonical, cross-platform-correct timeout detection — a real timeout is now reported as one, distinct from npm genuinely being absent. (#4460)
