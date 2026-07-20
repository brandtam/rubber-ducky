import { stringify as yamlStringify } from "yaml";
import { SETTINGS_TEMPLATE } from "./settings.js";

/**
 * Re-export of the JSONC template written at `rubber-ducky init`. Kept on
 * the templates surface so workspace bootstrapping reaches for one module
 * for all init-time content.
 */
export const VAULT_SETTINGS_TEMPLATE = SETTINGS_TEMPLATE;

/**
 * Ongoing-context-capture pages scaffolded at init time. The `/ingest-writing`
 * skill appends to these — never overwrites — so the schema is intentionally
 * minimal: just enough section structure to keep extractions findable.
 */
export interface ContextPageTemplate {
  /** Path relative to the vault root (e.g. `wiki/voice.md`). */
  relativePath: string;
  content: string;
}

export function generateContextPageTemplates(): ContextPageTemplate[] {
  return [
    { relativePath: "wiki/voice.md", content: VOICE_PAGE_TEMPLATE },
    { relativePath: "wiki/about.md", content: ABOUT_PAGE_TEMPLATE },
    {
      relativePath: "wiki/vocabulary.md",
      content: VOCABULARY_PAGE_TEMPLATE,
    },
    {
      relativePath: "wiki/preferences.md",
      content: PREFERENCES_PAGE_TEMPLATE,
    },
  ];
}

const VOICE_PAGE_TEMPLATE = `---
name: voice
description: "Voice samples and extracted tone patterns. Append-only; never silently overwrite."
---

# Voice

> This page is maintained by the Agent via \`/ingest-writing\`. You can edit it by hand if you want, but you don't have to.

Samples of how the user writes and talks, plus tone patterns extracted from
those samples. Skills that draft on the user's behalf (\`/push\`,
\`/comment\`) read this page to match voice.

## Samples

<!-- Each entry: ### Source — YYYY-MM-DD followed by the raw text and a
short note on why it was kept. Appended by \`/ingest-writing\`. -->

## Extracted patterns

<!-- Short, declarative observations about the user's tone (e.g.
"Prefers active voice; rarely uses adverbs"). Updated as the corpus grows. -->
`;

const ABOUT_PAGE_TEMPLATE = `---
name: about
description: "Factual context about the user — role, team, projects, who-reports-to-whom."
---

# About

> This page is maintained by the Agent via \`/ingest-writing\`. You can edit it by hand if you want, but you don't have to.

Stable facts the Agent should know about the user. Append-only — superseded
facts get marked as such, not deleted, so future drafts don't reassert old
state.

## Identity

<!-- Role, employer, team, where the user sits in the org chart. -->

## Projects

<!-- Active projects, what each is about, why the user cares. -->

## People

<!-- Names, roles, relationships — peers, manager, reports, frequent
collaborators. Source-attributed when added by \`/ingest-writing\`. -->
`;

const VOCABULARY_PAGE_TEMPLATE = `---
name: vocabulary
description: "Terms, acronyms, and internal-system names this workspace expects the Agent to know."
---

# Vocabulary

> This page is maintained by the Agent via \`/ingest-writing\`. You can edit it by hand if you want, but you don't have to.

Terms, acronyms, and internal-system names this workspace uses — the words you
want the Agent to know and use consistently. Append-only.

## Terms

<!-- Each entry: **<term>** — definition. Source-attributed when added by
\`/ingest-writing\`. -->

## Acronyms

<!-- Each entry: **<ACRONYM>** — expansion (one-line note on usage). -->

## Internal system names

<!-- Project codenames, internal tool names, anything an outsider wouldn't
know but the user uses casually. -->
`;

const PREFERENCES_PAGE_TEMPLATE = `---
name: preferences
description: "Communication preferences, style rules, and pet peeves the Agent should respect."
---

# Preferences

> This page is maintained by the Agent via \`/ingest-writing\`. You can edit it by hand if you want, but you don't have to.

How the user wants the Agent to behave when drafting, replying, summarizing,
or otherwise generating content. Append-only.

## Style

<!-- Tone, sentence length, formatting preferences. -->

## Pet peeves

<!-- Patterns to avoid (e.g. "Don't open every Slack message with 'Hey!'"). -->

## Decision-making

<!-- Heuristics the user wants the Agent to apply when faced with ambiguity. -->
`;

export interface TemplateOptions {
  name: string;
  /**
   * Optional. Silent `init` doesn't collect a purpose. Tests and any future
   * caller may set one to control the workspace.md/CLAUDE.md prelude.
   */
  purpose?: string;
}

