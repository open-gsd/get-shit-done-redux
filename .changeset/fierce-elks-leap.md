---
type: Security
pr: 4565
---
**Patched a CPU-exhaustion issue in the vendored YAML parser (`js-yaml` 4.3.2)** — merge-key processing in YAML documents now counts empty mapping merges toward the existing `maxTotalMergeKeys` limit, closing a gap upstream backported from 5.4.1 (nodeca/js-yaml#797).
