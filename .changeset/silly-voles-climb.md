---
type: Fixed
pr: 4579
---
**Corrected the native-plugin-install docs' parity claim** — the doc previously said the plugin path and the npm installer differ only in namespace and lifecycle. They also differ in whether install-time config applies at all: the native plugin path never runs GSD's install engine, so config like `agent_tools` that the npm installer bakes into generated artifacts at install time silently never applies there, even after `claude plugin update`. (#4484)
