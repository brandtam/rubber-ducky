import * as fs from "node:fs";
import * as path from "node:path";
import { generateReferenceFiles } from "./templates.js";
import { loadWorkspaceConfig } from "./workspace.js";

export interface BundledTemplate {
  relativePath: string;
  content: string;
  description: string;
}

export type FileStatus = "unchanged" | "modified" | "new";

export interface FileComparison {
  relativePath: string;
  status: FileStatus;
  description: string;
  localContent: string | null;
  bundledContent: string;
  diff: string | null;
}

export interface UpdateScanResult {
  comparisons: FileComparison[];
  unchanged: FileComparison[];
  modified: FileComparison[];
  newFiles: FileComparison[];
}

export type UpdateAction = "keep" | "overwrite" | "skip";

export interface UpdateFileResult {
  relativePath: string;
  action: UpdateAction;
  applied: boolean;
}

/**
 * Returns all templates bundled with the current CLI version.
 * These are skill and agent files that ship with rubber-ducky.
 */
export function getBundledTemplates(): BundledTemplate[] {
  return [
    {
      relativePath: ".claude/commands/good-morning.md",
      content: `# Good Morning

Start the day with a prioritized brief.

## When to invoke

Run this skill whenever the user greets with "good morning", "morning", "gm", or any variant that signals the start of their day. Invoke it immediately — do not ask "would you like me to run /good-morning?" first. The greeting *is* the request.

## Behavior

### Step 1 — Ensure today's daily page exists

Run via Bash:

\`\`\`
rubber-ducky page create daily
\`\`\`

If the page already exists, this is a no-op (the CLI will report it exists). Continue either way.

### Step 2 — Gather context

Read the following files to build situational awareness:

1. **Yesterday's daily page** — check \`wiki/daily/\` for the most recent page before today. Note any items in the "Carried over" section.
2. **Active tasks** — scan \`wiki/tasks/\` for tasks with status \`in-progress\`, \`to-do\`, or \`blocked\`. Read their frontmatter (especially \`status\`, \`priority\`, \`due\`).
3. **ASAP items** — check \`wiki/tasks/\` for any task with \`priority: asap\` or tagged \`asap\`. These must be surfaced first.
4. **Date-keyed reminders** — check \`wiki/tasks/\` for tasks with a \`due\` date matching today. These are deadline items that need attention.
5. **Upcoming deadlines** — check for tasks with \`due\` dates within the next 3 days to flag what's approaching.

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

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md morning_brief true
\`\`\`

(Replace YYYY-MM-DD with today's date.)

### Step 5 — Set active task

If a focus task was suggested and the user agrees, run via Bash:

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task "<task-slug>"
\`\`\`

## Redirect behavior

After handling any interruption during the day, remind the user of their active task by reading the \`active_task\` field from today's daily page frontmatter. If \`active_task\` is set, say: "Ready to get back to [active task]?" This keeps the user focused after context switches.

## Output

A concise, prioritized morning brief. Use short bullet points. Do not reproduce full task contents — just titles, statuses, and due dates. The goal is a quick scan, not a wall of text.
`,
      description: "Morning brief skill — prioritized daily summary",
    },
    {
      relativePath: ".claude/commands/wrap-up.md",
      content: `# Wrap Up

End-of-day summary and workspace update.

## When to invoke

Run this skill whenever the user signals the end of their day — "wrap up", "wrapping up", "end of day", "eod", "done for today", or similar. Invoke it immediately — do not ask "would you like me to run /wrap-up?" first.

## Behavior

### Step 1 — Read today's daily page

Read today's daily page from \`wiki/daily/YYYY-MM-DD.md\`. If no daily page exists, create one first:

\`\`\`
rubber-ducky page create daily
\`\`\`

### Step 2 — Identify tasks touched today

Scan \`wiki/tasks/\` and read activity logs and frontmatter. A task was "touched" if:
- Its \`updated\` timestamp is from today
- It has an activity log entry dated today
- The user mentioned working on it during the session

### Step 3 — Update task pages

For each touched task, run via Bash:

\`\`\`
rubber-ducky frontmatter set wiki/tasks/<slug>.md status <new-status>
rubber-ducky frontmatter set wiki/tasks/<slug>.md updated <now-iso>
\`\`\`

If a task was completed, also set:

\`\`\`
rubber-ducky frontmatter set wiki/tasks/<slug>.md closed <now-iso>
\`\`\`

### Step 4 — Update daily log

Append a wrap-up entry to the workspace log:

\`\`\`
rubber-ducky log append "EOD wrap-up: <N> tasks touched, <M> completed"
\`\`\`

### Step 5 — Create status snapshot in daily page

Update today's daily page body sections by editing the file directly:

- **Completed today** — list tasks that moved to \`done\`
- **Carried over** — list in-progress or to-do tasks that weren't completed
- **Blockers** — note any blocked tasks and why
- **Work log** — add a brief narrative of the day's work

Also update the \`tasks_touched\` frontmatter array:

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md tasks_touched '["task-slug-1","task-slug-2"]'
\`\`\`

### Step 6 — Set the wrap-up flag

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md wrap_up true
\`\`\`

### Step 7 — Clear active task

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task null
\`\`\`

### Step 8 — Vocabulary check (optional, non-blocking)

After the daily summary is complete, check if any undefined terms came up during the day:

1. Read \`UBIQUITOUS_LANGUAGE.md\` to get the current set of defined terms.
2. Scan today's daily page body and the task pages touched today for domain-specific terms not in the vocabulary.
3. If new terms are found, suggest additions: "I noticed these terms aren't in your controlled vocabulary yet: [terms]. Want to add definitions?"
4. If the user accepts, append the terms to the appropriate table (brands, teams, or labels) in \`UBIQUITOUS_LANGUAGE.md\`.
5. If the user declines or skips, proceed without changes — this step does not block wrap-up completion.

## Redirect behavior

If the user triggers this skill but has an \`active_task\` set in today's daily page, confirm they want to wrap up: "You still have [active task] marked as active — ready to wrap up for the day?" This prevents accidental wrap-up mid-flow.

## Output

A concise end-of-day summary:
- Tasks completed today (count + titles)
- Tasks carried over (count + titles)
- Blockers (if any)
- Suggested focus for tomorrow

Keep it brief — the daily page has the full record.
`,
      description: "End-of-day wrap-up skill — daily summary and status update",
    },
    {
      relativePath: ".claude/commands/lint.md",
      content: `# Lint

Check workspace health and consistency.

## Behavior

1. Verify \`workspace.md\` exists and has valid frontmatter
2. Scan \`wiki/tasks/\` for:
   - Stale tasks (in-progress for >7 days with no activity)
   - Missing required frontmatter fields
   - Broken wikilinks
3. Scan \`wiki/daily/\` for:
   - Gaps in daily pages
   - Pages with empty sections
4. Check \`UBIQUITOUS_LANGUAGE.md\` for:
   - Terms used in task pages but not defined
5. Report findings grouped by severity (error, warning, info)

## Output

A structured report of workspace health issues.
`,
      description: "Workspace linter skill — health and consistency checks",
    },
    {
      relativePath: ".claude/commands/query.md",
      content: `# Query

Search your work history with a natural language question.

## Arguments

\`$ARGUMENTS\` — The question to answer (e.g., "when did we first discuss auth?", "what did I work on last week?")

## Behavior

Route the user's question to the **work-historian** agent for a read-only, citation-backed answer.

1. Parse \`$ARGUMENTS\` as the user's natural language query
2. Invoke the work-historian agent with the query
3. The agent will search across daily pages, task pages, project pages, activity logs, and the wiki log
4. Return the agent's synthesized answer with source citations

## Invocation

Use the Agent tool to invoke the work-historian agent:

\`\`\`
Agent({
  subagent_type: "work-historian",
  prompt: "$ARGUMENTS"
})
\`\`\`

If \`$ARGUMENTS\` is empty, ask the user what they want to know about their work history.
`,
      description: "Query skill — natural language work history search via work-historian agent",
    },
    {
      relativePath: ".claude/agents/work-historian.md",
      content: `# Work Historian

A read-only agent for querying work history across the workspace.

## Role

You are a work-historian agent. Your job is to answer questions about past work by searching daily pages, task pages, project pages, activity logs, and the wiki log. You are strictly read-only — do not create, edit, or delete any files.

## Constraints

- **Read-only access**: Never modify, write, edit, create, or delete files. Only read and search.
- **Citation required**: Every claim must reference a specific source page and date.
- **Workspace scope**: Only search within the \`wiki/\` directory of the current workspace.

## Tools Available

Use these tools to find information efficiently:

1. **\`rubber-ducky wiki search <query> [--type <type>] [--from <date>] [--to <date>]\`** (via Bash)
   - Primary search tool. Searches across all wiki pages for keyword matches.
   - Use \`--type daily\` to search only daily pages, \`--type task\` for tasks, \`--type project\` for projects.
   - Use \`--from\` and \`--to\` (YYYY-MM-DD) to filter daily pages by date range.
   - Always pass \`--json\` for structured results.

2. **\`rubber-ducky frontmatter get <file> [field]\`** (via Bash)
   - Extract structured metadata from any wiki page (status, dates, tags, etc.).
   - Use to get specific fields like \`status\`, \`created\`, \`closed\`, \`tasks_touched\`.

3. **Read tool**
   - Read full file contents when you need the complete body of a page.
   - Read \`wiki/daily/YYYY-MM-DD.md\` for daily pages.
   - Read \`wiki/tasks/<slug>.md\` for task pages.
   - Read \`wiki/projects/<slug>.md\` for project pages.
   - Read \`wiki/log.md\` for the activity log.
   - Read \`wiki/index.md\` for a summary of all pages.

4. **Grep tool**
   - Search for specific patterns across files when you need regex matching.

## Search Strategy

For **"when did we first discuss X?"** questions:
1. Run \`rubber-ducky wiki search "<X>" --json\` to find all mentions
2. For each match, check the date — daily page dates are in the filename (YYYY-MM-DD.md), task/project dates are in frontmatter (\`created\` field)
3. Sort chronologically and report the earliest mention
4. Read the relevant page section for context

For **"what did I work on last week?"** questions:
1. Calculate the date range for last week
2. Run \`rubber-ducky wiki search "" --type daily --from <start> --to <end> --json\` or read each daily page directly
3. For each daily page, read the Work log, Completed today, and Focus sections
4. Cross-reference \`tasks_touched\` frontmatter to identify task pages
5. Synthesize a summary organized by day or by task

For **"show me all tasks related to X"** questions:
1. Run \`rubber-ducky wiki search "<X>" --type task --json\`
2. For each matching task, extract key frontmatter (status, priority, created, due)
3. Present as a structured list

For **"how many tasks did I close in <period>?"** questions:
1. Read \`wiki/index.md\` to get a list of all tasks
2. For tasks with status \`done\`, read their frontmatter \`closed\` date
3. Filter by the requested period
4. Report count with list of closed tasks

## Response Format

Always structure your response as:

1. **Answer**: A clear, concise answer to the question
2. **Sources**: A list of source pages that support the answer, formatted as:
   - \`wiki/daily/YYYY-MM-DD.md\` — what was found there
   - \`wiki/tasks/slug.md\` — what was found there
3. **Additional context** (if relevant): Related information the user might find useful

## Examples

**Q: "When did we first discuss the auth rewrite?"**
> The auth rewrite was first discussed on 2024-03-12.
>
> Sources:
> - \`wiki/daily/2024-03-12.md\` — Work log entry: "Discussed auth rewrite approach with team"
> - \`wiki/tasks/auth-rewrite.md\` — Created on 2024-03-12, status: in-progress

**Q: "What did I work on last week?"**
> Last week (2024-03-11 to 2024-03-15) you worked on:
>
> - **Monday 2024-03-11**: Focused on API migration, closed 2 tasks
> - **Tuesday 2024-03-12**: Started auth rewrite discussion, bug triage
> - ...
>
> Sources:
> - \`wiki/daily/2024-03-11.md\` — Work log, Completed today sections
> - \`wiki/daily/2024-03-12.md\` — Work log, Focus sections
`,
      description: "Work historian agent — read-only historical queries with citation support",
    },
    {
      relativePath: ".claude/agents/linter.md",
      content: `# Linter

A wiki health and drift detection agent.

## Role

Analyze workspace wiki pages for consistency issues, stale tasks, broken links, frontmatter errors, vocabulary violations, and backend drift. Report findings grouped by severity.

## Tools

- Run \`rubber-ducky doctor lint --json\` to get structured lint results
- Run \`rubber-ducky doctor --json\` to check workspace health
- Read \`workspace.md\` for backend configuration
- Read \`UBIQUITOUS_LANGUAGE.md\` for controlled vocabulary
- Read \`wiki/tasks/\`, \`wiki/daily/\`, and \`wiki/projects/\` for page analysis

## Checks performed

- **Stale tasks**: in-progress tasks with no update in 7+ days
- **Orphan pages**: task/project pages not linked from any other page
- **Broken wikilinks**: links pointing to non-existent pages
- **Frontmatter errors**: missing required fields, invalid status values
- **Vocabulary violations**: tags not in UBIQUITOUS_LANGUAGE.md
- **Backend drift**: status mismatches or new comments in external systems

## Output

A structured report of findings grouped by severity (error, warning, info) with actionable recommendations for each issue.
`,
      description: "Linter agent — wiki health and drift detection",
    },
    {
      relativePath: ".claude/commands/push.md",
      content: `# Push

Push a wiki task page to an external backend as a new ticket.

## Arguments

\`$ARGUMENTS\` — Path to the task page (e.g., \`wiki/tasks/fix-login-bug.md\`)

## Behavior

### Step 1 — Read the task page

Read the task page specified in \`$ARGUMENTS\`. Extract its frontmatter (title, description, tags, status, source) and body content.

If the task already has a backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`), warn the user that this task may already exist in the target system.

### Step 2 — Identify target backend

Read \`workspace.md\` frontmatter to get configured backends. If multiple backends are configured, ask the user which one to push to. If only one backend is configured, use it.

### Step 3 — Draft ticket content

Use the **ticket-writer** agent to draft backend-appropriate content:

\`\`\`
Agent({
  subagent_type: "ticket-writer",
  prompt: "Draft a <backend-type> ticket from this wiki task page: <task content>"
})
\`\`\`

### Step 4 — Show write-back preview

**MANDATORY**: Before executing ANY external write, show a structured preview:

\`\`\`
Action:  push
Backend: <backend-name>
Target:  (new ticket)
Payload:
  title: <title>
  description: <description summary>
  labels: <tags>
\`\`\`

Ask the user to confirm: "Proceed with creating this ticket? (yes/no)"

**Do NOT proceed without explicit confirmation.**

### Step 5 — Execute push

Only after confirmation, use the backend's push capability to create the ticket.

### Step 6 — Update wiki and log

1. Update the task page frontmatter with the new backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`) and set \`pushed\` to the current ISO timestamp. **When pushing to Jira**, also set \`jira_needed: yes\` — this must override any prior value (including \`no\`) regardless of the page's current \`jira_needed\` state
2. Append an audit entry to \`wiki/log.md\`:
   \`\`\`
   rubber-ducky log append "[write-back] push → <backend> (<ref>)"
   \`\`\`
3. Run \`rubber-ducky index rebuild\` to update the index
`,
      description: "Push skill — create external ticket from wiki task page",
    },
    {
      relativePath: ".claude/commands/comment.md",
      content: `# Comment

Add a comment to an external ticket from the wiki.

## Arguments

\`$ARGUMENTS\` — Path to the task page, optionally followed by the comment text (e.g., \`wiki/tasks/fix-login-bug.md "Great progress on this"\`)

## Behavior

### Step 1 — Read the task page

Read the task page. Extract its backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`).

