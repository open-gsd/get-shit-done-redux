---
type: Fixed
pr: 4531
---
**The API coverage verify gate now checks the requested workstream phase** — qualified phase directories remain authoritative, and bare phase tokens honor the explicit `--ws` scope instead of resolving an equal-numbered phase from the ambient workstream. (#4498)