export function generateWorkspaceMd(opts: TemplateOptions): string {
  const frontmatter: Record<string, unknown> = {
    name: opts.name,
    version: "0.1.0",
    created: new Date().toISOString().split("T")[0],
  };

  if (opts.purpose && opts.purpose.trim()) {
    frontmatter.purpose = opts.purpose;
  }

  const purposeBlock = opts.purpose && opts.purpose.trim()
    ? `\n${opts.purpose}\n`
    : "";

  const body = `# ${opts.name}
${purposeBlock}
## Structure

- \`wiki/daily/\` — Daily work logs
- \`wiki/tasks/\` — Task pages (one per task)
- \`wiki/projects/\` — Project pages (groups of related tasks)
- \`raw/\` — Immutable input (screenshots, attachments)

## Configuration

Edit this file's frontmatter to configure your workspace. Add an integration
with \`/connect <name>\` from inside Claude Code.

See \`rubber-ducky doctor\` to verify configuration.
`;

  return `---\n${yamlStringify(frontmatter).trimEnd()}\n---\n\n${body}`;
}

/**
 * CLAUDE.md shim written into every vault. Claude Code does not read
 * AGENTS.md natively, so CLAUDE.md exists solely to import it — the
 * canonical agent instructions live in AGENTS.md (readable by any
 * AGENTS.md-aware tool). Exactly two lines by design: a pointer comment
 * and the import.
 */
export const CLAUDE_MD_SHIM = `<!-- Managed by rubber-ducky. This shim exists because Claude Code reads CLAUDE.md; the canonical agent instructions live in AGENTS.md — edit that file instead. -->
@AGENTS.md
`;

/**
 * AGENTS.md — the canonical agent-instructions file for a vault.
 * (Formerly generated as CLAUDE.md; CLAUDE.md is now a two-line shim that
 * imports this file. See CLAUDE_MD_SHIM.)
 */
export function generateAgentsMd(opts: TemplateOptions): string {
  const integrationsSection = `
## Connected integrations

No integrations connected yet. Run \`/connect <name>\` from inside Claude Code to wire up an external service via its CLI and a bridge doc.

Once an integration is connected, this section will list it along with a pointer to its bridge guidance at \`.rubber-ducky/integrations/<name>.md\`.
`;

  const purposeBlock = opts.purpose && opts.purpose.trim()
    ? `\n${opts.purpose}\n`
    : "";

  const credentialGuardrails = `
## Credential safety

**NEVER** do any of the following:
- Read, cat, print, or display the contents of \`.env\`, \`.env.local\`, \`.env.*\`, or any file that may contain tokens or secrets
- Ask the user to paste API tokens, passwords, or credentials into the chat
- Log, echo, or output environment variable values that contain secrets
- Include token values in commit messages, task pages, or any persisted file
- Store credentials in \`workspace.md\`, \`AGENTS.md\`, or any tracked file

Credentials belong **only** in the workspace's untracked \`.env.local\` file. Never try to debug a failing integration by inspecting the user's token values.
`;

  return `# ${opts.name}
${purposeBlock}
## You are the primary interface

This is a Rubber-Ducky workspace. The user works by talking to you inside Claude Code. When they describe what they want — creating tasks, logging work, capturing ideas — you make it happen.

Use the \`rubber-ducky\` CLI commands listed below for all mechanical operations (page creation, frontmatter updates, logging). This is faster, more reliable, and preserves your context window.

See @references/when-to-use-cli.md for the full rationale on what goes to CLI vs. what stays in Claude Code.

## On a fresh session

Before responding to the user on the first turn of a new conversation, run:

\`\`\`bash
rubber-ducky settings get onboard.completed
\`\`\`

If the value is \`false\`, invoke \`/onboard\` before anything else — that's the short first-run interview that seeds the context pages (\`wiki/voice.md\`, \`about.md\`, \`vocabulary.md\`, \`preferences.md\`). \`/onboard\` flips the flag itself when it completes, so this check is self-quieting after the first run. Whatever the user said on this first turn can wait until \`/onboard\` hands back.

If the value is \`true\`, proceed normally.

## Workspace structure

- \`workspace.md\` — Workspace configuration (YAML frontmatter)
- \`wiki/daily/\` — Daily work logs (YYYY-MM-DD.md)
- \`wiki/tasks/\` — Task pages (slugified-title.md)
- \`wiki/projects/\` — Project pages
- \`wiki/index.md\` — Auto-generated page index
- \`wiki/log.md\` — Timestamped activity log
- \`wiki/tasks.base\` — Task board (Obsidian Bases view over task pages)
- \`wiki/projects.base\` — Project table (Obsidian Bases view over project pages)
- \`raw/\` — Immutable input files (screenshots, attachments)
${integrationsSection}${credentialGuardrails}

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

- \`rubber-ducky doctor\` — Run health checks (structure, config)
- \`rubber-ducky doctor lint\` — Lint pages (stale tasks, orphans, broken links, schema)
- \`rubber-ducky status\` — Show workspace info
- \`rubber-ducky adopt [dir]\` — Preview (default) or \`--apply\` a non-destructive refresh of managed files

## Conventions

### Schema

- All pages use YAML frontmatter + markdown body — see @references/frontmatter-templates.md for complete schemas
- Task statuses: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
- Daily pages are named YYYY-MM-DD.md
- Task pages are named by slugified title (lowercase, hyphens, no special characters)
- **YAML frontmatter quoting**: always double-quote titles, refs, URLs, dates and any value containing colons or special YAML characters. Unquoted strings break Obsidian's Properties panel.

### Wikilinks

- Use \`[[wikilinks]]\` for cross-references between pages
- A broken wikilink is a *gap signal*, not just an error — it usually means a page should be created. Treat the linter's broken-link warnings as TODOs, not failures.
- Filenames must match wikilink targets exactly (case included). Use hyphens, not slashes.

### Activity log

Every task page has an \`## Activity log\` section. Append a one-line entry on every meaningful touch:

\`\`\`
- **YYYY-MM-DD** — [[wiki/daily/YYYY-MM-DD]] — what happened
\`\`\`

This compounds in value over time: it's how future-you reconstructs *why* a decision was made.

### Append-only operations log

\`wiki/log.md\` is an append-only record of every capture, task transition, and wrap-up. Use \`rubber-ducky log append "<message>"\` — never edit prior entries.

### Raw inputs are immutable

\`raw/\` is the immutable bottom of the three-layer model (raw → wiki → schema). Never modify, rename, or delete files in \`raw/\` once ingested. If a screenshot or attachment was wrong, ingest a new one and supersede the wiki page; leave the raw artifact in place.

### Memory vs wiki boundary

- **Auto-memory** (Claude Code's persistent context) holds *how we work*: user preferences, repeating patterns, project-shaped facts.
- **Wiki** holds *the work itself*: tasks, daily logs, content, dates.

Never persist work content (tasks, decisions, log entries) to memory. Never persist preferences or how-we-work patterns to wiki pages.

## How to respond to common requests

| User says | You do |
|-----------|--------|
| "good morning" / "morning" / "gm" | Run \`/good-morning\` immediately — do not ask for confirmation |
| "wrap up" / "wrapping up" / "end of day" / "eod" | Run \`/wrap-up\` immediately — do not ask for confirmation |
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

Natural-language triggers are first-class. When the user's intent maps cleanly to a skill, invoke the skill directly — do not ask "would you like me to run /x?". The point of this workspace is that the user shouldn't have to remember slash commands.

`;
}

