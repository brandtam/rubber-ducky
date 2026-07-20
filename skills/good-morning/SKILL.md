---
name: good-morning
description: Morning brief — invoke when the user greets with good morning, morning, or gm.
---

# Good Morning

The greeting is the request — run immediately, don't ask first.

## Steps

1. **Continuity check** — run `rubber-ducky status check morning-brief`. If already
   set for today, offer a quick re-orientation instead of re-running, and stop.
2. **Ensure today's daily page** — `rubber-ducky page create daily` (no-op if it exists).
3. **Linter in background** — launch the plugin's `linter` agent via the Agent tool
   while you gather context. Its findings become their own card in the brief.
   Opportunistic: skip silently if the agent is unavailable.
4. **Gather context** (parallel where possible):
   - `rubber-ducky asap list` — pending urgent items
   - `rubber-ducky remind list` — reminders due today *or earlier* (surface overdue
     ones as OVERDUE — a reminder from a day the user skipped must not be lost),
     plus any within the next 3 days
   - `rubber-ducky idea list` — count only; mention if the list is growing
   - `rubber-ducky index rebuild`, then read `wiki/index.md` for task statuses;
     read task frontmatter (`status`, `priority`, `due`) where detail is needed
   - Yesterday's daily page in `wiki/daily/` — note "Carried over" items
5. **Present the brief** — card order and formatting rules in
   [brief-format.md](brief-format.md). Always suggest a focus task.
6. **Flag it** — `rubber-ducky frontmatter set wiki/daily/<today>.md morning_brief true`
7. **Set focus** — if the user agrees on a focus task:
   `rubber-ducky frontmatter set wiki/daily/<today>.md active_task "<task-slug>"`

## Redirect behavior

After any interruption later in the day, read `active_task` from today's daily
page and offer: "Ready to get back to [active task]?"