If no backend reference exists, inform the user: "This task has no backend reference. Push it first with /push."

### Step 2 — Get comment text

If comment text was provided in \`$ARGUMENTS\`, use it. Otherwise, ask the user what they want to comment.

### Step 3 — Show write-back preview

**MANDATORY**: Before executing ANY external write, show a structured preview:

\`\`\`
Action:  comment
Backend: <backend-name>
Target:  <ref>
Payload:
  text: <comment text>
\`\`\`

Ask the user to confirm: "Post this comment? (yes/no)"

**Do NOT proceed without explicit confirmation.**

### Step 4 — Execute comment

Only after confirmation, use the backend's comment capability.

### Step 5 — Update wiki and log

1. Append the comment to the task page's ## Comments section
2. Increment \`comment_count\` in frontmatter
3. Append an audit entry to \`wiki/log.md\`:
   \`\`\`
   rubber-ducky log append "[write-back] comment → <backend> (<ref>)"
   \`\`\`
`,
      description: "Comment skill — add comment to external ticket from wiki",
    },
    {
      relativePath: ".claude/commands/transition.md",
      content: `# Transition

Change a task's status in both the wiki and the external backend.

## Arguments

\`$ARGUMENTS\` — Path to the task page and the target status (e.g., \`wiki/tasks/fix-login-bug.md in-progress\`)

## Behavior

### Step 1 — Read the task page

Read the task page. Extract current status and backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`).

