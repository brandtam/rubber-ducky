import { stringify as yamlStringify } from "yaml";

export interface BackendConfig {
  type: "github" | "jira" | "asana";
  mcp_server: string;
  server_url?: string;
  project_key?: string;
  workspace_id?: string;
}

export interface VocabularyOptions {
  brands?: string[];
  teams?: string[];
  labels?: string[];
}

export interface TemplateOptions {
  name: string;
  purpose: string;
  backends?: BackendConfig[];
}

export function generateWorkspaceMd(opts: TemplateOptions): string {
  const backends = (opts.backends ?? []).map((b) => {
    const entry: Record<string, string> = {
      type: b.type,
      mcp_server: b.mcp_server,
    };
    if (b.server_url) entry.server_url = b.server_url;
    if (b.project_key) entry.project_key = b.project_key;
    if (b.workspace_id) entry.workspace_id = b.workspace_id;
    return entry;
  });

  const frontmatter = {
    name: opts.name,
    purpose: opts.purpose,
    version: "0.1.0",
    created: new Date().toISOString().split("T")[0],
    cli_mode: true,
    backends,
  };

  const body = `# ${opts.name}

${opts.purpose}

## Structure

- \`wiki/daily/\` — Daily work logs
- \`wiki/tasks/\` — Task pages (one per task)
- \`wiki/projects/\` — Project pages (groups of related tasks)
- \`raw/\` — Immutable input (screenshots, attachments)

## Configuration

Edit this file's frontmatter to configure your workspace.
See \`rubber-ducky doctor\` to verify configuration.
`;

  return `---\n${yamlStringify(frontmatter).trimEnd()}\n---\n\n${body}`;
}

