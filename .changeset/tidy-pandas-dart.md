---
type: Added
pr: 4553
---
**Compact agent-persona payloads for non-Claude runtime dispatch, selected by `workflow.compact_content`.** When the key is on, the AGENTS-native persona fallback (kimi-code, opencode, kilo, and similar runtimes without named-subagent dispatch) now serves a token-minimized `.compact.md` variant of the agent's persona instead of the full file, chosen by the same CLI seam (`gsd_run query agent-skills`) that already resolves this content in code rather than prose. An agent with no compact variant registered falls back to the canonical persona and discloses the fallback in the payload itself, so nothing is ever served silently or left empty. (#4407)
