---
type: Fixed
pr: 4253
---
**`commit --files` can now record a file move without a directory pathspec** — a new `--files-removed <paths>` list declares the deletions the caller intends: each named file, or each tracked-but-absent file under a named directory, is staged as a deletion and joins the commit pathspec. Previously the #2014 skip-if-missing guard meant the only form that recorded a move was a directory entry in `--files`, which also committed any unrelated file sitting in that directory — in the unattended end-of-phase todo sweep, a concurrent session's in-flight todo landed under a phase-close message with no warning, while the file-precise form left the old path's deletion dangling and the todo tracked at both paths. `--files` keeps its skip-if-missing contract unchanged; a `--files-removed` file entry that is still present on disk fails the commit closed. The `execute-phase` todo sweep and the `cleanup` archive commit now name their removals instead of their directories.