export function generateClaudeMd(opts: TemplateOptions): string {
  const backendNames = (opts.backends ?? []).map((b) => b.type);
  const backendSection = backendNames.length > 0
    ? `\nConfigured backends: ${backendNames.join(", ")}. Check connectivity with \`rubber-ducky backend check\`.\n`
    : "";

  return `# ${opts.name}

${opts.purpose}

## You are the primary interface

This is a Rubber-Ducky workspace. The user works by talking to you inside Claude Code. When they describe what they want — creating tasks, logging work, capturing ideas — you make it happen.

**Check \`workspace.md\` frontmatter for \`cli_mode\`:**
- **\`cli_mode: true\`** (default) — Use the \`rubber-ducky\` CLI commands listed below for all mechanical operations (page creation, frontmatter updates, logging). This is faster, more reliable, and preserves your context window.
- **\`cli_mode: false\`** — Perform all operations directly by reading and writing files yourself. Do not call the \`rubber-ducky\` CLI. Same workflows, just manual execution.

See @references/when-to-use-cli.md for the full rationale on what goes to CLI vs. what stays in Claude Code.

## Workspace structure

- \`workspace.md\` — Workspace configuration (YAML frontmatter)
- \`UBIQUITOUS_LANGUAGE.md\` — Controlled vocabulary for this workspace
- \`wiki/daily/\` — Daily work logs (YYYY-MM-DD.md)
- \`wiki/tasks/\` — Task pages (slugified-title.md)
- \`wiki/projects/\` — Project pages
- \`wiki/index.md\` — Auto-generated page index
- \`wiki/log.md\` — Timestamped activity log
- \`raw/\` — Immutable input files (screenshots, attachments)
${backendSection}
Import and follow @UBIQUITOUS_LANGUAGE.md for all terms and conventions.

## CLI commands

All commands support \`--json\` for structured output. Run these via bash.

### Pages and tasks

- \`rubber-ducky page create daily [date]\` — Create a daily page (defaults to today)
- \`rubber-ducky page create task "<title>" [--source <backend>] [--ref <id>]\` — Create a task page
- \`rubber-ducky page create project "<title>"\` — Create a project page
- \`rubber-ducky task start <file>\` — Set task to in-progress, log to daily page
- \`rubber-ducky task close <file>\` — Set task to done, stamp closed date

### Quick capture

- \`rubber-ducky asap add "<message>"\` — Urgent item (persists until resolved)
- \`rubber-ducky asap list\` — Show all ASAP items
- \`rubber-ducky asap resolve <index>\` — Mark ASAP item resolved
- \`rubber-ducky remind add <YYYY-MM-DD> "<message>"\` — Date-keyed reminder
- \`rubber-ducky remind list [date]\` — Show reminders (optionally filtered by date)
- \`rubber-ducky remind resolve <index>\` — Mark reminder resolved
- \`rubber-ducky idea add "<message>"\` — Capture an idea for later
- \`rubber-ducky idea list\` — Show all ideas
- \`rubber-ducky screenshot ingest <path> "<title>"\` — Import screenshot + create task page

### Wiki operations

- \`rubber-ducky index rebuild\` — Regenerate wiki/index.md
- \`rubber-ducky log append "<message>"\` — Add timestamped entry to wiki/log.md
- \`rubber-ducky wiki search "<query>" [--type <type>] [--from <date>] [--to <date>]\` — Search pages

### Frontmatter

- \`rubber-ducky frontmatter get <file> [field]\` — Read frontmatter (all or one field)
- \`rubber-ducky frontmatter set <file> <field> <value>\` — Write a frontmatter field
- \`rubber-ducky frontmatter validate <file> [--type <type>]\` — Validate against schema

### Workspace health

- \`rubber-ducky doctor\` — Run health checks (structure, config, backends)
- \`rubber-ducky doctor lint\` — Lint pages (stale tasks, orphans, broken links, schema)
- \`rubber-ducky backend list\` — Show configured backends
- \`rubber-ducky backend check [name]\` — Verify backend connectivity
- \`rubber-ducky status\` — Show workspace info
- \`rubber-ducky update\` — Update skills to latest bundled versions

## Conventions

- All pages use YAML frontmatter + markdown body — see @references/frontmatter-templates.md for complete schemas
- Task statuses: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
- Daily pages are named YYYY-MM-DD.md
- Task pages are named by slugified title (lowercase, hyphens, no special characters)
- Use \`[[wikilinks]]\` for cross-references between pages

## How to respond to common requests

| User says | You do |
|-----------|--------|
| "Create a task for ..." | \`rubber-ducky page create task "<title>"\` |
| "I'm starting on ..." | Find the task file, run \`rubber-ducky task start <file>\` |
| "Done with ..." / "Finished ..." | Find the task file, run \`rubber-ducky task close <file>\` |
| "Something urgent: ..." | \`rubber-ducky asap add "<message>"\` |
| "Remind me on Friday to ..." | \`rubber-ducky remind add <date> "<message>"\` |
| "I had an idea: ..." | \`rubber-ducky idea add "<message>"\` |
| "Log this: ..." | \`rubber-ducky log append "<message>"\` |
| "What's on my plate?" | Read today's daily page + task pages, synthesize a summary |
| "What did I do yesterday?" | Read yesterday's daily page, summarize |
| "Run a health check" | \`rubber-ducky doctor\` |
`;
}

/**
 * Generate backend-specific skill files for Claude Code.
 * Returns an array of { path, content } for each skill to create.
 */
export function generateBackendSkills(
  backends?: BackendConfig[]
): Array<{ path: string; content: string }> {
  if (!backends || backends.length === 0) return [];

  const skills: Array<{ path: string; content: string }> = [];

  for (const backend of backends) {
    if (backend.type === "github") {
      skills.push({
        path: ".claude/commands/ingest-github.md",
        content: generateIngestGitHubSkill(),
      });
    }
    if (backend.type === "asana") {
      skills.push({
        path: ".claude/commands/ingest-asana.md",
        content: generateIngestAsanaSkill(backend),
      });
    }
  }

  return skills;
}

function generateIngestGitHubSkill(): string {
  return `# Ingest GitHub Issue or PR

Ingest a GitHub issue or pull request into the wiki as a task page.

## Usage

\`\`\`
/ingest-github <issue-or-pr-number>
\`\`\`

## Steps

1. Run \`rubber-ducky backend check github\` to verify connectivity
2. Use the \`gh\` CLI to fetch the issue or PR by number
3. Run \`rubber-ducky page create task "<title>" --source github --ref <number>\` to scaffold the page
4. Update the page frontmatter with fields from GitHub:
   - \`gh_ref\`: The GitHub URL
   - \`status\`: Mapped from GitHub state and labels
   - \`tags\`: From GitHub labels
5. Write the issue/PR description and comments into the page body
6. Run \`rubber-ducky index rebuild\` to update the index
`;
}