/**
 * Generate reference template files for the workspace.
 * These are the single source of truth for schemas and formats that
 * CLAUDE.md, skills, and agents pull in via @references/... when needed.
 */
export function generateReferenceFiles(): Array<{ path: string; content: string }> {
  return [
    { path: "references/frontmatter-templates.md", content: generateFrontmatterTemplatesRef() },
    { path: "references/when-to-use-cli.md", content: generateWhenToUseCliRef() },
  ];
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
jira_needed: null               # Triage state: yes (Jira ticket exists), no (not needed), null (untriaged). Asana-sourced pages only.
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
| \`screenshot ingest\` | Copy file + create page — mechanical |
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
5. **Is it something the user will want to customize or override?** Skill — the user can edit \`.claude/skills/<name>/SKILL.md\` (and add sibling files for templates or workspace-local convention overrides).
`;
}

/**
 * Generate .claude/settings.json for a workspace.
 * Pre-approves safe operations so Claude Code doesn't prompt for every read
 * and CLI call. Write operations to external systems still require confirmation.
 */
export function generateClaudeSettings(): string {
  const allow: string[] = [
    // Reading files is always safe within the workspace
    "Read",
    "Glob",
    "Grep",

    // rubber-ducky CLI — all commands operate within the workspace directory
    "Bash(rubber-ducky:*)",

    // Directory listing for workspace navigation
    "Bash(ls:*)",
    "Bash(cat:*)",

    // Git read operations
    "Bash(git status:*)",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git branch:*)",
  ];

  // Hook: block reading .env files that may contain secrets.
  // PreToolUse hooks receive tool input as JSON on stdin.
  // Exit 2 with a reason on stdout to block the tool call.
  const envFileGuard = [
    "bash", "-c",
    // Read tool: check file_path for .env patterns
    // Bash tool: check command for cat/head/tail/less/more of .env files
    `INPUT=$(cat); ` +
    `FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4); ` +
    `COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | cut -d'"' -f4); ` +
    `if echo "$FILE_PATH" | grep -qE '(^|/)\\.env(rc)?($|[._-])'; then ` +
      `echo "BLOCKED: Reading .env files is not allowed — they contain secrets. Ask the user to verify credentials out of band."; exit 2; ` +
    `fi; ` +
    `if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|bat).*\\.env'; then ` +
      `echo "BLOCKED: Reading .env files is not allowed — they contain secrets. Ask the user to verify credentials out of band."; exit 2; ` +
    `fi`,
  ].join(" ");

  const settings = {
    permissions: { allow },
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Bash",
          hooks: [
            {
              type: "command",
              command: envFileGuard,
            },
          ],
        },
      ],
    },
  };

  return JSON.stringify(settings, null, 2) + "\n";
}

