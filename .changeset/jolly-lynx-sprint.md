---
type: Removed
pr: 4540
---
**Removed 8 unreferenced planning-artifact scaffolding templates under `gsd-core/templates/`** (`claude-md.md`, four of the seven `codebase/` brownfield-mapping templates — `concerns.md`, `conventions.md`, `integrations.md`, `structure.md` — plus `debug-subagent-prompt.md` and `discovery.md`) — confirmed, file by file, to have zero references anywhere in workflow prose, agent/command definitions, compiled source, or tests, and (for the deleted set specifically) no surviving basename reference anywhere in the tree either. `codebase/architecture.md`, `codebase/stack.md`, and `continue-here.md` were kept: their basenames collide with unrelated, genuinely live concepts documented across many files (a user's generated `.planning/codebase/*.md` output, and the real `.continue-here.md` pause-work artifact), so deleting them would have required rewording numerous translated docs to describe something else entirely.
