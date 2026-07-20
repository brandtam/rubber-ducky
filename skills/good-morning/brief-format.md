# Morning brief — card order and formatting

Output a prioritized summary as separate cards, in this order. Omit empty cards.

1. **Urgent (ASAP)** — pending `asap list` items; handle first
2. **Due today** — reminders and tasks with `due` = today
3. **Upcoming (next 3 days)** — approaching deadlines and reminders
4. **Carried over** — unfinished items from yesterday's daily page
5. **Quick wins** — short unblocking tasks (access, admin, provisioning, or
   anything obviously five-minute-sized); surface them so an easy win is visible
6. **In progress** — continue work
7. **Blocked** — check if unblocked; suggest escalation if still stuck
8. **To do** — pick up next if capacity allows
9. **Linter findings** — the linter agent's report as its own card, condensed to
   `<rule>: <count> — <one-liner>` bullets

## Focus suggestion

Focus is never empty. If no obvious candidate emerges, fall back to yesterday's
`active_task`, else the highest-priority in-progress task.

## Tone

Short bullet points: titles, statuses, due dates only. Never reproduce full task
contents — the goal is a quick scan, not a wall of text.