function generateIngestAsanaSkill(config: BackendConfig): string {
  const workspaceIdNote = config.workspace_id
    ? `Default workspace ID: \`${config.workspace_id}\`\n\n`
    : "";

  return `# Ingest Asana Task

Ingest an Asana task into the wiki as a task page.

${workspaceIdNote}## Usage

\`\`\`
/ingest-asana <task-id-or-url>
\`\`\`

## Steps

1. Run \`rubber-ducky backend check asana\` to verify connectivity
2. Use the Asana MCP server to fetch the task by ID or URL
3. Run \`rubber-ducky page create task "<title>" --source asana --ref <task-gid>\` to scaffold the page
4. Update the page frontmatter with fields from the Asana task:
   - \`asana_ref\`: The Asana permalink URL
   - \`status\`: Mapped from Asana section/completion state
   - \`assignee\`: From Asana assignee
   - \`due\`: From Asana due date
   - \`tags\`: From Asana tags
5. Write the task description and comments into the page body
6. Run \`rubber-ducky index rebuild\` to update the index

## Bulk ingest

To ingest all tasks from a project: \`/ingest-asana project:<project-gid>\`
To ingest all tasks from a section: \`/ingest-asana section:<section-gid>\`
`;
}

/**
 * Generate reference template files for the workspace.
 * These are the single source of truth for schemas and formats that
 * CLAUDE.md, skills, and agents pull in via @references/... when needed.
 */
export function generateReferenceFiles(
  backends?: BackendConfig[]
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [
    { path: "references/frontmatter-templates.md", content: generateFrontmatterTemplatesRef() },
    { path: "references/when-to-use-cli.md", content: generateWhenToUseCliRef() },
  ];

  const backendTypes = (backends ?? []).map((b) => b.type);

  if (backendTypes.includes("github")) {
    files.push({
      path: "references/github-ticket-template.md",
      content: generateGitHubTicketTemplateRef(),
    });
  }
  if (backendTypes.includes("jira")) {
    files.push({
      path: "references/jira-ticket-template.md",
      content: generateJiraTicketTemplateRef(),
    });
  }
  if (backendTypes.includes("asana")) {
    files.push({
      path: "references/asana-ticket-template.md",
      content: generateAsanaTicketTemplateRef(),
    });
  }

  return files;
}

