---
name: task-note
description: Update a task mid-flight — invoke on note on the task, bump the priority, mark it blocked, or log where I got to.
---

# Task Note

Mid-life task updates that aren't a start or a close: append a progress note
to the activity log, change priority or status, record a blocker. One
composite CLI call does the mechanical parts; you author only the note text.

## Resolve the task

Named explicitly → use it. Not named → today's daily page `active_task`
frontmatter; still ambiguous → `rubber-ducky wiki search "<words>" --type
task` and ask which. No match → offer to create the task (/start-project or
`page create task`) and stop.

## Apply the update

One call, only the flags the update needs:

```
rubber-ducky task stamp-write wiki/tasks/<slug>.md \
  --activity "<the note, one line, in the user's words>" \
  [--set priority=<value>] \
  [--status <status>] \
  [--log "[task-note] <slug>: <summary>"]
```

- **Progress note** ("note on the task: waiting for review") →
  `--activity` only. Deterministic format: the CLI prepends `- ` and
  stamps `updated`; write the line itself as plain past-tense prose, no
  timestamps (the daily page owns time).
- **Priority** ("bump it to high") → `--set priority=high` plus an
  `--activity "Priority -> high"` line so the change is visible in history.
- **Status** ("it's in review now") → `--status in-review` (vault
  vocabulary: `backlog`, `to-do`, `in-progress`, `in-review`, `pending`,
  `blocked`, `done`, `deferred`). Saying it's *done* is /close's job —
  hand off there so the resolution note gets captured; don't pass
  `--status done` from this skill.
- **Blocker** ("blocked on the API team") → `--status blocked` plus
  `--activity "Blocked: <reason>"`. When the blocker names a person or
  date, offer a `remind` capture too.
- Add `--log` when the update is worth the vault-level trail (status and
  blocker changes: yes; a plain progress note: no).

Multiple updates in one breath ("mark it blocked and bump priority") →
still one `stamp-write` call with all the flags.

## Confirm

One line back, e.g. `Noted on [[<slug>]] — blocked, priority high.` No
recap of the whole task.

## Failure modes

- Exit 3 (not found) → the file moved or the slug is wrong; re-resolve via
  `wiki search`, don't guess a new path.
- Exit 2 (invalid input) → a flag value was malformed (bad `--set` pair,
  path escaping the vault); fix the call, never hand-edit frontmatter to
  work around it.
- The task isn't a task page (`type` mismatch) → say so and stop; this
  skill never edits non-task pages.
- If the update also needs to reach a connected tracker, that's an external
  write — hand off to /backend-write; nothing here touches a service.
