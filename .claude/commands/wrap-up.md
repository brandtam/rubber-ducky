# Wrap Up

End-of-day summary and workspace update.

## Behavior

### Step 1 — Read today's daily page

Read today's daily page from `wiki/daily/YYYY-MM-DD.md`. If no daily page exists, create one first:

```
rubber-ducky page create daily
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

## Redirect behavior

If the user triggers this skill but has an `active_task` set in today's daily page, confirm they want to wrap up: "You still have [active task] marked as active — ready to wrap up for the day?" This prevents accidental wrap-up mid-flow.

## Output

A concise end-of-day summary:
- Tasks completed today (count + titles)
- Tasks carried over (count + titles)
- Blockers (if any)
- Suggested focus for tomorrow

Keep it brief — the daily page has the full record.
