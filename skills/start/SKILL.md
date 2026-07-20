---
name: start
description: Begin a task — invoke when the user says I'm starting on, let's work on, or picking up a task.
---

# Start

Flip a task to in-progress and make it the day's focus.

## Steps

1. **Resolve the task page.** Accept a wiki path, a slug, or a title fragment —
   for fragments, find it with `rubber-ducky wiki search "<fragment>" --type task`.
   No match? Offer to create it: `rubber-ducky page create task "<title>"`.
2. **Start it** — `rubber-ducky task start wiki/tasks/<slug>.md`. This sets
   status to `in-progress`, updates today's daily page, and logs the activity.
3. **Set focus** —
   `rubber-ducky frontmatter set wiki/daily/<today>.md active_task "<slug>"`
   (create the daily page first with `rubber-ducky page create daily` if needed).
4. **Confirm in one line** — `Started: <task title> (in-progress).` Then get out
   of the way; the user wants to work, not read.
