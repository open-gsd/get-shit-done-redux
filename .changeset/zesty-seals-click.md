---
type: Security
pr: 4560
---
**Pinned the transitive `hono` dependency to `>=4.13.5`** — fixes a moderate-severity path-traversal/DoS advisory chain (GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx) in `hono <4.13.5`, pulled in transitively via `@anthropic-ai/claude-agent-sdk` -> `@modelcontextprotocol/sdk`. Discovered as a newly-published advisory blocking `tests/npm-integrity-gate.test.cjs` while verifying an unrelated PR; fixed inline per this repo's no-defer policy rather than left for a separate PR. (#4513)