function generateFrontmatterTemplatesRef(): string {
  return `# Frontmatter Templates

Single source of truth for all page frontmatter schemas in this workspace.
Reference this file with \`@references/frontmatter-templates.md\` in skills and agents.

## Daily page

File location: \`wiki/daily/YYYY-MM-DD.md\`

\`\`\`yaml
---
title: "2026-04-12"           # The date string (required)
type: daily                    # Always "daily" (required)
created: 2026-04-12T08:00:00Z # ISO timestamp (required)
updated: 2026-04-12T08:00:00Z # ISO timestamp, updated on changes
active_task: fix-auth-timeout  # Slug of the current focus task, or null
morning_brief: false           # Set to true after /good-morning runs
wrap_up: false                 # Set to true after /wrap-up runs
tasks_touched:                 # Array of task slugs worked on today
  - fix-auth-timeout
  - update-api-docs
---
\`\`\`

### Body sections

\`\`\`markdown
## Focus
## Work log
## Completed today
## Carried over
## Notes & context
## Blockers
\`\`\`

## Task page

File location: \`wiki/tasks/<slugified-title>.md\`

\`\`\`yaml
---
title: Fix auth timeout         # Human-readable title (required)
type: task                      # Always "task" (required)
ref: "42"                       # External reference ID (issue number, task ID), or null
source: github                  # Backend that originated this task, or null
status: backlog                 # One of: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
priority: null                  # Free-form (high, medium, low, asap), or null
assignee: null                  # Person assigned, or null
tags: []                        # Array of labels/tags
created: 2026-04-12T10:00:00Z  # ISO timestamp (required)
updated: 2026-04-12T14:30:00Z  # ISO timestamp, updated on changes
closed: null                    # ISO timestamp when task was completed, or null
pushed: null                    # ISO timestamp when pushed to external backend, or null
due: null                       # Due date (YYYY-MM-DD string), or null
jira_ref: null                  # Jira ticket URL, or null
asana_ref: null                 # Asana task URL, or null
gh_ref: null                    # GitHub issue/PR URL, or null
comment_count: 0                # Number of comments synced from backend
---
\`\`\`

### Body sections

\`\`\`markdown
## Description
## Context
## Comments
## Activity log
## See also
\`\`\`

## Project page

File location: \`wiki/projects/<slugified-title>.md\`

\`\`\`yaml
---
title: API v2                   # Human-readable title (required)
type: project                   # Always "project" (required)
created: 2026-04-12T10:00:00Z  # ISO timestamp (required)
updated: 2026-04-12T10:00:00Z  # ISO timestamp, updated on changes
status: backlog                 # Same status vocabulary as tasks
tags: []                        # Array of labels/tags
---
\`\`\`

### Body sections

\`\`\`markdown
## Description
## Tasks
## Notes
\`\`\`

## Valid statuses

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

## Naming conventions

- **Daily pages**: Named by date — \`YYYY-MM-DD.md\`
- **Task pages**: Slugified title — lowercase, hyphens for spaces, no special characters (e.g., "Fix Auth Timeout" → \`fix-auth-timeout.md\`)
- **Project pages**: Same slugification as tasks
- **Wikilinks**: Use \`[[slugified-name]]\` to cross-reference between pages
`;
}

function generateGitHubTicketTemplateRef(): string {
  return `# GitHub Ticket Template

How to format content when creating or updating GitHub Issues from wiki task pages.
Reference this file with \`@references/github-ticket-template.md\` in skills and agents.

## Tone

Direct, developer-focused, technical. Write for engineers who will read this in a GitHub notification email.

## Structure

**Title**: Concise, action-oriented, imperative mood.
- Good: "Fix login form crash on submit"
- Bad: "Login form is crashing" or "Bug: login form"

**Body** (GitHub-flavored markdown):

\`\`\`markdown
## Description

<From wiki task page ## Description section>

## Steps to Reproduce

<If applicable — numbered list>

## Context

<From wiki task page ## Context section, if present>

## Acceptance Criteria

<Derived from description — bulleted checklist>
- [ ] Criterion 1
- [ ] Criterion 2
\`\`\`

**Labels**: Map directly from the task page \`tags\` array.

**Assignee**: From task page \`assignee\` field if it maps to a GitHub username.

## Field mapping

| Wiki frontmatter | GitHub field |
|-------------------|-------------|
| title | Issue title |
| tags | Labels |
| assignee | Assignee |
| priority | Label (priority:high, priority:low) |
| status | State (open/closed) + labels for granularity |
| description (body) | Issue body |

## Status mapping

| Wiki status | GitHub representation |
|-------------|---------------------|
| backlog | Open |
| to-do | Open |
| in-progress | Open + "in-progress" label |
| in-review | Open + "in-review" label |
| blocked | Open + "blocked" label |
| done | Closed |
| deferred | Open + "deferred" label |
`;
}

function generateJiraTicketTemplateRef(): string {
  return `# Jira Ticket Template

How to format content when creating or updating Jira tickets from wiki task pages.
Reference this file with \`@references/jira-ticket-template.md\` in skills and agents.

## Tone

Structured, process-oriented, team-readable. Jira tickets are read by PMs, QA, and developers across teams.

## Structure

**Summary**: Clear, structured. Prefix with component or area in brackets.
- Good: "[Login] Fix form crash on submit"
- Bad: "Fix login bug"

**Description** (Jira wiki markup or markdown, depending on instance):

\`\`\`
h3. Description

<From wiki task page ## Description section>

h3. Acceptance Criteria

* Criterion 1
* Criterion 2

h3. Context

<From wiki task page ## Context section, if present>
\`\`\`

**Issue Type**: Infer from content:
- Code defect → Bug
- Implementation work → Task
- User-facing feature → Story

**Labels**: From task page \`tags\` array.

**Priority**: Map from task page \`priority\` field:
| Wiki priority | Jira priority |
|---------------|--------------|
| asap | Highest |
| high | High |
| medium | Medium |
| low | Low |
| null | Medium (default) |

## Field mapping

| Wiki frontmatter | Jira field |
|-------------------|-----------|
| title | Summary |
| tags | Labels |
| assignee | Assignee |
| priority | Priority |
| due | Due Date |
| description (body) | Description |

## Status mapping

| Wiki status | Jira transition |
|-------------|----------------|
| backlog | Backlog / Open |
| to-do | To Do / Selected for Development |
| in-progress | In Progress / Start Progress |
| in-review | In Review |
| blocked | Blocked / Flagged |
| done | Done / Resolve |
| deferred | On Hold / Deferred |
`;
}