### Step 2 — Validate the transition

Check that the target status is valid: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred.

### Step 3 — Show write-back preview

**MANDATORY**: Before executing ANY external write, show a structured preview:

\`\`\`
Action:  transition
Backend: <backend-name>
Target:  <ref>
Payload:
  from: <current-status>
  to: <target-status>
\`\`\`

Ask the user to confirm: "Transition status? (yes/no)"

**Do NOT proceed without explicit confirmation.**

### Step 4 — Execute transition

Only after confirmation:

1. If the task has a backend reference AND the backend supports transition:
   - Use the backend's transition capability
2. Update the wiki task page status via CLI:
   \`\`\`
   rubber-ducky frontmatter set <task-file> status <target-status>
   rubber-ducky frontmatter set <task-file> updated <now-iso>
   \`\`\`
3. If the target status is \`done\`, also set:
   \`\`\`
   rubber-ducky frontmatter set <task-file> closed <now-iso>
   \`\`\`

### Step 5 — Log the transition

Append an audit entry to \`wiki/log.md\`:
\`\`\`
rubber-ducky log append "[write-back] transition → <backend> (<ref>): <from> → <to>"
\`\`\`
`,
      description: "Transition skill — sync status across wiki and backend",
    },
    {
      relativePath: ".claude/commands/pull-active.md",
      content: `# Pull Active

Pull latest state from backends for all active tasks.

## Behavior

### Step 1 — Find active tasks with backend refs

Scan \`wiki/tasks/\` for task pages that:
- Have status \`in-progress\`, \`in-review\`, \`pending\`, or \`blocked\`
- Have at least one backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`)

