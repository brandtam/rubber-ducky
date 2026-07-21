---
name: capture
description: Capture to-dos and thoughts — invoke on don't let me forget, remind me on a date, I had an idea, or process my list.
---

# Capture

One skill for everything the user wants remembered. Route by phrasing, capture
in one line, get out of the way. Voice input is the default — friction is
expensive.

## Routing table

| Phrasing signal | Route | CLI |
| :--- | :--- | :--- |
| Urgent, no date — "ASAP", "don't let me forget", "next time I work on X", "I need to file a ticket for that" | **Urgent** | `rubber-ducky asap add "<message>"` |
| A parseable date or day — "remind me Friday", "on May 4th", "in two weeks", "2026-08-01 …" | **Dated** | `rubber-ducky remind add <YYYY-MM-DD> "<message>"` |
| Someday/maybe, no obligation — "I had an idea", "someday we should", "wouldn't it be cool if" | **Someday** | `rubber-ducky idea add "<message>"` |
| "process my ASAP list", "triage my list", "go through my ideas/reminders" | **Triage** | read [triage.md](triage.md) and follow it |

Edge rules:
- A date wins: if a specific date or day name is parseable, it's **Dated** even
  if the phrasing sounds urgent.
- "Remind me next work day" is intentionally open-ended → **Urgent**, not Dated.
- Obligation wins over novelty: "idea: we MUST fix X before launch" → **Urgent**.
- Dated items store absolute dates only — resolve "Friday" / "in two weeks" to
  `YYYY-MM-DD` from today. Genuinely ambiguous ("next month")? Ask once. Past
  dates are allowed, but warn once first.

## Capture flow (Urgent / Dated / Someday)

1. **Title + context** — title is the core action, TODO-style, not a sentence.
   Context is what else was said or clearly implied by the conversation; format
   the message as `<Title> — <context>`. If a related task page is resolvable,
   append ` (related: [[<task page>]])`. Empty input and no context? Ask once
   for a one-liner — never interview.
2. **Dedup** — `rubber-ducky asap list` / `remind list <date>` / `idea list`
   (`--json`). If a near-duplicate exists, say so and let the user choose;
   never write a duplicate silently.
3. **Add** via the routing-table CLI. The CLI stamps the date itself — don't
   append one to the message.
4. **Confirm in one line** — e.g. `Added to ASAP: <Title>.` or
   `Reminder set for <date>: <message>.` If context was inferred rather than
   stated, append `(noted: <inferred context in ≤ 8 words>)`.
5. **Redirect** — read `active_task` from today's daily page
   (`rubber-ducky frontmatter get wiki/daily/<today>.md active_task`); if set,
   end with `Back to [[<active task>]].` Otherwise just confirm.

## Rules

- Capture is wiki-only: no daily-page writes, no `log append` — captures are
  too small to clutter the log.
- Capture ≠ triage. Never start the triage flow after a capture unless asked.
- For a Dated item referencing an existing task, offer (never silently) to set
  that task's `due:` via `rubber-ducky frontmatter set`.
