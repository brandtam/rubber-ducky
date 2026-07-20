---
name: help
description: Capability index — invoke on help, what can you do, or what do I say to do something.
---

# Help

The canonical "now what?" answer. Render one scannable message grouped by
intent — natural phrasing first, mechanism second. No proactive tips: help is
invoked, not pushed. If unsure of an exact capability mid-conversation, quote
this reference rather than improvising.

## Daily routines

- **"good morning" / "gm"** → morning brief: today's daily page, urgent items,
  reminders, priorities, a suggested focus.
- **"wrap up" / "eod"** → end-of-day summary: record the day, close touched
  tasks, sweep the ASAP list.
- **"weekly summary" / "weekly update"** → curated weekly summary saved to
  `wiki/weekly/`.

## Capture (one skill, three routes)

- **"don't let me forget …" / "ASAP: …"** → urgent list, surfaces every morning
  until resolved.
- **"remind me on <date> to …"** → date-keyed reminder.
- **"I had an idea: …"** → someday/maybe list.
- **"process my list"** → interactive triage: act / convert to task / defer /
  dismiss, one item at a time.

## Tasks and pages

- **"I'm starting on …"** → task flips to in-progress, becomes today's focus.
- **"done with …"** → task closed with a resolution note, close date stamped.
- **"meeting note: …"** → structured meeting page with decisions and action items.
- **"start a project called …"** → project page; tasks and meetings can attach
  to it.

## Integrations

- **"connect github" / "add an integration"** → wire up an external service:
  pick a transport, write the bridge doc, register write patterns.
- **"ingest issue 42" / "pull in that ticket"** → external ticket lands as a
  typed wiki task page.
- **"comment on the ticket" / "close it upstream"** → preview-then-confirm
  write back to the connected tracker.
- **"file a bug about …" / "new ticket for …"** → draft locally, create
  upstream on approval, link the wiki page.
- **"are we in sync?" / "check drift"** → reconcile wiki vs tracker,
  per-disagreement: accept theirs, accept wiki, or skip.

## Agents (delegated work)

- **"what did I work on last week?" / "when did we first discuss X?"** →
  `work-historian` agent: read-only history answers with citations.
- **"check the vault's health"** → `linter` agent: stale tasks, broken
  wikilinks, frontmatter errors.
- **"draft a ticket for …"** → `ticket-writer` agent: drafts tracker-ready
  text from a task page (never posts anywhere).
- **"research X for me"** → `research-partner` agent: web research with source
  citations.

## Settings

Natural phrasing works — translate intent into `rubber-ducky settings` calls:

| Key | Controls |
| :--- | :--- |
| `ingest.auto_on_wrap_up` | Offer to save today's writing as voice samples at wrap-up |
| `ingest.auto_on_onboard` | Invite a raw-material paste during onboarding |
| `onboard.completed` | Whether the first-run interview has happened |

Operators: `rubber-ducky settings get|set|enable|disable <path>` — every change
is audit-logged to `wiki/log.md`.

## Operator CLI

For debugging or scripting: `rubber-ducky init <dir>`, `adopt`, `doctor`,
`doctor lint`, `status`, `wiki search`, `index rebuild`, `screenshot ingest`.
Run `rubber-ducky --help` for the full surface.