/**
 * Obsidian Bases views shipped into every vault. `.base` files are YAML
 * documents rendered by Obsidian's core Bases plugin (1.9+) — they replace
 * the Dataview dependency v2 carried. Two views ship: a task board over
 * `wiki/tasks/` and a project table over `wiki/projects/`. Static strings,
 * embedded at compile time like every other template.
 */
export interface BaseViewTemplate {
  /** Path relative to the vault root (e.g. `wiki/tasks.base`). */
  relativePath: string;
  content: string;
}

export function generateBaseViews(): BaseViewTemplate[] {
  return [
    { relativePath: "wiki/tasks.base", content: TASKS_BASE_TEMPLATE },
    { relativePath: "wiki/projects.base", content: PROJECTS_BASE_TEMPLATE },
  ];
}

// Task board. Filters to task pages under wiki/tasks/ and offers a
// status-sorted board plus focused tabs for the common slices. Property
// references use the explicit `note.` prefix so they can never collide
// with Bases' built-in `file.` namespace.
const TASKS_BASE_TEMPLATE = `filters:
  and:
    - file.inFolder("wiki/tasks")
    - file.ext == "md"
    - note.type == "task"
properties:
  note.title:
    displayName: Title
  note.status:
    displayName: Status
  note.priority:
    displayName: Priority
  note.due:
    displayName: Due
  note.updated:
    displayName: Updated
  note.closed:
    displayName: Closed
views:
  - type: table
    name: Board
    order:
      - note.title
      - note.status
      - note.priority
      - note.due
      - note.updated
    sort:
      - property: note.status
        direction: ASC
      - property: note.priority
        direction: ASC
  - type: table
    name: Open
    filters:
      and:
        - note.status != "done"
        - note.status != "deferred"
    order:
      - note.title
      - note.status
      - note.priority
      - note.due
    sort:
      - property: note.status
        direction: ASC
      - property: note.due
        direction: ASC
  - type: table
    name: In progress
    filters:
      and:
        - note.status == "in-progress"
    order:
      - note.title
      - note.priority
      - note.due
      - note.updated
    sort:
      - property: note.updated
        direction: DESC
  - type: table
    name: Done
    filters:
      and:
        - note.status == "done"
    order:
      - note.title
      - note.closed
    sort:
      - property: note.closed
        direction: DESC
`;

// Project table. One row per project page with the fields that matter for
// a portfolio glance.
const PROJECTS_BASE_TEMPLATE = `filters:
  and:
    - file.inFolder("wiki/projects")
    - file.ext == "md"
    - note.type == "project"
properties:
  note.title:
    displayName: Title
  note.status:
    displayName: Status
  note.tags:
    displayName: Tags
  note.created:
    displayName: Created
  note.updated:
    displayName: Updated
views:
  - type: table
    name: Projects
    order:
      - note.title
      - note.status
      - note.tags
      - note.created
      - note.updated
    sort:
      - property: note.updated
        direction: DESC
  - type: table
    name: Active
    filters:
      and:
        - note.status == "in-progress"
    order:
      - note.title
      - note.tags
      - note.updated
    sort:
      - property: note.updated
        direction: DESC
`;

/**
 * Generate a .gitignore for rubber-ducky workspaces.
 * Protects credentials, ignores OS/editor junk, and keeps
 * the repo clean without blocking normal workspace files.
 */
export function generateGitignore(): string {
  return `# Credentials — never commit tokens or secrets
.env
.env.*
*.local

# OS files
.DS_Store
Thumbs.db
Desktop.ini

# Editor / IDE
*.swp
*.swo
*~
.idea/
.vscode/
*.code-workspace

# Node (if running rubber-ducky from source in the workspace)
node_modules/
dist/

# Obsidian — workspace-specific settings that shouldn't be shared
.obsidian/workspace.json
.obsidian/workspace-mobile.json

# Sandcastle worktrees and logs
.sandcastle/worktrees/
.sandcastle/logs/
.sandcastle/.env

# Rubber-Ducky local state (transaction sentinels, history)
.rubber-ducky/
`;
}
