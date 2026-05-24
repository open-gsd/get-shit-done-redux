# Introduce `next` as a long-lived integration branch

- **Status:** Proposed
- **Date:** 2026-05-23

> **Filename note.** This ADR uses the placeholder (now resolved to `230`) per
> [CONTRIBUTING.md §Proposing an ADR](../../CONTRIBUTING.md). Before merging,
> open a `chore:` issue, replace `XXXX` with the assigned issue number, and
> rename the file accordingly.

## Context

Today every contributor branch — `feat/`, `fix/`, `chore/`, `docs/`,
`refactor/`, `test/`, `perf/`, `ci/`, `revert/` — is cut from `main` and PR'd
back to `main`. Release branches (`release/X.Y.0`) and hotfix branches
(`hotfix/X.Y.Z`) are also cut from `main`. As a result:

1. **`main` moves on every merge.** With ~315 unreleased changesets queued
   and multiple PRs in flight at any time, `main` advances multiple times a
   day.
2. **GitHub branch protection on `main` requires "branches up to date before
   merging"** (the dominant pattern across mature OSS projects with linear
   history). Every time another PR lands, every in-flight PR must rebase
   before its own merge button enables.
3. **`release/X.Y.0` accumulates RC-cycle fixes that drift from `main`.**
   When `finalize` opens the merge-back PR, the diff is large and
   contributors who PR'd to `release/*` can't be sure their fix is also
   queued for the next minor.
