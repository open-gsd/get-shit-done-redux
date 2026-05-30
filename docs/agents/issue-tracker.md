# Issue tracker: GitHub

Issues for this repo live in **GitHub Issues** at `open-gsd/gsd-core`.

## Auth

Use the configured GitHub CLI session for this checkout. Do not require a
repo-local `.envrc` before running `gh`.

## Conventions

- **Create**: `gh issue create --repo open-gsd/gsd-core --title "..." --body "..."`
- **Read**: `gh issue view <number> --repo open-gsd/gsd-core --comments`
- **List**: `gh issue list --repo open-gsd/gsd-core --state open --json number,title,labels --jq '...'`
- **Comment**: `gh issue comment <number> --repo open-gsd/gsd-core --body "..."`
- **Label**: `gh issue edit <number> --repo open-gsd/gsd-core --add-label "..." --remove-label "..."`
- **Close**: `gh issue close <number> --repo open-gsd/gsd-core --comment "..."`

Always pass `--repo open-gsd/gsd-core` explicitly — the local clone has multiple remotes and `gh` may resolve to the wrong one.

## When a skill says "publish to the issue tracker"

Create a GitHub issue at `open-gsd/gsd-core`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo open-gsd/gsd-core --comments`.
