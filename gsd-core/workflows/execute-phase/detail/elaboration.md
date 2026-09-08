# execute-phase.md — deferred elaboration

Read in full when `workflow.compact_content` is `false` (the default) — see
`gsd-core/references/compact-content-gate.md` for the check and resolution rule this
spine defers to. Each `§` below is the full text the spine condenses at the point it
names.

## § 1 — safe_resume_gate

Before trusting `STATE.md` or dispatching any executor, derive `CURRENT_PLAN_ID`
from the active incomplete plan in `INIT`, then search recent history:
```bash
SUMMARY_PATH="{phase_dir}/{plan_padded}-SUMMARY.md"
# #4003: no padding rule in the commit protocol, so zero-strip both components and
# match ANCHORED at the commit scope; bound to the latest reachable tag (milestone marker).
PHASE_N=$((10#{phase_number}))
PLAN_N=$((10#{plan_padded}))
PLAN_SCOPE_RE="^[a-z]+\((0*${PHASE_N})-(0*${PLAN_N})\):"
MILESTONE_BASE=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
PLAN_COMMITS=$(git log --oneline -E ${MILESTONE_BASE:+"$MILESTONE_BASE..HEAD"} --grep="${PLAN_SCOPE_RE}" -30)
```
If production commits exist and `SUMMARY.md is missing` (no `.planning/async-jobs/*.json` manifest matches it: a match is a legal `external_job_waiting` deferral - reconcile per `docs/reference/planning-artifacts.md`, never re-dispatch), stop before spawning a
new executor; continuing risks duplicate work and stale `STATE.md`/ROADMAP progress.
Offer these recovery options:
- `close out manually` — inspect commits, write SUMMARY.md, then update STATE/ROADMAP.
- `re-execute from scratch` — revert or supersede partial commits before dispatch.
- `mark-and-skip` — record the anomaly and move on only with explicit confirmation.

## § 2 — check_interactive_mode

**Parse `--interactive` flag from $ARGUMENTS.**

**If `--interactive` flag present:** Switch to interactive execution mode.

Interactive mode executes plans sequentially **inline** (no subagent spawning) with user
checkpoints between tasks. The user can review, modify, or redirect work at any point.

**Interactive execution flow:**

1. Load plan inventory as normal (discover_and_group_plans)
2. For each plan (sequentially, ignoring wave grouping):

   a. **Present the plan to the user:**
      ```
      ## Plan {plan_id}: {plan_name}

      Objective: {from plan file}
      Tasks: {task_count}

      Options:
      - Execute (proceed with all tasks)
      - Review first (show task breakdown before starting)
      - Skip (move to next plan)
      - Stop (end execution, save progress)
      ```

   b. **If "Review first":** Read and display the full plan file. Ask again: Execute, Modify, Skip.

   c. **If "Execute":** Read and follow `~/.claude/gsd-core/workflows/execute-plan.md` **inline**
      (do NOT spawn a subagent). Execute tasks one at a time.

   d. **After each task:** Pause briefly. If the user intervenes (types anything), stop and address
      their feedback before continuing. Otherwise proceed to next task.

   e. **After plan complete:** Show results, commit, create SUMMARY.md, then present next plan.

3. After all plans: proceed to verification (same as normal mode). (The spine's own condensed
   text already states the handle_branching hand-off; not repeated here.)

## § 3 — cross_ai_delegation

**Optional step 2.5 — Delegate plans to an external AI runtime.**

This step runs after plan discovery and before normal wave execution. It identifies plans
that should be delegated to an external AI command and executes them via stdin-based prompt
delivery. Plans handled here are removed from the execute_waves plan list so the normal
executor skips them.

**Activation logic:**

1. If `CROSS_AI_DISABLED` is true (`--no-cross-ai` flag): skip this step entirely.
2. If `CROSS_AI_FORCE` is true (`--cross-ai` flag): mark ALL incomplete plans for cross-AI execution.
3. Otherwise: check each plan's frontmatter for `cross_ai: true` AND verify config
   `workflow.cross_ai_execution` is `true`. Plans matching both conditions are marked for cross-AI.

```bash
CROSS_AI_ENABLED=$(gsd_run query config-get workflow.cross_ai_execution --raw 2>/dev/null || echo "false")
CROSS_AI_CMD=$(gsd_run query config-get workflow.cross_ai_command --raw 2>/dev/null || echo "")
CROSS_AI_TIMEOUT=$(gsd_run query config-get workflow.cross_ai_timeout --raw 2>/dev/null || echo "300")
```

**If no plans are marked for cross-AI:** Skip to execute_waves.

**If plans are marked but `cross_ai_command` is empty:** Error — tell user to set
`workflow.cross_ai_command` via `gsd_run query config-set workflow.cross_ai_command "<command>"`.

**For each cross-AI plan (sequentially):**

1. **Construct the task prompt** from the plan file:
   - Extract `<objective>` and `<tasks>` sections from the PLAN.md
   - Append PROJECT.md context (project name, description, tech stack)
   - Format as a self-contained execution prompt

