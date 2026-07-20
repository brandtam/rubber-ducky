---
name: close
description: Close a task — invoke when the user says done with, finished, or shipped a task.
---

# Close

Mark a task done, record how it ended, and redirect to what's next.

## Steps

1. **Resolve the task page** from a wiki path, slug, or title fragment
   (`rubber-ducky wiki search "<fragment>" --type task`). Read its frontmatter;
   if `status` is already `done`, say so and stop.
2. **Draft a resolution note** — 1–3 sentences from the task's activity log and
   body: what was done and the outcome, not implementation noise. Show it and
   ask: use, edit, or write your own? A note is always recorded (minimum one
   line); skipping is not an option.
3. **Record the note** — append it, dated, to the task page's `## Activity log`
   with the Edit tool.
4. **Close it** — `rubber-ducky task close wiki/tasks/<slug>.md`. This sets
   status to `done`, stamps the close date, and updates the daily page and log
   atomically. To backdate, the user edits frontmatter directly.
5. **Clear focus** — if this task is today's `active_task`, set it to `null`:
   `rubber-ducky frontmatter set wiki/daily/<today>.md active_task null`
6. **Redirect** — suggest the obvious next task: another in-progress task on
   today's daily page, or a pending item from `rubber-ducky asap list`.
   "Ready to get back to <task>?" — otherwise ask what's next.
