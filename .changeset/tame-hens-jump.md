---
type: Fixed
pr: 4552
---
**`npm run check:env`'s npm-version check no longer misreports a timeout as a missing binary** — every `spawnSync` failure mode (ENOENT, a signal-killed timeout under load, a non-zero exit, a thrown spawn error) used to collapse into one message, "npm binary not found on PATH." Discovered live: an unrelated PR's Windows CI shard failed this check under heavy concurrent test load, and the message made a real timeout indistinguishable from npm genuinely being absent. The reason is now reported accurately; the check's own 10s timeout is unchanged. (#4460)