function generateAsanaTicketTemplateRef(): string {
  return `# Asana Ticket Template

How to format content when creating or updating Asana tasks from wiki task pages.
Reference this file with \`@references/asana-ticket-template.md\` in skills and agents.

## Tone

Collaborative, clear, action-oriented. Asana tasks are read by cross-functional teams. Keep language accessible.

## Structure

**Name**: Clear, brief task name. No brackets or prefixes — Asana uses projects and sections for organization.
- Good: "Fix login form crash on submit"
- Bad: "[Login] Fix form crash on submit"

**Notes** (rich text):

\`\`\`
Description

<From wiki task page ## Description section>

Context

<From wiki task page ## Context section, if present>

Related tasks

<From wiki task page ## See also, as Asana task links if possible>
\`\`\`

**Tags**: From task page \`tags\` array.

## Field mapping

| Wiki frontmatter | Asana field |
|-------------------|------------|
| title | Task name |
| tags | Tags |
| assignee | Assignee |
| due | Due date |
| description (body) | Notes |

## Status mapping

Asana maps status via the task's **section** within a project and the **completed** flag:

| Wiki status | Asana representation |
|-------------|---------------------|
| backlog | Section: Backlog |
| to-do | Section: To Do |
| in-progress | Section: In Progress |
| in-review | Section: In Review |
| blocked | Section: Blocked |
| done | Completed = true |
| deferred | Section: Later / Deferred |
`;
}