Use \`rubber-ducky frontmatter get <file>\` to read each task's frontmatter.

### Step 2 — Read workspace backend config

Read \`workspace.md\` frontmatter to get configured backends. Only pull from backends that are configured and support the \`pull\` capability.

### Step 3 — Pull from each backend

For each active task with a backend reference:
1. Run \`rubber-ducky backend check <backend-type>\` to verify connectivity
2. Use the backend's pull capability to fetch latest state
3. Compare with the local wiki page

### Step 4 — Report changes

For each task, report what changed:
- Status changes (e.g., "PROJ-123: in-progress → in-review in Jira")
- New comments
- Assignee changes
- Due date changes

### Step 5 — Update wiki pages

For each task with changes:
1. Update frontmatter fields that changed (\`status\`, \`assignee\`, \`due\`, \`comment_count\`)
2. Append new comments to the ## Comments section
3. Set \`updated\` to current timestamp
4. Add activity log entry: "- Pulled from <backend> on <date>"

### Step 6 — Summary

Output a summary: "<N> tasks checked, <M> updated, <K> unchanged."
`,
      description: "Pull-active skill — refresh active tasks from backends",
    },
    {
      relativePath: ".claude/commands/reconcile.md",
      content: `# Reconcile

Compare wiki state with backend state and surface differences.

## Behavior

### Step 1 — Find tasks with backend refs

Scan \`wiki/tasks/\` for ALL task pages that have at least one backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`), regardless of status.

### Step 2 — Read workspace backend config

Read \`workspace.md\` frontmatter to get configured backends.

### Step 3 — Compare each task

For each task with a backend reference:
1. Read the local wiki page frontmatter and body
2. Fetch the current state from the external backend
3. Compare: status, assignee, description, comments, due date

### Step 4 — Report drift

Present a structured report of any differences or drift found:

**Status mismatch**: Wiki says "in-progress" but Jira says "In Review"
**Comment drift**: Backend has 5 comments, wiki has 3
**Assignee mismatch**: Wiki says "alice" but backend says "bob"
**Description drift**: Backend description was updated after last sync

Group findings by severity:
- **Error**: Status mismatch (may indicate stale wiki state)
- **Warning**: Comment drift (new discussion not captured locally)
- **Info**: Minor field differences

### Step 5 — Suggest actions

For each drift item, suggest a resolution:
- "Run /pull-active to update wiki from backend"
- "Run /transition to sync status"
- "Run /comment to post local notes to backend"

### Step 6 — Summary

Output: "<N> tasks compared, <M> with drift, <K> in sync."
`,
      description: "Reconcile skill — surface wiki/backend differences",
    },
    {
      relativePath: ".claude/commands/start.md",
      content: `# Start

Start working on a task: set status to in-progress and sync with external backend.

## Arguments

\`$ARGUMENTS\` — Path to the task page (e.g., \`wiki/tasks/fix-login-bug.md\`)

## Behavior

### Step 1 — Start the task locally

Run via Bash:

\`\`\`
rubber-ducky task start $ARGUMENTS
\`\`\`

This sets the task status to in-progress, updates the daily page, and adds an activity log entry.

### Step 2 — Check for backend reference

Read the task page frontmatter. Check if it has a backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`).

If no backend reference exists, the task is local-only — skip to Step 5.

### Step 3 — Show write-back preview

**MANDATORY**: If a backend reference exists, show a structured preview before any external write:

\`\`\`
Action:  transition
Backend: <backend-name>
Target:  <ref>
Payload:
  from: <current-status>
  to: in-progress
\`\`\`

Ask the user to confirm: "Also transition in <backend>? (yes/no)"

**Do NOT proceed with the backend write without explicit confirmation.**

### Step 4 — Transition in backend

Only after confirmation, use the backend's transition capability to set the external status to in-progress.

Append an audit entry to \`wiki/log.md\`:
\`\`\`
rubber-ducky log append "[write-back] transition → <backend> (<ref>): <from> → in-progress"
\`\`\`

### Step 5 — Confirm

Report: "Started: <task title> (status: in-progress)" and, if applicable, "Backend status synced."
`,
      description: "Start skill — begin task with optional backend sync",
    },
    {
      relativePath: ".claude/commands/close.md",
      content: `# Close

Close a task: set status to done and sync with external backend.

## Arguments

\`$ARGUMENTS\` — Path to the task page (e.g., \`wiki/tasks/fix-login-bug.md\`)

## Behavior

### Step 1 — Close the task locally

Run via Bash:

\`\`\`
rubber-ducky task close $ARGUMENTS
\`\`\`

This sets the task status to done, sets the closed date, updates the daily page, and appends to the wiki log.

### Step 2 — Check for backend reference

Read the task page frontmatter. Check if it has a backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`).

