# Good Morning

Start the day with a prioritized brief.

## Behavior

### Step 1 — Ensure today's daily page exists

Run via Bash:

```
rubber-ducky page create daily
```

If the page already exists, this is a no-op (the CLI will report it exists). Continue either way.

### Step 2 — Gather context

Read the following files to build situational awareness:

1. **Yesterday's daily page** — check `wiki/daily/` for the most recent page before today. Note any items in the "Carried over" section.
2. **Active tasks** — scan `wiki/tasks/` for tasks with status `in-progress`, `to-do`, or `blocked`. Read their frontmatter (especially `status`, `priority`, `due`).
3. **ASAP items** — check `wiki/tasks/` for any task with `priority: asap` or tagged `asap`. These must be surfaced first.
4. **Date-keyed reminders** — check `wiki/tasks/` for tasks with a `due` date matching today. These are deadline items that need attention.
5. **Upcoming deadlines** — check for tasks with `due` dates within the next 3 days to flag what's approaching.

### Step 3 — Present the morning brief

Output a prioritized summary in this order:

1. **ASAP items** — handle first, these are urgent
2. **Deadline items due today** — time-sensitive
3. **Upcoming deadlines (next 3 days)** — awareness items
4. **Carried-over items** — unfinished from yesterday
5. **In-progress tasks** — continue work
6. **Blocked tasks** — check if unblocked, escalate if still stuck
7. **To-do tasks** — pick up next if capacity allows

Suggest a focus task for the day based on priority and deadlines.

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
