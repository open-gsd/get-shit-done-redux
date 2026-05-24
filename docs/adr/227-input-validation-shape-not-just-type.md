# ADR 227: Input validation must check semantic shape, not just type

- **Status:** Accepted (2026-05-24)
- **Date:** 2026-05-24

## Context

Defensive normalization at trust boundaries typically starts with a type check:

```js
if (typeof value !== 'string') return undefined;
```

This stops non-string values but accepts any string — including the empty string, garbage payloads, and values that are structurally correct (a string) but contractually invalid (not a UUID v4, not a semver, not a file path). The remaining attack surface is the gap between "is a string" and "satisfies the field's contract."

### The PR #225 trigger

PR #225 (`refactor/178-trace-id-propagation`, P1.4 of ADR-0174 SDK retirement) introduced `parentTraceId` on `DispatchEvent`. The initial implementation normalized the field with a type-only guard:

```js
parentTraceId: typeof raw.parentTraceId === 'string' ? raw.parentTraceId : undefined,
```

Codex adversarial-review (commit range `fb94ba8d`–`338d0951`) flagged that this propagated:

- empty strings (`""`) — a correlation key that matches nothing
- garbage strings (`"not-a-uuid"`, `";"`, `"<script>..."`) — log bloat, downstream parser confusion
- oversized strings — potential high-cardinality index explosion in tracing back-ends

The field's contract is UUID v4. The fix was a strict regex with silent coercion:

```js
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
parentTraceId: UUID_V4.test(raw.parentTraceId) ? raw.parentTraceId : undefined,
```

### The generalizing precedent

ADR 218 (`docs/adr/218-release-version-validation.md`) documents the same two-layer pattern applied earlier to the release-workflow version input: a type-level format regex was tightened to reject leading-zero segments (semantic-shape enforcement), and a duplicate-version precheck was added at validation time. That ADR is narrowly scoped to the release workflow; this ADR captures the general principle so future contributors can cite it during code review without needing to derive it from the release-workflow incident.

## Decision

Defensive normalization at any trust boundary MUST validate two layers:

1. **Type** — `typeof`, `instanceof`, `Array.isArray`, schema-type check
2. **Semantic shape** — regex, schema, range, or enum check that proves the value satisfies the field's contract

On failure of **either** layer, the value MUST be silently coerced to the contract's safe default (typically `undefined` or `null`). It MUST NOT be propagated. Throw only if the surrounding codebase treats throws as a normal-flow signal (it usually does not — dispatch pipelines must remain continuous).

Both layers are required. A type check alone is necessary but not sufficient.

## Consequences

### Bug classes avoided

- **Correlation poisoning** — a garbage `parentTraceId` propagated into a trace back-end creates phantom spans that never match a real root.
- **High-cardinality log bloat** — unsanitized free-form strings as structured-log field values balloon index size in Elasticsearch, Datadog, etc.
- **Downstream parser crashes** — a field typed as UUID v4 but containing `";"` or a 2 KB payload can crash a consumer that assumed a bounded, well-formed value.

### Cost

One additional regex or predicate per trust-boundary field. For most fields this is a one-liner compiled once at module load. The maintenance burden is low.

### Tradeoff

Silent coercion hides invalid inputs from callers — a buggy upstream component may send garbage and never learn it was rejected. Mitigate with an opt-in debug log (`process.env.GSD_DEBUG`) that surfaces the coercion without affecting production behavior.

## Concrete cases

### Case 1 — `parentTraceId` on `DispatchEvent` (PR #225)

| | Detail |
|---|---|
| Field | `parentTraceId: string \| undefined` |
| Contract | UUID v4 |
| Initial impl | `typeof raw.parentTraceId === 'string'` — type check only |
| Codex finding | Commit range `fb94ba8d`–`338d0951`; flagged correlation poisoning and log bloat |
| Fix | `UUID_V4.test(raw.parentTraceId) ? raw.parentTraceId : undefined` |

### Case 2 — release-workflow `version` input (ADR 218)

| | Detail |
|---|---|
| Field | `version: string` (GitHub Actions workflow input) |
| Contract | Semver `MAJOR.MINOR.0`, no leading zeros |
| Initial impl | `^[0-9]+\.[0-9]+\.0$` — type regex only; `1.01.0` accepted |
| Semantic fix | `^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)\.0$` — rejects leading zeros |
| Duplicate precheck | Added npm `view` call at validation time to reject already-published versions early |

See [ADR 218](218-release-version-validation.md) for the full incident account.

## Alternatives considered

### Type-only checks (status quo before this ADR)

Rejected. The cases above prove that type-only checks leave the harder bug class open. A string is not a UUID; a string is not a semver. The type check is the floor, not the ceiling.

### Schema validation library (Zod, ajv)

Rejected for the current CJS phase. Adding a runtime dependency to the core library violates the project's no-external-dependencies policy for `gsd-tools.cjs`. Project-internal patterns prefer surgical regex/predicate functions. The `src/` TypeScript phase may revisit if Zod is adopted broadly — that is a separate decision.

### Throwing on invalid input

Rejected. Throwing breaks dispatch pipeline reliability. The dispatch pipeline must be continuous; a bad `parentTraceId` must not abort event dispatch. Silent coercion preserves continuity; an opt-in debug warn preserves visibility. Fields where an invalid value is genuinely fatal (not just malformed) may throw — that is a per-field decision, not the general rule.

## Related

- Issue: #227
- PR introducing: this PR
- Cross-references: ADR 218 (`docs/adr/218-release-version-validation.md`)
