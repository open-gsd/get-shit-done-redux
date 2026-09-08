# verify-work.md — deferred elaboration

Read in full when `workflow.compact_content` is `false` (the default) — see
`gsd-core/references/compact-content-gate.md` for the check and resolution rule this
spine defers to. Each `§` below is the full text the spine condenses at the point it
names.

## § 1 — reconcile_gaps

**Reconcile diagnosed gaps against completed gap-closure plans (#1921):**

When verify-work resumes after `/gsd:execute-phase --gaps-only`, the UAT `## Gaps` entries still read `status: failed` even though their fix plans have executed. Without reconciliation verify-work re-diagnoses them as fresh blockers and spawns new gap plans — losing the verification state. This step closes the loop.

Read the UAT `## Gaps` section and the phase dir `*-PLAN.md` frontmatter. For each gap with `status: failed`:
1. Find a `*-PLAN.md` whose frontmatter `gap_ids` includes the gap's `gap_id` (`G-{phase}-{N}`).
2. If such a plan exists AND has a matching `*-SUMMARY.md` in the phase dir (the plan was executed by `--gaps-only`), the gap is **resolved** — update its YAML in place:
   ```yaml
   - gap_id: G-{phase}-{N}
     status: resolved        # was: failed
     resolved_by: {plan basename}
     resolved_at: {today}
   ```
3. If no plan references the `gap_id`, or the plan has no SUMMARY, leave the gap `status: failed` (still open).

Read plan frontmatter directly in-context — do not pipe it through a shell parser. After reconciliation, announce:
```
Reconciled gap-closure state: {resolved_count} gap(s) resolved by executed plans, {open_count} still open.
```

Resolved gaps are NOT re-diagnosed and do NOT spawn new gap plans. If the user later reports the same behavior as still broken, treat it as a new issue (a regression) with a fresh `gap_id`.

## § 2 — resume_from_file

**Resume testing from UAT file:**

**First run `reconcile_gaps`** (above) so gaps already fixed by `/gsd:execute-phase --gaps-only` are marked `resolved` before testing resumes (#1921).

Read the full UAT file.

Find first test with `result: [pending]`.
If no `[pending]` test found → go to `complete_session`.

Announce:
```
Resuming: Phase {phase} UAT
Progress: {passed + issues + skipped}/{total}
Issues found so far: {issues count}

Continuing from Test {N}...
```

Update Current Test section with the pending test.
Then continue to `present_test` with it.

## § 3 — diagnose_issues, plan_gap_closure, verify_gap_plans, revision_loop (the gap-closure sub-flow)

This whole sub-flow only runs when UAT testing found issues (`complete_session` routes here); a
session with zero issues never reaches it.

### diagnose_issues

**Diagnose root causes before planning fixes:**

```
---

{N} issues found. Diagnosing root causes...

Spawning parallel debug agents to investigate each issue.
```

- Load diagnose-issues workflow
- Follow @~/.claude/gsd-core/workflows/diagnose-issues.md
- Spawn parallel debug agents for each issue
- Collect root causes
- Update UAT.md with root causes
- Proceed to `plan_gap_closure`

Diagnosis runs automatically - no user prompt. Parallel agents investigate simultaneously, so overhead is minimal and fixes are more accurate.

### plan_gap_closure

**Auto-plan fixes from diagnosed gaps:**

Display:
```
### GSD ► PLANNING FIXES

◆ Spawning planner for gap closure... (runs in a subagent — no output until it returns, ~1–5 min; expected, not a freeze)
```

Spawn gsd-planner in --gaps mode:

<!-- #2517 model-omit-on-inherit -->

> **Model omission (#2517).** Omit the `model` parameter entirely when the value it would carry (`planner_model`, `checker_model`) is `"inherit"` or empty. An empty value 404s on runtimes without native tier aliases — the default on non-Claude runtimes. Omitting it inherits the orchestrator's model. See @gsd-core/references/model-profile-resolution.md.

````
Agent(
  prompt="""
<planning_context>

**Phase:** {phase_number}
**Mode:** gap_closure

<required_reading>
- {phase_dir}/{phase_num}-UAT.md (UAT with diagnoses)
- {state_path} (Project State)
- {roadmap_path} (Roadmap)
</required_reading>

${AGENT_SKILLS_PLANNER}

</planning_context>

<downstream_consumer>
Output consumed by /gsd:execute-phase
Plans must be executable prompts.

<!-- #2508 runtime-aware-dispatch -->

> **Runtime-aware dispatch (#2508 Phase 4).** GSD workflows dispatch specialized subagents by role. Before dispatching on a built-in-only runtime (kimi-code — three built-ins only), resolve the role to a built-in via `gsd_run query resolve-dispatch-type --requested <role> --raw`. On named-dispatch runtimes (Claude/OpenCode/…) the role is returned unchanged; on kimi-code it maps to `coder`/`explore`/`plan` by role-suffix. The persona rides `${AGENT_SKILLS_<ROLE>}` (Phase 3) regardless. See @gsd-core/references/runtime-aware-dispatch.md.

**Gap linkage (#1921):** each created `*-PLAN.md` MUST list the UAT gap ids it addresses in its frontmatter:
```yaml
---
gap_closure: true
gap_ids: [G-{phase}-{N}, ...]   # the ## Gaps gap_id values this plan fixes
---
```
This lets `/gsd:verify-work` reconcile resolved gaps on resume (a gap whose plan has a matching `*-SUMMARY.md` is marked `status: resolved`, not re-diagnosed as a fresh blocker).
</downstream_consumer>
""",
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Plan gap fixes for Phase {phase}"
)
````

> **ORCHESTRATOR RULE — CODEX RUNTIME**: After calling Agent() above, stop working on this task immediately. Do not read more files, edit code, or run tests related to this task while the subagent is active. Wait for the subagent to return its result. This prevents duplicate work, conflicting edits, and wasted context. Only resume when the subagent result is available.

On return:
- **PLANNING COMPLETE:** Proceed to `verify_gap_plans`
- **PLANNING INCONCLUSIVE:** Report and offer manual intervention

### verify_gap_plans

**Verify fix plans with checker:**

Display:
```
### GSD ► VERIFYING FIX PLANS

◆ Spawning plan checker... (runs in a subagent — no output until it returns, ~1–5 min; expected, not a freeze)
```

Initialize: `iteration_count = 1`

Spawn gsd-plan-checker:

```
Agent(
  prompt="""
<verification_context>

**Phase:** {phase_number}
**Phase Goal:** Close diagnosed gaps from UAT

<required_reading>
- {phase_dir}/*-PLAN.md (Plans to verify)
</required_reading>

${AGENT_SKILLS_CHECKER}

</verification_context>

<expected_output>
Return one of:
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
</expected_output>
""",
  subagent_type="gsd-plan-checker",
  model="{checker_model}",
  description="Verify Phase {phase} fix plans"
)
```

> **ORCHESTRATOR RULE — CODEX RUNTIME**: After calling Agent() above, stop working on this task immediately. Do not read more files, edit code, or run tests related to this task while the subagent is active. Wait for the subagent to return its result. This prevents duplicate work, conflicting edits, and wasted context. Only resume when the subagent result is available.

On return:
- **VERIFICATION PASSED:** Proceed to `present_ready`
- **ISSUES FOUND:** Count BLOCKER + WARNING entries in the YAML issues block; an entry whose severity is missing or unrecognized counts as a BLOCKER (fail closed). If zero — every entry is explicitly INFO — display `ℹ advisory — {dimension}: {description}` per entry and proceed to `present_ready`; INFO is advisory and never enters the loop (#3724). Otherwise proceed to `revision_loop`

### revision_loop

**Iterate planner ↔ checker until plans pass (max 3):**

**If iteration_count < 3:**

Display: `Sending back to planner for revision... (iteration {N}/3)`

Spawn gsd-planner with revision context:

```
Agent(
  prompt="""
<revision_context>

**Phase:** {phase_number}
**Mode:** revision

<required_reading>
- {phase_dir}/*-PLAN.md (Existing plans)
</required_reading>

${AGENT_SKILLS_PLANNER}

**Checker issues:**
{structured_issues_from_checker}

</revision_context>

<instructions>
Read existing PLAN.md files. Make targeted updates to address checker issues.

`required_property` + evidence + severity BIND. `fix_hint` is ONE non-binding example route: a
smaller or different mechanism reaching the same property addresses the issue in full — say which
you used. Re-check locked decisions, capability guidance (CLAUDE.md, project skills) and the
constraints these plans already encode BEFORE editing; if a hint would contradict one, or the
property is unreachable without breaking one, return `## REVISION_CONFLICT` with the conflict and
the alternatives rather than applying or working around it. Full contract:
`gsd-core/references/planner-revision.md`, which you load in revision mode.

Do NOT replan from scratch unless issues are fundamental.
</instructions>
""",
  subagent_type="gsd-planner",
  model="{planner_model}",
  description="Revise Phase {phase} plans"
)
```

> **ORCHESTRATOR RULE — CODEX RUNTIME**: After calling Agent() above, stop working on this task immediately. Do not read more files, edit code, or run tests related to this task while the subagent is active. Wait for the subagent to return its result. This prevents duplicate work, conflicting edits, and wasted context. Only resume when the subagent result is available.

**If the planner returns `## REVISION_CONFLICT`:** do NOT increment `iteration_count` and do NOT
re-spawn the checker — a conflict is not resolvable by re-running the same loop, so it must not
consume retry budget. Present the conflict table and its alternatives to the user and ask which
to take: adopt a named alternative / override the named constraint and apply the hint / amend the
constraint itself. Every option resolves the conflict; accepting the plans with the blocker still
open is NOT offered here — that choice belongs to the max-iteration escalation below. Re-spawn
the planner with the chosen resolution and then **re-evaluate its return from the top of this
handler** — never fall through to the checker spawn below, because a second conflict is still a
conflict, not a revised plan, and only a NON-conflict return may reach the checker or increment
`iteration_count`.

**Bounded:** a conflict naming the SAME `required_property` twice in a row (no successful revision in between) is a stall, and so is
the THIRD conflict return of this loop whatever property it names — alternating property names
would otherwise never trip the repeat rule. Stop re-spawning and route it to the same
max-iteration escalation below.

**On any other return** → spawn checker again (verify_gap_plans logic)
Increment iteration_count

**If iteration_count >= 3:**

Display: `Max iterations reached. {N} issues remain.`

Offer options:
1. Force proceed (execute despite issues)
2. Provide guidance (user gives direction, retry)
3. Abandon (exit, user runs /gsd:plan-phase manually)

Then wait for the user to pick one.
