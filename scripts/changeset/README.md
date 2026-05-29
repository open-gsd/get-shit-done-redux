# changeset/ — release-notes tooling

This directory holds the scripts that turn per-PR fragments in [`.changeset/`](../../.changeset/README.md)
and git history into the project's `CHANGELOG.md` and GitHub release notes.

The entry point is `cli.cjs`. It exposes three subcommands:

| Subcommand | Purpose |
|---|---|
| `render` | Render a single version's changelog section from consolidated data. |
| `github-release-notes` | Build GitHub release-notes body for a ref range. |
| `extract` | Pull existing `CHANGELOG.md` entries that fall in a version range. |

The rest of this document specifies the **`extract`** contract, because it is the
surface most likely to be called by external tooling (CI workflows, npm scripts,
release automation) that needs a stable exit-code and output guarantee to code
against.

---

## `cli.cjs extract`

Extract the changelog entries for every release in a version range, reading from
an existing `CHANGELOG.md`. The range is **`--from` exclusive, `--to` inclusive**.

```bash
node scripts/changeset/cli.cjs extract --from VERSION --to VERSION \
  [--changelog FILE] [--repo <dir>] [--json]
```

### Flags

| Flag | Required | Description |
|---|---|---|
| `--from VERSION` | Yes | Lower bound, **exclusive** — entries equal to `--from` are not returned. |
| `--to VERSION` | Yes | Upper bound, **inclusive** — entries equal to `--to` are returned. |
| `--changelog FILE` | No | Path to the changelog to read. Defaults to `<repo>/CHANGELOG.md`. |
| `--repo <dir>` | No | Repo root used to locate `CHANGELOG.md` when `--changelog` is omitted. Defaults to the current working directory. |
| `--json` | No | Emit the structured report as JSON instead of rendered markdown. |

### Version validation

Both `--from` and `--to` must be **stable triplet semver** — `MAJOR.MINOR.PATCH`,
digits only.

- A leading `v` is accepted and stripped: `v1.42.0` is treated as `1.42.0`.
- Pre-release and build suffixes are **rejected**: `1.42.0-rc.1`, `1.42.0+build`,
  and partial versions like `1.42.x` all fail validation and exit `1`.

Strict validation is deliberate. Coercing a malformed bound such as `1.42.x` to
`1.42.0` would silently change which releases the range selects, so a malformed
bound is rejected early with a structured error rather than guessed at.

Changelog entries that are themselves pre-release or non-semver (and the
`Unreleased` section) are skipped during matching; a notice for each skipped
entry is written to stderr.

### Exit codes

`extract` resolves to one of three exit codes. The output shape depends on
whether `--json` is passed.

| Exit | Meaning | Default stdout | `--json` stdout |
|---|---|---|---|
| `0` | One or more releases fall in the range. | Rendered markdown for the matched releases. | `{ "releases": [ ... ], "from": "...", "to": "..." }` |
| `1` | Bad input: `--from`/`--to` is not stable semver, a required flag is missing, or the changelog file was not found. | Nothing (a missing-flag error and usage go to stderr). | `{ "error": "<message>", "releases": [] }` |
| `2` | Bounds are valid but no release falls in the range. | A `no releases found in range` notice on stderr. | `{ "releases": [], "from": "...", "to": "..." }` |

Notes for callers:

- **Treat exit `2` as "empty range", not "failure".** For a well-formed
  invocation it means the request was understood and simply matched nothing — do
  not surface it as an error. (At the argument-parsing layer, malformed argv such
  as an unknown flag also exits `2`; pass well-formed arguments and this overlap
  does not arise.)
- **In default (text) mode, a failure is signalled by the exit code alone** —
  exit `1` from invalid semver or a missing changelog writes nothing to stdout.
  Machine consumers should pass `--json` to receive the `error` field.

### Output shape

With `--json`, the report is pretty-printed JSON. The `releases` array contains
one object per matched release (version, date, and parsed sections); `from` and
`to` echo the normalized bounds. On exit `1`, `releases` is empty and an `error`
string describes the failure.

Without `--json`, exit `0` prints the matched releases as markdown, ready to
paste into release notes:

```text
## [1.42.0] - 2026-01-15

### Added

- New `--json` flag on the extract command (#3796)

### Fixed

- Trailing-slash handling in config paths (#3651)
```

### Examples

Extract everything released after `1.41.0` up to and including `1.42.0`:

```bash
node scripts/changeset/cli.cjs extract --from 1.41.0 --to 1.42.0
```

The same range as structured JSON, reading an explicit changelog file:

```bash
node scripts/changeset/cli.cjs extract \
  --from v1.41.0 --to v1.42.0 \
  --changelog ./CHANGELOG.md --json
```

Handle the three outcomes in a shell consumer:

```bash
if out=$(node scripts/changeset/cli.cjs extract --from "$FROM" --to "$TO" --json); then
  echo "$out"            # exit 0 — releases found
else
  case $? in
    2) echo "no releases in range — nothing to publish" ;;  # not an error
    *) echo "extract failed: $out" >&2; exit 1 ;;            # exit 1 — bad input
  esac
fi
```
