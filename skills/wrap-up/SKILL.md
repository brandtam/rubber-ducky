---
name: wrap-up
description: End-of-day wrap-up — invoke on wrap up, eod, or done for today; weekly mode on weekly summary or weekly update.
---

# Wrap Up

Invoke immediately on the trigger phrase — don't ask first.

## Mode selection

- "wrap up", "end of day", "eod", "done for today" → **daily mode** (below).
- "weekly summary", "weekly update", "write my weekly" → **weekly mode**: read
  [weekly.md](weekly.md) and follow it instead.

## Daily mode

1. **Continuity check** — `rubber-ducky status check wrap-up`. If already set,
   ask: amend or start fresh? If `active_task` is still set on today's daily
   page, confirm before continuing: "You still have <task> active — ready to
   wrap up?"
2. **Ensure today's daily page** — `rubber-ducky page create daily` if missing.
3. **Linter in background** — launch the plugin's `linter` agent via the Agent
   tool while you gather context; present its findings in step 8.
4. **Identify tasks touched today** — a task counts if its `updated` frontmatter
   is today, its activity log has a today-dated entry, or the user worked on it
   this session.
5. **Record the day**:
   - Completed tasks: `rubber-ducky task close wiki/tasks/<slug>.md` (sets
     status, close date, daily page, and log atomically).
   - Other touched tasks: `rubber-ducky frontmatter set wiki/tasks/<slug>.md status <status>`
   - `rubber-ducky log append "EOD wrap-up: <N> tasks touched, <M> completed"`
   - Edit today's daily page body: **Completed today**, **Carried over**,
     **Blockers**, and a brief **Work log** narrative.
   - `rubber-ducky frontmatter array set wiki/daily/<today>.md tasks_touched <slug>...`
6. **Close out the day**:
   - `rubber-ducky frontmatter set wiki/daily/<today>.md wrap_up true`
   - `rubber-ducky frontmatter set wiki/daily/<today>.md active_task null`
7. **ASAP sweep** — `rubber-ducky asap list`; for each pending item ask:
   resolved (`rubber-ducky asap resolve <index>`), convert
   (`rubber-ducky page create task "<title>"` then resolve), or leave.
8. **Linter findings card** — surface the linter agent's report as a distinct
   card. Don't auto-fix; offer "Want to address any of these now?"
9. **Voice samples (opt-in)** — if `rubber-ducky settings get ingest.auto_on_wrap_up`
   returns `true`, offer to append notable things the user wrote today to
   `wiki/voice.md` as voice samples. If `false` (default), skip silently.

## Output

A concise summary: completed (count + titles), carried over, blockers,
suggested focus for tomorrow. The daily page holds the full record.
