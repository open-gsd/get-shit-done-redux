---
type: Added
pr: 4583
---
**Broken-windows ledger entries now record which milestone they belong to** — `windows append` stamps a new `milestone` field from the workstream's resolved milestone version. Phase numbers are unique only within one active phases directory, so two milestones routinely produced entries sharing the same phase number with nothing to distinguish them; `/gsd-ship`'s open-count gate could be silently blocked by another, already-shipped milestone's entries. Absence (an entry recorded before this field existed) reads as null — existing ledgers keep working with no migration.