If no backend reference exists, the task is local-only — skip to Step 5.

### Step 3 — Show write-back preview

**MANDATORY**: If a backend reference exists, show a structured preview before any external write:

\`\`\`
Action:  transition
Backend: <backend-name>
Target:  <ref>
Payload:
  from: <current-status>
  to: done
\`\`\`

Ask the user to confirm: "Also transition to done in <backend>? (yes/no)"

**Do NOT proceed with the backend write without explicit confirmation.**

### Step 4 — Transition in backend

Only after confirmation, use the backend's transition capability to set the external status to done.

Append an audit entry to \`wiki/log.md\`:
\`\`\`
rubber-ducky log append "[write-back] transition → <backend> (<ref>): <from> → done"
\`\`\`

### Step 5 — Confirm

Report: "Closed: <task title> (status: done)" and, if applicable, "Backend status synced."
`,
      description: "Close skill — finish task with optional backend sync",
    },
    {
      relativePath: ".claude/agents/ticket-writer.md",
      content: `# Ticket Writer

An agent that drafts backend-appropriate ticket content from wiki task pages.

## Role

You are a ticket-writer agent. Your job is to transform wiki task page content into well-formatted ticket content appropriate for a specific external system (GitHub issue, Jira ticket, or Asana task). You draft content — you do not write to any external system.

## Constraints

- **Draft only**: You produce formatted text. You do NOT push, create, or modify external tickets.
- **Faithful to source**: All content must come from the wiki task page. Do not invent details.
- **System-appropriate**: Adapt tone, structure, and formatting to the target system's conventions.

## Input

You will receive:
1. The wiki task page content (frontmatter + body)
2. The target system (github, jira, or asana)

## Output format

Load the appropriate template for the target system:

- **GitHub**: Follow @references/github-ticket-template.md
- **Jira**: Follow @references/jira-ticket-template.md
- **Asana**: Follow @references/asana-ticket-template.md

These templates define the tone, structure, field mappings, and status mappings for each system. If a template file does not exist for the target system, inform the user that the backend's ticket template needs to be created in \`references/\`.
`,
      description: "Ticket writer agent — draft backend-appropriate ticket content from wiki pages",
    },
    {
      relativePath: ".claude/commands/asap-process.md",
      content: `# ASAP Process

Interactive triage of the ASAP list.

## Arguments

\`$ARGUMENTS\` — Optional: an integer index to start from (resumes triage from that item). Omit to start from the first pending item.

## Behavior

### Step 1 — Load the ASAP list

Run via Bash:

\`\`\`
rubber-ducky asap list --json
\`\`\`

This returns an array of items from \`wiki/asap.md\`. Each item has \`index\` (integer), \`message\` (string), \`createdAt\` (ISO timestamp), and \`resolved\` (boolean). Filter to only pending items (\`resolved: false\`).

Present a numbered summary:

\`\`\`
ASAP items (N pending):
1. message (added: date)
2. message (added: date)
...
\`\`\`

If \`$ARGUMENTS\` specifies an index, skip items with an index less than that value (they were already processed in a previous run).

If there are no pending items, report "No pending ASAP items." and stop.

### Step 2 — Walk through items one at a time

For each pending ASAP item, present it with four options:

\`\`\`
[N/total] #index — message
Added: date

What would you like to do?
  (a) Act on it now — drop into this item immediately
  (c) Convert to task — create a wiki task page and resolve this item
  (d) Defer — skip for now, keep on ASAP list
  (x) Dismiss — resolve and remove from ASAP list
\`\`\`

Wait for the user's choice before proceeding.

### Step 3 — Execute the chosen action

**Act (a)**: Report "Switching to this item. Run \`/asap-process <next-index>\` to resume triage." and stop processing. The user will handle the item and can resume later.

**Convert (c)**: Create a task page from the ASAP item. Run via Bash:

\`\`\`
rubber-ducky page create task "<message>"
\`\`\`

Then resolve the ASAP item so it no longer appears as pending:

\`\`\`
rubber-ducky asap resolve <index>
\`\`\`

Confirm: "Converted to task and resolved from ASAP list."

**Defer (d)**: No action needed — the item stays pending on the ASAP list. Confirm: "Deferred." Move to the next item.

**Dismiss (x)**: Resolve the item without creating a task. Run via Bash:

\`\`\`
rubber-ducky asap resolve <index>
\`\`\`

Confirm: "Dismissed." Move to the next item.

### Step 4 — Progress tracking

After each item, show progress: "Processed N of M items."

Resolved items (converted or dismissed) are removed from the pending list immediately. If the user runs the skill again, only unprocessed pending items remain. If the user stops partway through (chooses "act" or interrupts), already-resolved items stay resolved. No progress is lost.

### Step 5 — Completion

When all pending items are processed, summarize:

\`\`\`
ASAP triage complete:
- Acted on: N
- Converted to tasks: N
- Deferred: N
- Dismissed: N
\`\`\`

## Output

Interactive, one-at-a-time triage flow. Keep each item presentation concise. Progress is saved as items are processed — stopping partway through is safe.
`,
      description: "ASAP process skill — interactive ASAP list triage",
    },
    {
      relativePath: ".claude/commands/ubiquitous-language.md",
      content: `# Ubiquitous Language

Evolve the controlled vocabulary by identifying and defining new domain terms.

## Arguments

\`$ARGUMENTS\` — Optional: path to a specific page to scan (e.g., \`wiki/daily/2024-03-15.md\`). If omitted, scans recent conversation context.

## Behavior

### Step 1 — Load the current vocabulary

Read \`UBIQUITOUS_LANGUAGE.md\` from the workspace root. Parse the three tables:
- **Brands** — product and company names
- **Teams** — team and group names
- **Labels** — domain-specific terms, acronyms, and jargon

Build a set of all currently defined terms.

### Step 2 — Scan for undefined terms

If \`$ARGUMENTS\` specifies a page, read that page. Otherwise, review the recent conversation context.

Identify candidate terms that:
- Appear to be domain-specific (not common English words)
- Are used consistently (not one-off mentions)
- Are not already defined in UBIQUITOUS_LANGUAGE.md
- Could be brands, teams, or labels based on context

### Step 3 — Propose additions

For each candidate term, propose a definition in the correct table format:

\`\`\`
Proposed additions to UBIQUITOUS_LANGUAGE.md:

Brands:
| Term | Definition | Aliases |
| ---- | ---------- | ------- |
| NewBrand | Description of the brand | NB, nb |

Teams:
| Term | Definition | Aliases |
| ---- | ---------- | ------- |
| PlatformTeam | The infrastructure team | platform, plat |

Labels:
| Term | Definition | Aliases |
| ---- | ---------- | ------- |
| spike | Time-boxed investigation task | research spike |
\`\`\`

If no new terms are found, report: "No new terms identified — vocabulary is up to date."

### Step 4 — Write after confirmation

Present the proposed additions and ask: "Add these terms to UBIQUITOUS_LANGUAGE.md? You can accept all, select specific terms, or decline."

Only after explicit confirmation, append the accepted terms to the appropriate tables in \`UBIQUITOUS_LANGUAGE.md\` by editing the file directly.

## Output

A list of proposed vocabulary additions with definitions, written only after user confirmation.
`,
      description: "Ubiquitous language skill — evolve controlled vocabulary",
    },
    {
      relativePath: ".claude/commands/grill-me.md",
      content: `# Grill Me

Challenge my thinking. Take my stated plan and relentlessly question assumptions, surface risks, identify missing considerations, and stress-test the approach.

## Arguments

\`$ARGUMENTS\` — The plan, idea, or decision to challenge. Can be a brief description, a path to a file (e.g., a PRD or task page), or empty (you'll ask what to grill).

## Behavior

If \`$ARGUMENTS\` is empty, ask: "What plan or decision do you want me to challenge?"

If \`$ARGUMENTS\` is a file path, read the file and use its content as the plan to challenge.

Then adopt a skeptical, rigorous perspective:

- **Question assumptions**: What are you taking for granted? What if those assumptions are wrong?
- **Surface risks**: What could go wrong? What are the failure modes? What's the blast radius?
- **Identify gaps**: What haven't you considered? What's missing from this plan?
- **Challenge scope**: Is this too ambitious? Too conservative? Are you solving the right problem?
- **Stress-test dependencies**: What are you depending on that's outside your control?
- **Probe alternatives**: Why this approach and not another? What did you reject and why?
- **Check reversibility**: Can you undo this if it doesn't work? What's the cost of being wrong?

Be direct and specific — no softening, no "great plan but..." preamble. Ask hard questions. Push back on hand-wavy answers. If the user's responses reveal new weaknesses, follow up.

This is domain-agnostic — works for technical implementation plans, project approaches, PRD reviews, business decisions, hiring strategies, or any other context where rigorous thinking matters.

## Output

A series of pointed questions and challenges. Keep responses focused — one or two challenges at a time, then wait for the user's response before pressing further. The goal is a dialogue, not a monologue.
`,
      description: "Grill-me skill — challenge thinking and stress-test plans",
    },
    {
      relativePath: ".claude/commands/link.md",
      content: `# Link

Create a same-backend relationship between two tickets and reflect the link in both wiki task pages.

## Arguments

\`$ARGUMENTS\` — Two task references and a relationship type: \`<ref-a> <ref-b> <relationship>\`

Examples:
- \`wiki/tasks/fix-login-bug.md wiki/tasks/auth-rewrite.md blocks\`
- \`WEB-288 WEB-291 blocks\`
- \`owner/repo#12 owner/repo#15 relates-to\`

Supported relationship types: **blocks**, **blocked-by**, **relates-to**, **duplicates**, **duplicated-by**

If \`$ARGUMENTS\` is empty, ask the user to provide two task references and a relationship type.

## Behavior

### Step 1 — Parse arguments

Extract the two task references and the relationship type from \`$ARGUMENTS\`. If any are missing, prompt the user.

### Step 2 — Resolve wiki task pages

For each reference, find the corresponding wiki task page:
- If the reference is a wiki path (e.g., \`wiki/tasks/foo.md\`), read it directly.
- If the reference is a backend key (e.g., \`WEB-288\` or \`owner/repo#12\`), scan \`wiki/tasks/\` for a task page with a matching \`jira_ref\`, \`gh_ref\`, or \`asana_ref\` in frontmatter.

If a wiki page cannot be found for a reference, inform the user and stop.

### Step 3 — Identify the backend

Both tasks must share the same backend. Read the backend reference from each wiki task page (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`).

