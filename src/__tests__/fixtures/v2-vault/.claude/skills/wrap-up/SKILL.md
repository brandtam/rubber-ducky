---
name: wrap-up
description: "End-of-day wrap-up skill — daily summary and status update"
---

# Wrap Up

End-of-day summary and workspace update.

## When to invoke

Run this skill whenever the user signals the end of their day — "wrap up", "wrapping up", "end of day", "eod", "done for today", or similar. Invoke it immediately — do not ask "would you like me to run /wrap-up?" first.

## Behavior

### Step 0 — Session continuity check

Read today's daily page frontmatter. If `wrap_up` is already set to a timestamp from today, the user has already wrapped up. Confirm: "You wrapped up at <time> — want to amend that or start fresh?"

If `active_task` is set on today's page, ask before continuing: "You still have <active task> marked as active — ready to wrap up?" This prevents accidental wrap-up mid-flow.

### Step 1 — Read today's daily page

Read today's daily page from `wiki/daily/YYYY-MM-DD.md`. If no daily page exists, create one first:

```
rubber-ducky page create daily
```

### Step 1a — Run linter in parallel (delegated)

Kick off the **linter** agent in the background while gathering context. Its findings (drift, stale tasks, broken links) will be presented as a separate card later, not buried inline:

```
Agent({
  subagent_type: "linter",
  prompt: "Run wrap-up linter checks on this workspace"
})
```

### Step 2 — Identify tasks touched today

Scan `wiki/tasks/` and read activity logs and frontmatter. A task was "touched" if:
- Its `updated` timestamp is from today
- It has an activity log entry dated today
- The user mentioned working on it during the session

### Step 3 — Update task pages

For each touched task, run via Bash:

```
rubber-ducky frontmatter set wiki/tasks/<slug>.md status <new-status>
rubber-ducky frontmatter set wiki/tasks/<slug>.md updated <now-iso>
```

If a task was completed, also set:

```
rubber-ducky frontmatter set wiki/tasks/<slug>.md closed <now-iso>
```

### Step 3a — Reconcile drift after the day's local writes

After the User's own changes are recorded (Step 3), invoke `/reconcile` to sweep for anything that drifted during the day — external transitions, comments, assignee changes the User didn't make. This is the second half of the twice-daily ritual (the first half runs in `/good-morning`).

`/reconcile` fans out `pull --dry-run` per linked backend, assembles a 3-way view across `{wiki, asana, jira}` per active task, and walks the User through resolution one ticket at a time (see `src/skills/reconcile/SKILL.md`). When nothing drifted, it reports a one-line summary and wrap-up continues. When drift surfaces, resolve it now — the daily log entry in Step 4 and the status snapshot in Step 5 should reflect the reconciled state, not the pre-reconcile guess.

Skip cleanly when no backends are configured, the user is wrapping up offline, or `/reconcile` errors on connectivity. Note the skip in the wrap-up output ("Skipped wrap-up reconcile — no backends configured.") rather than failing the routine.

### Step 4 — Update daily log

Append a wrap-up entry to the workspace log:

```
rubber-ducky log append "EOD wrap-up: <N> tasks touched, <M> completed"
```

### Step 5 — Create status snapshot in daily page

Update today's daily page body sections by editing the file directly:

- **Completed today** — list tasks that moved to `done`
- **Carried over** — list in-progress or to-do tasks that weren't completed
- **Blockers** — note any blocked tasks and why
- **Work log** — add a brief narrative of the day's work

Also update the `tasks_touched` frontmatter array:

```
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md tasks_touched '["task-slug-1","task-slug-2"]'
```

### Step 6 — Set the wrap-up flag

```
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md wrap_up true
```

### Step 7 — Clear active task

```
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task null
```

### Step 7a — ASAP sweep (when asap.md exists)

If `wiki/asap.md` exists, scan it for items the user might want to close out. For each pending item, ask:
- "Is this resolved?" → `rubber-ducky asap resolve <index>`
- "Should this become a task?" → `rubber-ducky page create task "<title>"`
- Skip / leave for later

Garbage-collect resolved items in batch at the end (so the file doesn't accumulate cruft).

### Step 7b — Linter findings card

The linter agent from Step 1a has finished. Present its findings as a distinct card in the wrap-up output:

```
─── Linter findings ───
<count> issue(s):
- <rule>: <count> — <one-line description>
...
```

Don't fix the issues automatically. Surface them so the user knows; offer "Want to address any of these now?"

### Step 7c — Voice-sample ingest (opt-in, gated by settings)

The vault treats context capture as ongoing. If the user produced drafts,
comments, or messages today (visible in the daily file's `## Work log` /
`## Notes & context` sections, or in any task page activity log dated
today), they're potentially useful voice samples for `wiki/voice.md`.

Check whether the user has opted in:

```bash
rubber-ducky settings get ingest.auto_on_wrap_up
```

- If the call returns `false` (the default), **skip this step entirely**.
  Do not offer; do not mention it. The user has explicitly chosen not to
  spend tokens on this at wrap-up.
- If it returns `true`, scan today's user-authored material and offer:
  *"I saw N pieces you wrote today. Want me to ingest them as voice
  samples? (`/ingest-writing` handles the routing.)"* On `yes`, route the
  raw text through `/ingest-writing`.

This is the only ongoing-capture hook the wrap-up skill runs. Other
hooks (e.g. at `/onboard`) are owned by those skills.

### Step 8 — Vocabulary check (optional, non-blocking)

After the daily summary is complete, check if any undefined terms came up during the day:

1. Read `UBIQUITOUS_LANGUAGE.md` to get the current set of defined terms.
2. Scan today's daily page body and the task pages touched today for domain-specific terms not in the vocabulary.
3. If new terms are found, suggest additions: "I noticed these terms aren't in your controlled vocabulary yet: [terms]. Want to add definitions?"
4. If the user accepts, append the terms to the appropriate table (brands, teams, or labels) in `UBIQUITOUS_LANGUAGE.md`.
5. If the user declines or skips, proceed without changes — this step does not block wrap-up completion.

## Redirect behavior

If the user triggers this skill but has an `active_task` set in today's daily page, confirm they want to wrap up: "You still have [active task] marked as active — ready to wrap up for the day?" This prevents accidental wrap-up mid-flow.

## Output

A concise end-of-day summary:
- Tasks completed today (count + titles)
- Tasks carried over (count + titles)
- Blockers (if any)
- Suggested focus for tomorrow

Keep it brief — the daily page has the full record.
