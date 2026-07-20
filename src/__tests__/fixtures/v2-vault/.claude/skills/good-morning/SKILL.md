---
name: good-morning
description: "Morning brief skill — prioritized daily summary"
---

# Good Morning

Start the day with a prioritized brief.

## When to invoke

Run this skill whenever the user greets with "good morning", "morning", "gm", or any variant that signals the start of their day. Invoke it immediately — do not ask "would you like me to run /good-morning?" first. The greeting *is* the request.

## Behavior

### Step 0 — Session continuity check

Read today's daily page frontmatter (if it exists). If `morning_brief` is already set to today's date, the user already ran the morning routine today. Resume rather than re-running:

> You already ran your morning brief today. Want a quick re-orientation, or pick up where you left off?

If `morning_brief` is unset/false, continue with the full routine.

### Step 1 — Ensure today's daily page exists

Run via Bash:

```
rubber-ducky page create daily
```

If the page already exists, this is a no-op (the CLI will report it exists). Continue either way.

### Step 1a — Kick off the linter in parallel

Run the **linter** agent in the background while you gather context in Step 2. Its findings (stale tasks, drift, broken links, ASAP hygiene if enabled) become a separate card in the brief, not buried inline:

```
Agent({
  subagent_type: "linter",
  prompt: "Run morning linter checks for the wrap-up brief"
})
```

This is opportunistic — run it if the linter agent is configured; skip silently otherwise.

### Step 1b — Reconcile drift before any new work starts

Invoke `/reconcile` before gathering context. The morning brief is only useful if the wiki it's built from agrees with the backends — otherwise you'll prioritize a ticket that someone else already moved overnight.

`/reconcile` runs the twice-daily ritual end-to-end: fans out `pull --dry-run` per linked backend, assembles a 3-way view across `{wiki, asana, jira}` per active task, surfaces drift in plain English, and walks the User through resolution one ticket at a time (see `src/skills/reconcile/SKILL.md`). When zero tickets drifted, it reports a one-line "no drift across N tasks" and returns immediately — the brief continues uninterrupted.

When tickets *did* drift, the brief pauses here. Resolve them before moving on; the Step 2 context gather depends on accurate frontmatter.

If no backends are configured, the user is offline, or `/reconcile` errors on connectivity, skip this step and note it in the brief ("Skipped morning reconcile — no backends configured.") rather than failing the routine.

### Step 2 — Gather context

Read the following files to build situational awareness:

1. **Yesterday's daily page** — check `wiki/daily/` for the most recent page before today. Note any items in the "Carried over" section.
2. **Active tasks** — scan `wiki/tasks/` for tasks with status `in-progress`, `to-do`, or `blocked`. Read their frontmatter (especially `status`, `priority`, `due`).
3. **ASAP items** — check `wiki/tasks/` for any task with `priority: asap` or tagged `asap`. These must be surfaced first.
4. **Date-keyed reminders** — check `wiki/tasks/` for tasks with a `due` date matching today. These are deadline items that need attention.
5. **Upcoming deadlines** — check for tasks with `due` dates within the next 3 days to flag what's approaching.

### Step 3 — Present the morning brief

Output a prioritized summary as separate cards, in this order:

1. **ASAP items** — handle first, these are urgent
2. **Deadline items due today** — time-sensitive
3. **Upcoming deadlines (next 3 days)** — awareness items
4. **Carried-over items** — unfinished from yesterday
5. **Quick wins** — tasks tagged `access`, `admin`, `provisioning` or otherwise short-unblocking; surface them so a 5-minute win is visible
6. **In-progress tasks** — continue work
7. **Blocked tasks** — check if unblocked, escalate if still stuck
8. **To-do tasks** — pick up next if capacity allows
9. **Linter findings** — present the linter agent's output (from Step 1a) as a distinct card so issues are visible without overwhelming the brief

Suggest a focus task. **Focus is never empty**: if no obvious candidate emerges, fall back to yesterday's `active_task` or the highest-priority item in `current-status.md` (if that file exists in the workspace).

### Step 4 — Set the morning-brief flag

Run via Bash:

```
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md morning_brief true
```

(Replace YYYY-MM-DD with today's date.)

### Step 5 — Set active task

If a focus task was suggested and the user agrees, run via Bash:

```
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task "<task-slug>"
```

## Redirect behavior

After handling any interruption during the day, remind the user of their active task by reading the `active_task` field from today's daily page frontmatter. If `active_task` is set, say: "Ready to get back to [active task]?" This keeps the user focused after context switches.

## Output

A concise, prioritized morning brief. Use short bullet points. Do not reproduce full task contents — just titles, statuses, and due dates. The goal is a quick scan, not a wall of text.
