[← Docs index](./README.md)

# Skills reference

Skills are Claude Code commands you invoke with `/name`. They live in `.claude/commands/` inside each workspace as plain markdown files — you can read them, edit them, or write new ones. Bundled skills are installed during `init` and refreshed by `rubber-ducky update`.

Agents are specialized sub-agents that skills can invoke for focused work. They live in `.claude/agents/`.

> **Skills are shorthand, not required.** You don't need to type `/good-morning` — saying *"start my morning brief"* works just as well, and Claude Code will route to the right skill. This reference exists so you can see what's available, understand what Claude Code is doing under the hood, and edit skill behavior when you want to.

Skills are grouped below by when you'd reach for them.

---

## Daily workflow

### `/good-morning`

Creates today's daily page (no-op if it already exists), scans for urgent items, deadlines, carried-over work, and in-progress tasks, and surfaces a prioritized brief. Suggests a focus task for the day and records it to the daily page's `active_task` field so later interruptions can redirect you back.

Use at the start of every day.

### `/wrap-up`

End-of-day summary. Updates task statuses, stamps today's daily page with completed / carried-over / blocked items, runs the vocabulary check, and suggests a focus task for tomorrow. Clears `active_task` so the next morning starts fresh.

### `/asap-process`

Interactive triage of the ASAP list. For each item, you act on it, convert it to a task, defer it, or dismiss it.

### `/grill-me`

Stress-test a plan. Relentlessly challenges your assumptions, surfaces risks, identifies blind spots until you reach a shared understanding. Useful before committing to a design or before kicking off a big piece of work.

### `/ubiquitous-language`

Scan the current conversation for domain terms and propose additions to your controlled vocabulary in `UBIQUITOUS_LANGUAGE.md`. Prevents drift between how you talk about things and how they're recorded.

---

## Task and backend operations

### `/start <task-file>`

Begin a task. Transitions status to in-progress, sets it as the active task on today's daily page, and — if the task is linked to an external backend — syncs the transition there.

### `/close <task-file>`

Finish a task. Transitions to done, stamps the closed timestamp, clears active-task status, and syncs with the backend.

### `/push <task-file>`

Create an external ticket from a wiki task page. Uses the `ticket-writer` agent to draft backend-appropriate content, previews the payload, and pushes on confirmation.

### `/comment <task-file> <message>`

Add a comment to the external ticket linked to a wiki task. Preview before posting.

### `/transition <task-file>`

Sync a task's status between wiki and backend. For Jira, fetches valid transitions from the workflow and asks you to pick. For Asana and GitHub, maps wiki status to the backend's open/closed concept.

### `/pull-active`

Refresh all active tasks (in-progress, in-review, pending, blocked) from their external backends. Pulls status, comments, and field updates.

### `/reconcile`

Surface drift between wiki and backends. Shows status mismatches, new comments, new attachments since the last sync — without automatically pulling them.

### `/link <task-a> <task-b> <relationship>`

Create a same-backend relationship between two tickets (e.g., `blocks`, `relates-to`, `duplicates`). Supported relationships vary by backend.

### `/ingest-jira [issue-key | project:KEY]`

Pull a Jira issue into the wiki with full data — description, comments, attachments, vocabulary-aware tagging. See [Jira integration](./integrations/jira.md).

### `/ingest-asana [gid | custom-id | project:gid | section:gid]`

Pull an Asana task into the wiki with full data. See [Asana integration](./integrations/asana.md).

### `/ingest-github [number | repo:owner/name | label:owner/name:label]`

Pull a GitHub issue or PR into the wiki with full data. See [GitHub integration](./integrations/github.md).

### `/get-setup`

Guided setup for backends. Walks you through creating tokens, storing them in `.env.local`, verifying connectivity, and — for Asana — configuring the naming scheme. Use after `init` if you skipped backend setup during the wizard.

---

## Development and planning

These skills live in the main repo's `.claude/commands/` and are intended for rubber-ducky contributors. They aren't bundled into user workspaces.

### `/commit`

Generate a structured commit message from the current diff. Follows the project's commit style.

### `/write-pr [number]`

Generate or update a pull-request description from the branch diff. Pass an existing PR number to update it in place.

### `/write-a-prd`

Interactive PRD authoring. Relentlessly interviews you until the design tree is resolved, then writes a PRD with user stories and implementation decisions, opened as a GitHub issue labeled `PRD`.

### `/prd-to-issues <prd-number>`

Break a PRD into vertical-slice GitHub issues — tracer bullets that each cut through all layers end-to-end.

### `/verify-prd <prd-number>`

Post-implementation audit against a PRD. Finds unmerged branches, migration conflicts, missing features.

### `/add-integration <name>`

Research and scaffold a new external-service integration (Slack, Linear, etc.) — backend interface, REST client, tests, skill.

---

## Utility

### `/query <natural-language-question>`

Natural-language search across your work history. Invokes the `work-historian` agent to find answers with source citations.

### `/lint`

Check workspace health. Invokes the `linter` agent — stale tasks, broken links, frontmatter errors, vocabulary drift. Same surface as `rubber-ducky doctor lint`, but with the agent's ability to reason about patterns across pages.

---

## Agents

Agents don't get called directly — skills invoke them for focused work. Each agent has a narrow purpose and a strict tool allow-list.

| Agent | Purpose |
|---|---|
| `work-historian` | Read-only historical queries with citation support. Powers `/query`. |
| `linter` | Wiki health and drift detection. Powers `/lint` and the morning brief's health summary. |
| `ticket-writer` | Drafts backend-appropriate ticket content (title, body, labels). Powers `/push`. |
| `research-partner` | Generic web research agent. Searches docs, synthesizes answers with source citations. |

## See also

- [CLI reference](./cli-reference.md) — the underlying `rubber-ducky` commands these skills call.
- [Architecture](./architecture.md) — why we split work between CLI and Claude Code skills.
- [Contributing](./contributing.md) — how to write a new skill.