4. **`hotfix.yml` cherry-picks `fix:`/`chore:` commits from `main` since the
   prior tag.** This works today only because every fix lands on `main`.
   The pattern is fragile — any deviation (e.g. fix landing on `release/*`)
   is invisible to the picker. v1.42.3 (#3621) shipped a half-state for
   exactly this class of reason.

The maintainer's stated pain: *"every update doesn't mean the next pr needs
a rebase"* — i.e. the rebase treadmill from (2), driven by (1).

## Decision

Introduce **`next`** as a long-lived integration branch.

- All work that today targets `main` instead targets `next`, with the sole
  exceptions of `release/X.Y.0` and `hotfix/X.Y.Z` branches, which still
  merge to `main`.
- `next` is always at-or-ahead of `main`. Any push to `main` (release or
  hotfix merge) triggers an automated back-merge PR `main → next` to keep
  `next` aligned.
- Branch protection rules differ:
  - **`main`** — strict: 2 reviewer approvals, all CI green, "require
    branches up to date" **ON**, signed commits, restrict push to maintainers
    via PR only.
  - **`next`** — loose: 1 reviewer approval, all CI green, "require branches
    up to date" **OFF**, auto-delete source branches.
- Default branch (in repo Settings) becomes `next`. `gh pr create` and the
  GitHub web UI then default new PRs to the correct target without a flag.

### Where each branch type goes

| Branch prefix | Today's target | New target | Rationale |
|---|---|---|---|
| `feat/` | `main` | `next` | Features ship in minor releases |
| `fix/` | `main` | `next` | Regular fixes ship in minor (or get cherry-picked by hotfix.yml) |
| `chore/`, `docs/`, `refactor/`, `test/`, `perf/`, `ci/`, `revert/` | `main` | `next` | All same-flow as fixes |
| `fix/critical-*` | `main` | `main` | Production-down only, auto-back-merges to `next` |
| `release/X.Y.0` | `main` | `main` (cut from `next`) | Promoted to production on finalize |
| `hotfix/X.Y.Z` | `main` | `main` (cut from prior tag, cherry-picks from `next`) | Patch releases |

### Mechanical changes summary

| Component | Change |
|---|---|
| `release.yml` (`create`) | Branch from `next`, not `main` |
| `release.yml` (`finalize`) | Open merge-back PR to **both** `main` and `next` (was just `main`) |
| `hotfix.yml` (cherry-pick step) | Cherry-pick from `origin/next`, not `origin/main` |
| `hotfix.yml` (`finalize`) | Open merge-back PRs to both `main` and `next` (was just `main`) |
| `branch-naming.yml` | Add `next` to `alwaysValid` list |
| `auto-branch.yml` | Branch from `next` HEAD instead of `main` HEAD for issue-labeled branches |
| New `pr-target-validator.yml` | Block PRs targeting `main` from branches that aren't `release/*`, `hotfix/*`, or `fix/critical-*` |
| New `auto-backmerge.yml` | On push to `main`, open `main → next` PR |
| Repo settings | Default branch = `next`; squash-merge only on `next`; merge-commit on `main` (preserve tag context) |
| `scripts/setup-branch-protection.sh` | New: idempotent script to apply both branch protection rule sets via `gh api` |

## Consequences

### Positive

- **Rebase treadmill ends.** PRs targeting `next` are not gated on
  "up-to-date before merge". Concurrent PRs to `next` merge in any order as
  long as they don't conflict on the same lines.
- **`main` becomes a stable reference.** It changes only on release/hotfix
  merges — a handful of times per week, not multiple times per day. CI on
  `main` runs less; downstream consumers (linked CI, npm tag watchers) see
  fewer transient states.
- **Hotfix cherry-pick base is unambiguous.** All `fix:`/`chore:` commits
  candidate for a hotfix live on `next`. The cherry-pick filter (today
  hardcoded against `origin/main`) becomes correct-by-construction once
  retargeted to `origin/next`.
- **RC-only fixes flow back to `next` automatically.** Today a fix that
  lands on `release/1.28.0` to unblock RC2 only makes it to `next`-equivalent
  (i.e. `main`) when finalize back-merges. Under the new model finalize
  back-merges to both `main` and `next`, so an RC fix is never accidentally
  dropped from the next minor.
- **Default branch switch is one click.** Cost is low; setting takes effect
  for every new PR and clone immediately.

### Negative

- **One more concept to teach contributors.** Mitigated by `docs/branching.md`
  + CONTRIBUTING update + PR-target validator that says "retarget to `next`"
  with a one-line fix instruction.
- **Hotfix and release workflows need updates.** Patches are inlined below.
  Both are reversible — if a patch causes pain, revert and re-target the
  workflows back to `main`. No on-disk state migration required.
- **The auto-backmerge PR is a new background-noise source.** It opens
  silently after each release/hotfix push to `main`. Mitigated by labeling
  the PR `automation` and auto-merging if CI passes (configurable in
  `auto-backmerge.yml`).
- **Existing 315-changeset queue.** Doesn't strictly block this change but
  the next release will be a large one. Recommend cutting `1.28.0` from
  `main` (current behavior, last time) before flipping the default branch
  to `next` — see "Migration" below.

### Risks not worth the trade-off

We considered and rejected:

- **`develop` instead of `next`.** The git-flow nomenclature is established
  but the gitflow model itself is heavier than this project needs (no
  long-lived `release/*` branches per-major, no `support/*` for old majors).
  `next` matches the existing npm dist-tag (`@next`) and is the convention
  for Angular, Next.js, React Native, and others. Use the name that already
  appears in `VERSIONING.md`.
- **Merge queue.** GitHub's merge queue (GA in 2023) addresses the same
  pain by serializing merges and rebasing+testing automatically. Rejected
  because (a) it doesn't address the parallel work-stream separation that a
  `next` branch gives, (b) it still requires "branches up to date" which we
  want to relax, and (c) the maintainer is a git beginner and merge queue's
  failure modes (split commits, requeued PRs) are harder to debug than a
  conventional model.
- **Pure trunk-based with feature flags.** Rejected because the project
  publishes to npm and doesn't have a runtime feature-flag system. Feature
  flags would be a larger separate investment.

## Migration

This is a phase-gated rollout. Each phase is reversible.

### Phase 0 — Decide

1. Open a `chore:` issue: "Introduce `next` integration branch". Get the
   issue number. Rename this ADR file from `XXXX-` to `<issue#>-`.
2. Review this ADR. Decide on the merge-commit-vs-squash policy for `next`
   (recommended: squash) and for `main` (recommended: merge commit on
   release back-merges, to preserve the tag-commit relationship).

### Phase 1 — Additive infrastructure (no behavior change)

The following land on `main` (current model, one last time) before flipping:

- `docs/branching.md` (new)
- `docs/adr/<issue#>-introduce-next-integration-branch.md` (this file)
- `scripts/setup-branch-protection.sh` (new)
- `.github/workflows/auto-backmerge.yml` (new, disabled with
  `if: false` until phase 2)
- `.github/workflows/pr-target-validator.yml` (new, in "warning only" mode)
- `.github/workflows/branch-naming.yml` (update: add `next` to `alwaysValid`)
- CONTRIBUTING.md update: "Where do I open my PR?" section

### Phase 2 — Flip

When the next release is ready to start its RC cycle:

1. Cut the current planned release (e.g. `1.28.0`) using `release.yml` as
   today — this drains the 315-changeset queue from `main` cleanly.
2. After `v1.28.0` finalizes and back-merges to `main`, run:
   ```bash
   git checkout main && git pull --ff-only
   git checkout -b next && git push -u origin next
   ```
3. Apply branch protection: `bash scripts/setup-branch-protection.sh`.
4. Settings → Branches → change default branch to `next`.
5. Re-enable `auto-backmerge.yml` (remove the `if: false`).
6. Flip `pr-target-validator.yml` from warning-only to enforcing.

### Phase 3 — Retarget release/hotfix workflows

Apply these patches once `next` is established and the team has run at
least one feature PR through it.

**`release.yml` — branch from `next` (create step):**

```diff
@@ create:
       - name: Create release branch
         env:
           BRANCH: ${{ needs.validate-version.outputs.branch }}
           VERSION: ${{ inputs.version }}
           IS_MAJOR: ${{ needs.validate-version.outputs.is_major }}
         run: |
+          git fetch origin next:next || git fetch origin main:main
-          git checkout -b "$BRANCH"
+          git checkout -b "$BRANCH" next 2>/dev/null || git checkout -b "$BRANCH" main
```

The `|| main` fallback is for the transition window where `next` may not
yet exist. After Phase 2 the fallback can be removed.

**`release.yml` — back-merge to both branches (finalize step):**

```diff
@@ Create PR to merge release back to main
       - name: Create PR to merge release back to main
         ...
+      - name: Create PR to merge release back to next
+        if: ${{ !inputs.dry_run }}
+        continue-on-error: true
+        env:
+          GH_TOKEN: ${{ github.token }}
+          BRANCH: ${{ needs.validate-version.outputs.branch }}
+          VERSION: ${{ inputs.version }}
+        run: |
+          EXISTING_PR=$(gh pr list --base next --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null || echo "")
+          if [ -n "$EXISTING_PR" ]; then
+            gh pr edit "$EXISTING_PR" \
+              --title "chore: merge release v${VERSION} to next" \
+              --body "Merge release branch back to next after v${VERSION} stable release (picks up RC-only fixes)." \
+              || echo "::warning::Could not update next merge-back PR. Open it manually."
+          else
+            gh pr create \
+              --base next \
+              --head "$BRANCH" \
+              --title "chore: merge release v${VERSION} to next" \
+              --body "Merge release branch back to next after v${VERSION} stable release (picks up RC-only fixes)." \
+              || echo "::warning::Could not create next merge-back PR. Open it manually."
+          fi
```

**`hotfix.yml` — cherry-pick from `next` (with `main` fallback):**

```diff
@@ Cherry-pick fix/chore commits from origin/main since base tag
-      - name: Cherry-pick fix/chore commits from origin/main since base tag
+      - name: Cherry-pick fix/chore commits from origin/next since base tag
         ...
         run: |
           set -euo pipefail
-          git fetch origin main:refs/remotes/origin/main
+          # Prefer next; fall back to main during the transition window or
+          # for production-down emergencies that landed directly on main.
+          if git ls-remote --exit-code origin next >/dev/null 2>&1; then
+            git fetch origin next:refs/remotes/origin/next
+            SOURCE="origin/next"
+          else
+            git fetch origin main:refs/remotes/origin/main
+            SOURCE="origin/main"
+          fi

-          CANDIDATES=$(git cherry "$BASE_TAG" origin/main | awk '/^\+ / {print $2}')
+          CANDIDATES=$(git cherry "$BASE_TAG" "$SOURCE" | awk '/^\+ / {print $2}')
...
-          ORDERED=$(git log --reverse --format='%H' "$BASE_TAG..origin/main" \
+          ORDERED=$(git log --reverse --format='%H' "$BASE_TAG..$SOURCE" \
             | grep -F -f <(echo "$CANDIDATES") || true)
```

**`hotfix.yml` — back-merge to both branches (finalize step):**

```diff
@@ Create PR to merge hotfix back to main
       - name: Create PR to merge hotfix back to main
         ...
+      - name: Create PR to merge hotfix back to next
+        if: ${{ !inputs.dry_run }}
+        env:
+          GH_TOKEN: ${{ github.token }}
+          BRANCH: ${{ needs.validate-version.outputs.branch }}
+          VERSION: ${{ inputs.version }}
+        run: |
+          EXISTING_PR=$(gh pr list --base next --head "$BRANCH" --state open --json number --jq '.[0].number')
+          if [ -n "$EXISTING_PR" ]; then
+            gh pr edit "$EXISTING_PR" \
+              --title "chore: merge hotfix v${VERSION} back to next" \
+              --body "Merge hotfix changes back to next after v${VERSION} release."
+          else
+            gh pr create \
+              --base next \
+              --head "$BRANCH" \
+              --title "chore: merge hotfix v${VERSION} back to next" \
+              --body "Merge hotfix changes back to next after v${VERSION} release."
+          fi
```

**`auto-branch.yml` — branch from `next`:**

```diff
-            // Create branch from main HEAD
-            const mainRef = await github.rest.git.getRef({
+            // Create branch from next HEAD (fall back to main if next missing)
+            let baseRef;
+            try {
+              baseRef = await github.rest.git.getRef({
                 owner: context.repo.owner,
                 repo: context.repo.repo,
-              ref: 'heads/main',
-            });
+                ref: 'heads/next',
+              });
+            } catch (e) {
+              if (e.status !== 404) throw e;
+              baseRef = await github.rest.git.getRef({
+                owner: context.repo.owner,
+                repo: context.repo.repo,
+                ref: 'heads/main',
+              });
+            }

             await github.rest.git.createRef({
               owner: context.repo.owner,
               repo: context.repo.repo,
               ref: `refs/heads/${branch}`,
-              sha: mainRef.data.object.sha,
+              sha: baseRef.data.object.sha,
             });
```

### Phase 4 — Cleanup

After 2-3 successful releases under the new model:

- Remove the `|| main` fallbacks from `release.yml` and `hotfix.yml`.
- Remove `develop` from `branch-naming.yml` `alwaysValid` (it was vestigial;
  the project never used it).
- Drop warning-only mode from `pr-target-validator.yml`.

## References

- `docs/branching.md` — contributor-facing how-to-use-it guide
- `VERSIONING.md` — semver tiers and npm dist-tag mapping
- `.github/workflows/release.yml`, `.github/workflows/hotfix.yml` —
  release/hotfix automation that this ADR adjusts
- `scripts/setup-branch-protection.sh` — bootstrap script for branch
  protection rules
- [Angular branching model](https://github.com/angular/angular/wiki/Branching-Strategy)
  — closest analogue (`main` + `<version>-next`)
- [Next.js release flow](https://github.com/vercel/next.js#contributing)
  — uses `canary` as the integration branch with the same shape
