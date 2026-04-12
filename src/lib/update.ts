import * as fs from "node:fs";
import * as path from "node:path";

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

1. Update the task page frontmatter with the new backend reference (\`gh_ref\`, \`jira_ref\`, or \`asana_ref\`) and set \`pushed\` to the current ISO timestamp
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

## Output Format by System

### GitHub Issue

- **Title**: Concise, action-oriented (e.g., "Fix login form crash on submit")
- **Body**: Markdown formatted with sections:
  - Description (from wiki ## Description)
  - Context (from wiki ## Context, if present)
  - Acceptance criteria (if derivable from description)
- **Labels**: Suggest from wiki tags
- Tone: Direct, developer-focused, technical

### Jira Ticket

- **Summary**: Clear, structured (e.g., "[Login] Fix form crash on submit")
- **Description**: Jira wiki markup or markdown (depending on instance):
  - h3. Description
  - h3. Acceptance Criteria
  - h3. Context
- **Issue Type**: Infer from content (Bug, Task, Story)
- **Labels**: From wiki tags
- **Priority**: Map from wiki priority field
- Tone: Structured, process-oriented, team-readable

### Asana Task

- **Name**: Clear, brief task name
- **Notes**: Rich text with sections:
  - Description
  - Context
  - Related tasks (from wiki ## See also)
- **Tags**: From wiki tags
- Tone: Collaborative, clear, action-oriented

## Example

Given a wiki task page about a login bug, draft for GitHub:

**Title**: Fix login form crash on submit
**Body**:
\`\`\`markdown
## Description

The login form crashes when the user clicks submit with valid credentials.
Stack trace points to null reference in auth handler.

## Steps to Reproduce

1. Navigate to /login
2. Enter valid credentials
3. Click Submit

## Context

Reported by QA on 2024-03-12. Blocking release 2.1.
\`\`\`
**Labels**: bug, auth, blocking
`,
      description: "Ticket writer agent — draft backend-appropriate ticket content from wiki pages",
    },
  ];
}

/**
 * Scan a workspace and compare local files against bundled templates.
 */
export function scanWorkspace(workspacePath: string): UpdateScanResult {
  const templates = getBundledTemplates();
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