2. **Check for dirty working tree before execution:**
   ```bash
   if ! git diff --quiet HEAD 2>/dev/null; then
     echo "WARNING: dirty working tree detected — the external AI command may produce uncommitted changes that conflict with existing modifications"
   fi
   ```

3. **Run the external command** from the project root, writing the prompt to stdin.
   Never shell-interpolate the prompt — always pipe via stdin to prevent injection:
   ```bash
   echo "$TASK_PROMPT" | gsd_run run-with-timeout "${CROSS_AI_TIMEOUT}" -- ${CROSS_AI_CMD} > "$CANDIDATE_SUMMARY" 2>"$ERROR_LOG"
   EXIT_CODE=$?
   ```

4. **Evaluate the result:**

   **Success (exit 0 + valid summary):**
   - Read `$CANDIDATE_SUMMARY` and validate it contains meaningful content
     (not empty, has at least a heading and description — a valid SUMMARY.md structure)
   - Write it as the plan's SUMMARY.md file
   - Update STATE.md plan status to complete
   - Update ROADMAP.md progress
   - Mark plan as handled — skip it in execute_waves

   **Failure (non-zero exit or invalid summary):**
   - Display the error output and exit code
   - Warn: "The external command may have left uncommitted changes or partial edits
     in the working tree. Review `git status` and `git diff` before proceeding."
   - Offer three choices:
     - **retry** — run the same plan through cross-AI again
     - **skip** — fall back to normal executor for this plan (re-add to execute_waves list)
     - **abort** — stop execution entirely, preserve state for resume

5. **After all cross-AI plans processed:** Remove successfully handled plans from the
   incomplete plan list so execute_waves skips them. Any skipped-to-fallback plans remain
   in the list for normal executor processing.

## § 4 — checkpoint_handling

Plans with `autonomous: false` require user interaction.
**Auto-mode checkpoint handling:**
Read auto-advance config (chain flag OR user preference — same boolean as `check.auto-mode`):
```bash
AUTO_MODE=$(gsd_run query check auto-mode --pick active 2>/dev/null)
```

When executor returns a checkpoint AND `AUTO_MODE` is `true`:
- **human-verify** → Auto-spawn continuation agent with `{user_response}` = `"approved"`. Log `⚡ Auto-approved checkpoint`. **Except `blocking-human`.**
- **decision** → Auto-spawn continuation agent with `{user_response}` = first option from checkpoint details. Log `⚡ Auto-selected: [option]`. **Except `blocking-human`.**
- **human-action** → Present to user (existing behavior below). Auth gates cannot be automated.

**Carve-out — overrides all branches above.** If the returned `Gate:` is `blocking-human` (precondition-unmet, #3210), or its `<what-built>` mentions `Package verification required before install` or `Package install failed — human verification required`, never auto-approve or auto-select. Present to user (standard flow). Log `⛔ blocking-human gate — auto-mode suspended`.

**Standard flow (not auto-mode, human-action, or blocking-human):**

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate → returns structured state
3. Agent return includes: completed tasks table, current task + blocker, checkpoint type/details, what's awaited
4. **Present to user:**
   ```
   ## Checkpoint: [Type]

   **Plan:** 03-03 Dashboard Layout
   **Progress:** 2/3 tasks complete

   [Checkpoint Details from agent return]
   [Awaiting section from agent return]
   ```
5. User responds: "approved"/"done" | issue description | decision selection
6. **Spawn continuation agent (NOT resume)** using continuation-prompt.md template:
   - `{completed_tasks_table}`: From checkpoint return
   - `{resume_task_number}` + `{resume_task_name}`: Current task
   - `{user_response}`: What user provided
   - `{resume_instructions}`: Based on checkpoint type
7. Continuation agent verifies previous commits, continues from resume point
8. Repeat until plan completes or user stops

**Why fresh agent, not resume:** Resume relies on internal serialization that breaks with parallel tool calls. Fresh agents with explicit state are more reliable.

**Checkpoints in parallel waves:** Agent pauses and returns while other parallel agents may complete. Present checkpoint, spawn continuation, wait for all before next wave.

## § 5 — auto_copy_learnings

**Auto-extract and copy phase learnings to global store (when enabled).**

This step runs AFTER phase completion and SUMMARY.md is written. It produces the phase's
learnings artifact (the sole producer is otherwise the user-invoked
`/gsd:extract-learnings`) and copies it to the global learnings store at
`~/.gsd/knowledge/`.

**Check config gate:**
```bash
GL_ENABLED=$(gsd_run query config-get features.global_learnings --raw 2>/dev/null || echo "false")
```

**If `GL_ENABLED` is not `true`:** Skip this step entirely (feature disabled by default).

**If enabled:**

1. Run the `extract-learnings` workflow for the JUST-COMPLETED phase (its
   `write_learnings` step writes `{phase_dir}/{PADDED_PHASE}-LEARNINGS.md`). Extraction
   failure must NOT block phase completion — report the failure and continue.
2. Copy the phase artifact to the global store:
```bash
gsd_run query learnings.copy 2>/dev/null || echo "⚠ Learnings copy failed — continuing"
```
Copy failure must NOT block phase completion.