function generateWhenToUseCliRef(): string {
  return `# When to Use CLI vs. Claude Code

Reference this file with \`@references/when-to-use-cli.md\` when making architectural decisions about where new functionality should live.

## The rule

**High-frequency, deterministic, schema-bound work → CLI command.**
**Low-frequency, context-dependent, creative work → Claude Code skill or direct conversation.**

## Why

The CLI exists for four reasons, in order of importance:

1. **Speed** — CLI commands finish in 50-200ms. Claude Code reading, reasoning, and writing takes 3-10 seconds per operation. For things that happen many times a day, the user feels the difference.
2. **Reliability** — CLI commands are deterministic. Same input, same output, every time. Claude Code is almost-always correct, but "almost always" across hundreds of operations per week means occasional mistakes.
3. **Atomicity** — CLI commands that do multiple things (like \`task start\` updating frontmatter + daily page + log) do them in one shot. Multiple Claude Code tool calls can fail partway through.
4. **Context efficiency** — Every file Claude Code reads occupies context window space. CLI commands keep the conversation lean for the work that actually needs AI.

Token savings are real but modest (~7,000-15,000 tokens/day). Not the primary motivator.

## Decision guide

| Question | If yes → CLI | If yes → Claude Code |
|----------|-------------|---------------------|
| Will this run multiple times per day? | Yes | |
| Is the output fully determined by the input? | Yes | |
| Does it follow a fixed schema? | Yes | |
| Does it need to understand context to act? | | Yes |
| Does it require judgment or synthesis? | | Yes |
| Is it a conversation with the user? | | Yes |
| Will it run once a week or less? | | Yes |

## Current split

### CLI commands (mechanical)

| Command | Why CLI |
|---------|---------|
| \`page create\` | Fixed template, schema-bound frontmatter |
| \`task start\` / \`task close\` | Deterministic state transition + multi-file atomic update |
| \`frontmatter get\` / \`set\` / \`validate\` | Pure YAML manipulation, no judgment needed |
| \`asap\` / \`remind\` / \`idea\` | Append to file, parse structured format |
| \`index rebuild\` | Scan all files, generate grouped table — mechanical |
| \`log append\` | Timestamp + append to file |
| \`wiki search\` | Text search across files, return matches |
| \`doctor\` / \`doctor lint\` | Check-based validation against known rules |
| \`backend check\` | Connectivity test, returns pass/fail |
| \`screenshot ingest\` | Copy file + create page — mechanical |
| \`update\` | Diff template files, apply changes |
| \`status\` | Read config, report values |

### Claude Code skills (intelligent)

| Skill | Why Claude Code |
|-------|----------------|
| \`/good-morning\` | Synthesizes priorities from multiple sources, makes judgment calls about focus |
| \`/wrap-up\` | Summarizes a day's work, identifies patterns, suggests tomorrow's focus |
| \`/write-a-prd\` | Creative — interviews user, explores codebase, designs architecture |
| \`/prd-to-issues\` | Judgment — decides how to slice work, what dependencies exist |
| \`/verify-prd\` | Analysis — cross-references branches, code, and issues |
| \`/commit\` | Reads diff, synthesizes intent into a message |
| \`/write-pr\` | Reads full branch diff, writes narrative description |
| \`/add-integration\` | Research — evaluates MCP servers, APIs, capabilities |

### Hybrid pattern (skill calls CLI)

Most skills are hybrid. \`/good-morning\` calls \`rubber-ducky page create daily\` (CLI) to ensure the daily page exists, then reads task pages and synthesizes a brief (AI). The skill orchestrates; the CLI does the mechanical parts.

## When adding new features

Ask these questions:

1. **Could a bash script do this?** If yes, it's a CLI command.
2. **Does it need to read content and make decisions?** If yes, it's a Claude Code skill (that may call CLI commands for the mechanical parts).
3. **Is it a new operation on an existing page type?** Probably CLI — add a subcommand.
4. **Is it a new workflow that combines multiple operations?** Probably a skill — it orchestrates CLI commands + AI synthesis.
5. **Is it something the user will want to customize or override?** Skill — the user can edit the \`.claude/commands/\` file.

## The cli_mode toggle

\`workspace.md\` frontmatter includes \`cli_mode: true\`. When set to \`false\`, Claude Code performs all operations directly (reading/writing files, managing frontmatter by hand) instead of calling the \`rubber-ducky\` CLI. This is useful for:

- A/B testing whether the CLI actually helps
- Debugging when you suspect the CLI is causing an issue
- Working in environments where the CLI isn't installed
`;
}

export function generateUbiquitousLanguageMd(vocabulary?: VocabularyOptions): string {
  const sections: string[] = [];

  sections.push(`# Ubiquitous Language

Controlled vocabulary for this workspace. All team members and AI assistants
should use these terms consistently.

## Statuses

| Term | Meaning |
|------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| in-review | Awaiting review |
| pending | Waiting on external input |
| blocked | Cannot proceed |
| done | Completed |
| deferred | Postponed indefinitely |

## Page types

| Term | Meaning |
|------|---------|
| daily | A daily work log page (wiki/daily/) |
| task | A single work item page (wiki/tasks/) |
| project | A grouping of related tasks (wiki/projects/) |`);

  if (vocabulary?.brands && vocabulary.brands.length > 0) {
    sections.push(`\n## Brands\n\n| Term |\n|------|\n${vocabulary.brands.map((b) => `| ${b} |`).join("\n")}`);
  }

  if (vocabulary?.teams && vocabulary.teams.length > 0) {
    sections.push(`\n## Teams\n\n| Term |\n|------|\n${vocabulary.teams.map((t) => `| ${t} |`).join("\n")}`);
  }

  if (vocabulary?.labels && vocabulary.labels.length > 0) {
    sections.push(`\n## Labels\n\n| Term |\n|------|\n${vocabulary.labels.map((l) => `| ${l} |`).join("\n")}`);
  }

  sections.push(`\n## Custom terms

Add workspace-specific terms below.

<!-- Add your terms here -->
`);

  return sections.join("\n");
}