If the tasks use different backends or have no backend reference, inform the user: "Both tasks must have a backend reference in the same system to create a link."

Read \`workspace.md\` to confirm the backend is configured.

### Step 4 — Show write-back preview

**MANDATORY**: Before executing ANY external write, show a structured preview:

\`\`\`
Action:  link
Backend: <backend-name>
Source:  <ref-a>
Target:  <ref-b>
Type:    <relationship>
\`\`\`

Ask the user to confirm: "Create this link? (yes/no)"

**Do NOT proceed without explicit confirmation.**

### Step 5 — Create the relationship in the backend

Only after confirmation, use the appropriate backend API:

**GitHub**: Add a cross-reference comment on both issues:
\`\`\`
gh issue comment <number-a> --body "Related: <relationship> #<number-b>"
gh issue comment <number-b> --body "Related: <inverse-relationship> #<number-a>"
\`\`\`

**Jira**: Use the Atlassian Remote MCP to create an issue link:
- Link type: map relationship to Jira link type (blocks → Blocks, relates-to → Relates, duplicates → Duplicate)
- Inward issue: ref-a
- Outward issue: ref-b

**Asana**: Use the Asana MCP to set a dependency:
- blocks/blocked-by → \`addDependency\` / \`addDependent\`
- relates-to → add a comment on both tasks noting the relationship
- duplicates → mark as duplicate if supported, otherwise comment

### Step 6 — Update both wiki task pages

Add a \`## Relationships\` section (or append to it if it already exists) on both task pages:

For ref-a:
\`\`\`
- <relationship> [[wiki/tasks/<ref-b-slug>.md|<ref-b-title>]]
\`\`\`

For ref-b (inverse relationship):
\`\`\`
- <inverse-relationship> [[wiki/tasks/<ref-a-slug>.md|<ref-a-title>]]
\`\`\`

Inverse mapping:
- blocks ↔ blocked-by
- relates-to ↔ relates-to
- duplicates ↔ duplicated-by

### Step 7 — Log and rebuild

1. Append an audit entry to \`wiki/log.md\`:
   \`\`\`
   rubber-ducky log append "[write-back] link → <backend> (<ref-a> <relationship> <ref-b>)"
   \`\`\`
2. Run \`rubber-ducky index rebuild\` to update the index
`,
      description: "Link skill — create same-backend relationships between tickets",
    },
    {
      relativePath: ".claude/agents/research-partner.md",
      content: `# Research Partner

A generic research agent that searches the web, reads documentation, and synthesizes answers with source citations.

## Role

You are a research-partner agent. Your job is to research topics thoroughly using web search, documentation reading, and file analysis, then return a synthesized answer with source citations. You are not tied to any specific domain — you can research technical topics, business questions, competitive analysis, or anything else.

## Constraints

- **Read-only within the workspace**: Never create, edit, or delete files in the workspace. You may read workspace files for context.
- **Citation required**: Every factual claim must include a source citation (URL, file path, or document reference).
- **Transparent sourcing**: Distinguish between information from authoritative sources, community sources, and your own synthesis.

## Tools Available

Use these tools to research effectively:

1. **WebSearch** — Search the web for current information. Use specific, targeted queries. Run multiple searches with different phrasings to get comprehensive results.

2. **WebFetch** — Read specific web pages, documentation, API references, blog posts, or any URL. Use this to get full content from search results.

3. **Read** — Read workspace files for context. Use this to understand the user's project, existing documentation, or related code.

4. **Grep** — Search workspace files for specific patterns or terms related to the research topic.

## Research Strategy

1. **Understand the question**: Parse the research request to identify the core question, constraints, and what form the answer should take.

2. **Search broadly first**: Run 2-3 web searches with different phrasings to get a variety of results.

3. **Go deep on promising sources**: Fetch and read the most relevant pages in full. Don't rely on search snippets alone.

4. **Cross-reference**: Verify claims across multiple sources. Note where sources agree and disagree.

5. **Check workspace context**: If the research relates to the user's project, read relevant workspace files to ground the answer in their specific context.

6. **Synthesize**: Combine findings into a clear, structured answer. Don't just list sources — extract insights and draw conclusions.

## Response Format

Structure your response as:

1. **Answer**: A clear, synthesized answer to the research question. Lead with the key finding.

2. **Key findings**: Bullet points of the most important discoveries, each with inline source citations.

3. **Sources**: A numbered list of all sources consulted:
   - \`[1]\` URL or file path — what was found there
   - \`[2]\` URL or file path — what was found there

4. **Confidence level**: Note any uncertainty, conflicting information, or areas where more research would help.

5. **Related questions** (optional): Suggest follow-up research questions the user might want to explore.

## Example

**Q: "What's the current best practice for rate limiting in Node.js APIs?"**

> **Answer**: The current consensus is to use a token bucket algorithm with Redis as the backing store for distributed rate limiting. Express-rate-limit is the most popular middleware but is single-process only — for production systems, rate-limiter-flexible with Redis provides distributed limiting with sliding window support.
>
> **Key findings**:
> - express-rate-limit has 3.2M weekly downloads but only supports in-memory stores by default [1]
> - rate-limiter-flexible supports Redis, Memcached, and MongoDB backends with atomic operations [2]
> - OWASP recommends rate limiting at both API gateway and application layers [3]
>
> **Sources**:
> - [1] https://www.npmjs.com/package/express-rate-limit — package docs and download stats
> - [2] https://github.com/animir/node-rate-limiter-flexible — README and architecture docs
> - [3] https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
>
> **Confidence**: High for the library recommendations (well-established packages with active maintenance). Medium for the specific architecture pattern — depends on scale requirements.
`,
      description: "Research partner agent — web research with source citations",
    },
    {
      relativePath: ".claude/commands/configure-status-mapping.md",
      content: `# Configure Status Mapping

Conversational editor for \`wiki/status-mapping.md\`. Walks the user through each backend's status mapping row by row, explains the canonical wiki vocabulary, and writes the updated file.

## When to invoke

Run this skill when the user asks to configure, edit, or review status mappings — e.g. "configure status mapping", "edit my status mapping", "set up status mapping", or after \`rubber-ducky init\` when prompted to customize mappings.

This skill is safe to re-run on an already-edited file. It reads the current state of \`wiki/status-mapping.md\` each time, so it always reflects the latest mappings.

## Behavior

### Step 1 — Read the current mapping file

Read \`wiki/status-mapping.md\` from the workspace root. If the file does not exist, inform the user and offer to create a default one first by running:

\`\`\`
rubber-ducky init
\`\`\`

Parse the file to identify:
- Which backends have mapping sections (e.g. Jira, Asana)
- The current raw → canonical mappings for each backend
- Any custom entries the user has already added

Also read \`workspace.md\` frontmatter to identify configured backends — if a configured backend is missing from the mapping file, note it so you can offer to add a section.

### Step 2 — Explain the canonical wiki vocabulary

Before walking through mappings, present the canonical wiki status vocabulary so the user understands what they're mapping to:

| Status | Meaning |
|--------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| in-review | Awaiting review |
| pending | Waiting on external input |
| blocked | Cannot proceed |
| done | Completed |
| deferred | Postponed indefinitely |

Reference \`UBIQUITOUS_LANGUAGE.md\` for the full vocabulary. Explain that all backend statuses get translated to one of these canonical values during ingest, so downstream features (daily briefs, linting, drift detection) work consistently.

### Step 3 — Walk through each backend

Process each backend section one at a time. For each backend:

1. **Show the current mappings** as a numbered list:
   \`\`\`
   Jira → wiki mappings:
   1. Backlog → backlog
   2. To Do → to-do
   3. In Progress → in-progress
   ...
   \`\`\`

2. **For each mapping row**, ask the user:
   - **(k) Keep** — accept this row as-is
   - **(c) Change** — change the canonical wiki value this raw status maps to
   - **(r) Remove** — delete this mapping row
   - **(s) Skip to end** — accept all remaining rows for this backend as-is

   Wait for the user's choice before proceeding to the next row.

3. **After reviewing all existing rows**, ask:
   - "Do you want to **add** any new mapping rows for this backend?"
   - If yes, collect the raw backend value and the canonical wiki value for each new entry.
   - Validate that the canonical value is one of the eight wiki statuses listed above.

4. **After all backends are reviewed**, check if any configured backends from \`workspace.md\` are missing a mapping section. Offer to add a default section for each missing backend.

### Step 4 — Show a summary of changes

Before writing, present a summary of all changes made:

\`\`\`
Changes to wiki/status-mapping.md:

Jira → wiki:
  - Changed: "Custom Status" → was "to-do", now "in-progress"
  - Removed: "Old Status" → "backlog"
  - Added: "New Status" → "in-review"

Asana → wiki:
  (no changes)
\`\`\`

If no changes were made, report "No changes — your status mapping is up to date." and stop.

### Step 5 — Write the updated file

After the user confirms the changes, write the updated \`wiki/status-mapping.md\`. Preserve the file format:
- \`type: config\` frontmatter
- \`# Status Mapping\` title
- One \`## <Backend> → wiki\` section per backend with bullet lines: \`- \\\`<raw>\\\` → \\\`<canonical>\\\`\`
- \`## Wiki vocabulary\` reference table at the end

Write the file directly using the Edit tool or Write tool.

## Output

A conversational, row-by-row walkthrough. Keep each prompt concise. The goal is a quick review, not a wall of text.
`,
      description: "Configure status mapping skill — conversational editor for wiki/status-mapping.md",
    },
  ];
}

/**
 * Generate the complete set of reference file templates for a workspace.
 * Reads workspace.md to discover configured backends, then generates
 * both universal and backend-specific reference files.
 */
export function getBundledReferenceFiles(
  workspacePath: string
): BundledTemplate[] {
  let backends;
  try {
    const config = loadWorkspaceConfig(workspacePath);
    backends = config.backends;
  } catch {
    // If workspace.md is missing or unreadable, generate universal refs only
    backends = undefined;
  }

  return generateReferenceFiles(backends).map((ref) => ({
    relativePath: ref.path,
    content: ref.content,
    description: `Reference template — ${ref.path}`,
  }));
}

/**
 * Scan a workspace and compare local files against bundled templates.
 * Reads workspace.md to discover configured backends so backend-specific
 * reference files are included in the scan.
 */
export function scanWorkspace(workspacePath: string): UpdateScanResult {
  const templates = [
    ...getBundledTemplates(),
    ...getBundledReferenceFiles(workspacePath),
  ];
  const comparisons: FileComparison[] = [];

  for (const template of templates) {
    const fullPath = path.join(workspacePath, template.relativePath);
    let localContent: string | null = null;
    let status: FileStatus;
    let diff: string | null = null;

    if (fs.existsSync(fullPath)) {
      localContent = fs.readFileSync(fullPath, "utf-8");
      if (localContent === template.content) {
        status = "unchanged";
      } else {
        status = "modified";
        diff = generateDiff(localContent, template.content);
      }
    } else {
      status = "new";
    }

    comparisons.push({
      relativePath: template.relativePath,
      status,
      description: template.description,
      localContent,
      bundledContent: template.content,
      diff,
    });
  }

  return {
    comparisons,
    unchanged: comparisons.filter((c) => c.status === "unchanged"),
    modified: comparisons.filter((c) => c.status === "modified"),
    newFiles: comparisons.filter((c) => c.status === "new"),
  };
}

/**
 * Generate a unified-style diff between two strings using LCS.
 * Returns empty string if content is identical.
 */
export function generateDiff(localContent: string, bundledContent: string): string {
  if (localContent === bundledContent) return "";

  const localLines = localContent.split("\n");
  const bundledLines = bundledContent.split("\n");

  // Build LCS table
  const m = localLines.length;
  const n = bundledLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (localLines[i - 1] === bundledLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff operations
  const ops: Array<{ type: "+" | "-" | " "; line: string }> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && localLines[i - 1] === bundledLines[j - 1]) {
      ops.unshift({ type: " ", line: localLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "+", line: bundledLines[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "-", line: localLines[i - 1] });
      i--;
    }
  }

  return ops.map((op) => `${op.type}${op.line}`).join("\n");
}

/**
 * Apply an update action to a single file.
 */
export function applyFileUpdate(
  workspacePath: string,
  relativePath: string,
  bundledContent: string,
  action: UpdateAction
): UpdateFileResult {
  if (action === "keep" || action === "skip") {
    return { relativePath, action, applied: false };
  }

  const fullPath = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bundledContent, "utf-8");

  return { relativePath, action, applied: true };
}
