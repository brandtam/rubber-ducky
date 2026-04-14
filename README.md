# Rubber-Ducky

An AI-assisted work log and second brain CLI, built on [Obsidian](https://obsidian.md) and [Claude Code](https://claude.ai/claude-code).

**Why this exists:** When you use Claude Code with an Obsidian vault as a persistent workspace, the AI can maintain a knowledge base across sessions. But it's slow and expensive — every page creation, frontmatter update, and index rebuild burns tokens on work that doesn't need intelligence. Rubber-Ducky adds a CLI that handles the mechanical bookkeeping (50-200ms, zero tokens) and ships pre-built skills, agents, and workspace structure so you don't have to design it all yourself.

The name comes from [rubber duck debugging](https://en.wikipedia.org/wiki/Rubber_duck_debugging). The project started after a shoulder surgery forced me off the keyboard — I was coding entirely through speech-to-text with Claude Code, narrating my work like talking to a rubber duck that actually talked back. It worked, but the context evaporated at the end of every session. That's when I discovered what Andrej Karpathy calls the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern — using Obsidian as a persistent workspace that the AI maintains across sessions.

I had such a good experience with the pattern that I decided to build a tool around it: CLI commands handle the mechanical work (creating pages, updating frontmatter, rebuilding indexes) at zero token cost, while Claude Code skills handle the intelligent work (morning briefs, end-of-day summaries, PRD authoring) using the workspace as context.

The architecture follows Karpathy's three-layer model: **raw sources** (immutable, in `raw/`) → **wiki** (LLM-maintained markdown, in `wiki/`) → **schema** (configuration in `workspace.md` + `CLAUDE.md`). The operations map directly too: **ingest** external tickets into wiki pages, **query** across the wiki, and **lint** for contradictions, stale claims, and orphan pages.

## Why Obsidian

Rubber-Ducky workspaces are Obsidian vaults. The workspace is plain markdown and YAML frontmatter — you _could_ read it in any editor — but Obsidian turns it into something more:

- **`[[Wikilinks]]`** — Pages cross-reference each other with `[[wikilinks]]`. Obsidian resolves these into clickable navigation and a backlinks panel, so you can see every page that references a task without searching.
- **Graph view** — Obsidian's graph visualizes how daily logs, tasks, and projects connect. Over time the graph becomes a map of where your attention has gone.
- **Dataview** — The [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin can query YAML frontmatter across pages. Filter tasks by status, list everything due this week, or roll up project progress — all from within Obsidian.
- **Local-first** — Everything is files on disk. No sync service, no vendor lock-in, no API rate limits. Git handles versioning.

The `init` wizard creates an `.obsidian/` directory so the workspace is ready to open as a vault immediately.

## Getting started

### Prerequisites

You need three things installed before you start:

1. **[Node.js](https://nodejs.org/) 18+** — Rubber-Ducky is a Node CLI. If you don't have Node, download the LTS version from [nodejs.org](https://nodejs.org/).

2. **[Obsidian](https://obsidian.md/)** — Download and install it. You don't need to create a vault yet — Rubber-Ducky will create one for you (or adopt your existing one).

3. **[Claude Code](https://claude.ai/claude-code)** — The AI skills (`/good-morning`, `/wrap-up`, etc.) run inside Claude Code. Getting set up takes three steps:

   **a) Get a Claude account.** You need either a [Claude Pro or Max](https://claude.com/pricing) subscription, or a [Claude Console](https://console.anthropic.com/) account with pre-paid credits. If you're new to Claude, sign up at [claude.com/pricing](https://claude.com/pricing).

   **b) Install Claude Code.** Use the native installer (recommended — it auto-updates in the background):

   ```bash
   # macOS / Linux / WSL
   curl -fsSL https://claude.ai/install.sh | bash

   # Windows PowerShell
   irm https://claude.ai/install.ps1 | iex

   # Or via Homebrew
   brew install --cask claude-code
   ```

   **c) Authenticate.** The first time you run `claude` in any directory, it will open your browser and prompt you to log in. Credentials are stored locally — you only need to do this once.

   ```bash
   claude          # opens browser login on first run
   ```

   Once you see the Claude Code prompt, you're authenticated. You can close it for now — we'll come back to it after setting up the workspace.

### Install Rubber-Ducky

Clone the repo and build it:

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
npm install
npm run build
```

If you prefer pnpm:

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
pnpm install
pnpm build
```

Now make the `rubber-ducky` command available globally so you can run it from any directory:

```bash
# npm — works out of the box, no PATH changes needed
npm link

# pnpm — requires pnpm's global bin in your PATH
pnpm setup            # adds pnpm bin to your shell profile (one-time)
source ~/.zshrc       # reload your shell (or restart your terminal)
pnpm link --global
```

Verify it worked:

```bash
rubber-ducky --version
```

You should see the version number. If you get "command not found," check that the link step completed without errors.

### Choose your path

Now that the prerequisites and CLI are installed, pick the scenario that matches your situation:

- **[Scenario A: Starting fresh](#scenario-a-starting-fresh)** — You want a new work log from scratch. No existing files, no existing vault.
- **[Scenario B: Migrating an existing vault](#scenario-b-migrating-an-existing-vault)** — You already have an Obsidian vault, markdown second brain, or work log and want to add Rubber-Ducky to it.

---

### Scenario A: Starting fresh

You want a brand new work log. No existing files, no existing vault.

#### A1. Create your workspace

Pick a directory name for your work log. This will become an Obsidian vault. Run the init wizard from wherever you want the directory created:

```bash
rubber-ducky init my-work-log
```

The wizard walks you through four things:

1. **Workspace name** — A friendly name for your work log (e.g., "My Work Log"). This appears in your `workspace.md` config file.

2. **Purpose** — A one-liner describing what this workspace is for (e.g., "Track daily engineering work and tasks"). This gives Claude Code context about your workspace.

3. **Backends** — Optionally connect external tools. Use Space to select, Enter to confirm:
   - **GitHub** — Tracks issues and PRs via the `gh` CLI. You'll be asked which repos to track (e.g., `myorg/project-a`).
   - **Jira** — Tracks issues via the Jira REST API. Requires `JIRA_EMAIL` and `JIRA_API_TOKEN` env vars. If set during init, the wizard auto-discovers your projects so you never need to find project keys manually.
   - **Asana** — Tracks tasks via the Asana REST API. Requires `ASANA_ACCESS_TOKEN` env var. If set during init, the wizard auto-discovers your workspaces, projects, and custom fields.
   - You can skip all backends and add them later by editing `workspace.md`.

4. **Controlled vocabulary** — Define brands, teams, and labels for consistent metadata across your workspace. For example:
   - Brands: `Acme Corp, Widget Co`
   - Teams: `Frontend, Backend, DevOps`
   - Labels: `urgent, bug, feature`
   - Press Enter to skip any of these. You can always add terms later via the `/ubiquitous-language` skill.

When the wizard finishes, you'll have a new `my-work-log/` directory:

```
my-work-log/
├── workspace.md                 # Workspace config (YAML frontmatter)
├── CLAUDE.md                    # Claude Code context file
├── UBIQUITOUS_LANGUAGE.md       # Controlled vocabulary
├── .claude/
│   ├── commands/                # Claude Code skills (good-morning, wrap-up, etc.)
│   ├── agents/                  # Claude Code agents (work-historian, linter, etc.)
│   └── settings.json            # Claude Code permissions
├── wiki/
│   ├── daily/                   # Daily work logs (YYYY-MM-DD.md)
│   ├── tasks/                   # Task pages
│   ├── projects/                # Project pages
│   ├── index.md                 # Auto-generated index
│   └── log.md                   # Timestamped activity log
├── references/                  # Shared templates (frontmatter schemas, ticket formats)
├── raw/                         # Screenshots, attachments
└── .obsidian/                   # Obsidian vault marker (pre-created)
```

#### A2. Open it in Obsidian

1. Open Obsidian
2. Click **"Open folder as vault"**
3. Select the `my-work-log/` directory you just created

You'll see your workspace files in the sidebar. The `wiki/` folder is where everything lives — daily logs, tasks, and projects will accumulate here as you use the tool.

#### A3. Start Claude Code in your workspace

Open a terminal, `cd` into your workspace, and start Claude Code:

```bash
cd my-work-log
claude
```

Claude Code reads the `CLAUDE.md` file in the workspace root, which tells it about the workspace structure, conventions, and available commands. This is what makes Claude Code workspace-aware — it knows about your pages, your tasks, and your vocabulary.

#### A4. Start your first day

Inside Claude Code, say good morning (literally type it or use the slash command):

```
good morning
```

This creates today's daily page (e.g., `wiki/daily/2026-04-13.md`), scans for any existing tasks, and gives you a prioritized morning brief. On day one it'll be mostly empty — that's fine.

You're set up. Obsidian is open showing your vault, Claude Code is running in the workspace, and you have a daily page for today. Start talking to Claude about your work.

---

### Scenario B: Migrating an existing vault

You already have an Obsidian vault, a collection of markdown notes, or an earlier version of a work log. You want to add Rubber-Ducky's structure, skills, and CLI to it without losing any of your existing content.

#### B1. Make sure your existing vault is in a clean state

If your vault is a git repo (recommended), commit or stash any pending changes first:

```bash
cd ~/path/to/my-vault
git status              # check for uncommitted changes
git add -A && git commit -m "Pre-migration snapshot"
```

This gives you a safety net. If anything goes wrong during migration, you can `git checkout .` to get back to exactly where you were.

If your vault isn't a git repo, consider initializing one before migrating:

```bash
cd ~/path/to/my-vault
git init
git add -A && git commit -m "Pre-migration snapshot"
```

#### B2. Run the init wizard on your existing directory

Point `rubber-ducky init` at your vault's directory:

```bash
rubber-ducky init ~/path/to/my-vault
```

The wizard detects your existing markdown files and shows you what it found:

```
Found existing content in /Users/you/path/to/my-vault:
  47 markdown file(s)
  12 with YAML frontmatter

Migration plan:
  35 file(s) will get frontmatter added
  12 file(s) with existing frontmatter will be preserved
  3 directories will be created
  2 template file(s) will be created
```

It asks you to confirm before proceeding. After confirmation, the wizard walks through the same questions as a fresh install (workspace name, purpose, backends, vocabulary).

Here's what happens to your files:

- **Markdown files without frontmatter** get a minimal `title` field added (derived from the filename). Your content is not modified.
- **Markdown files with existing frontmatter** are preserved untouched.
- **Non-markdown files** (images, PDFs, etc.) are left alone.
- **`CLAUDE.md`** — If you have one, it's backed up to `CLAUDE.md.backup` before the bundled version is written. You can diff the two and merge your customizations at your leisure.
- **`UBIQUITOUS_LANGUAGE.md`** and **`workspace.md`** — Created if they don't exist. If they do, the existing versions are preserved.
- **`.claude/commands/` and `.claude/agents/`** — Bundled skills and agents are installed. If you had custom skills, they're overwritten by the bundled versions for skills that share the same name. Custom skills with unique names are untouched.
- **New directories** (`wiki/daily/`, `wiki/tasks/`, `wiki/projects/`, `raw/`, `references/`, `.obsidian/`) are created if they don't already exist. Existing directories are left alone.

#### B3. Review the changes

After migration completes, review what changed:

```bash
cd ~/path/to/my-vault
git diff                # see all changes
git diff --stat         # summary of changed files
```

If you had a custom `CLAUDE.md`, compare it with the bundled version:

```bash
diff CLAUDE.md.backup CLAUDE.md
```

You can selectively revert any changes you don't want:

```bash
# Example: restore your original version of a specific file
git checkout -- path/to/file.md
```

When you're happy, commit:

```bash
git add -A && git commit -m "Add Rubber-Ducky workspace structure"
```

#### B4. Reorganize your files (optional)

Rubber-Ducky expects task pages in `wiki/tasks/`, daily logs in `wiki/daily/`, and project pages in `wiki/projects/`. Your existing files are wherever you left them — the migration doesn't move anything.

You can reorganize manually, or just start using the new structure going forward. Any new tasks, dailies, and projects created by the CLI or Claude Code will land in the right directories. Your old files will still be searchable and linkable via wikilinks.

If you want to move existing files into the `wiki/` structure:

```bash
# Example: move existing task notes into wiki/tasks/
mv my-tasks/*.md wiki/tasks/

# Rebuild the index after moving files
rubber-ducky index rebuild
```

#### B5. Open in Obsidian and start Claude Code

If your vault is already open in Obsidian, it will pick up the new files automatically. If not:

1. Open Obsidian
2. Click **"Open folder as vault"**
3. Select your vault directory

Then start Claude Code:

```bash
cd ~/path/to/my-vault
claude
```

#### B6. Start your first day

Inside Claude Code:

```
good morning
```

Claude will create today's daily page, scan your existing tasks (if any are in `wiki/tasks/`), and give you a morning brief. It might be sparse at first — that's normal. The workspace fills up as you use it.

#### B7. Verify everything works

Run the health check to make sure everything is wired up:

```bash
rubber-ducky doctor
```

This verifies workspace structure, config validity, and backend connectivity (if you configured backends). If anything is off, it tells you what to fix.

You can also run the linter to check your migrated content:

```bash
rubber-ducky doctor lint
```

This flags stale tasks, broken wikilinks, missing frontmatter fields, and vocabulary drift — useful for getting your existing content into shape.

### Reference templates

Every workspace includes a `references/` directory with shared templates that Claude Code loads on demand using the `@references/filename.md` syntax:

- **`references/frontmatter-templates.md`** — Complete YAML schema for daily, task, and project pages. This is the single source of truth for what fields exist and what values are valid.
- **`references/when-to-use-cli.md`** — Decision guide for when Claude should use the CLI vs. handle something directly. Documents the architectural split.
- **`references/<backend>-ticket-template.md`** — Tone, structure, field mappings, and status mappings for each configured backend (GitHub, Jira, Asana). Only created for backends you configure.

These keep Claude Code's instructions DRY — the CLAUDE.md file stays concise and points to references when it needs detailed schemas or formatting rules. You can edit the reference files to customize how Claude formats content for your specific systems.

## Using it day to day

Your primary interface is Claude Code. You stay in a Claude Code session all day, and just talk to it. When something needs AI — synthesizing a morning brief, writing a summary — Claude does that directly. When something is mechanical — creating a page, updating a status, logging an entry — Claude runs the `rubber-ducky` CLI behind the scenes so you don't burn tokens on bookkeeping. You don't need to learn the CLI commands; Claude knows them.

Obsidian stays open alongside so you can browse and edit pages visually. As Claude creates and updates pages, they appear in Obsidian in real time.

### Morning

```
/good-morning
```

Creates today's daily page, scans for urgent items, deadlines, and carried-over work, and gives you a prioritized brief. Suggests a focus task for the day.

### During the day

Just talk to Claude Code like you would a colleague:

- _"Create a task for fixing the auth timeout"_ — Claude runs the CLI to scaffold the page
- _"I'm starting on the auth task"_ — Claude marks it in-progress and logs it to your daily page
- _"Client just reported a 500 on checkout, need to deal with that first"_ — Claude captures it as an ASAP item and switches your active task
- _"Remind me Friday to follow up on the deployment"_ — Claude sets a date-keyed reminder
- _"Had an idea — we should add rate limiting to API v2"_ — Claude files it in your ideas list
- _"The timeout was caused by missing refresh token rotation"_ — Claude logs the finding

Everything you say gets captured in your workspace. Pages appear and update in Obsidian as you work. Click into any task or daily page to add your own notes — Rubber-Ducky manages the frontmatter, you own the content.

### End of day

```
/wrap-up
```

Updates task statuses, stamps today's daily page with what you completed, what's carrying over, and any blockers. Suggests what to focus on tomorrow. Clears your active task so the next morning starts fresh.

### The CLI is still there

You don't _have_ to go through Claude Code for everything. The `rubber-ducky` CLI works directly from any terminal in your workspace directory. This is useful for scripting, automation, or if you just prefer typing commands:

```bash
rubber-ducky page create task "Fix auth timeout"
rubber-ducky task start wiki/tasks/fix-auth-timeout.md
rubber-ducky asap add "Client reported 500 on checkout"
rubber-ducky log append "Traced timeout to missing refresh token rotation"
```

Every command supports `--json` for structured output, so you can pipe them into other tools.

## CLI reference

| Command                            | What it does                                                 |
| ---------------------------------- | ------------------------------------------------------------ |
| `init [directory]`                 | Create a new workspace (interactive wizard)                  |
| `page create <type> [args]`        | Create a daily, task, or project page                        |
| `task start <file>`                | Transition task to in-progress                               |
| `task close <file>`                | Transition task to done                                      |
| `asap add\|list\|resolve`          | Manage urgent items                                          |
| `remind add\|list\|resolve`        | Date-keyed reminders                                         |
| `idea add\|list`                   | Someday/maybe ideas                                          |
| `screenshot ingest <path> <title>` | Capture a screenshot with a linked task page                 |
| `ingest asana [ref]`               | Ingest Asana tasks (single, project, section, or `--mine`)   |
| `ingest jira [ref]`                | Ingest Jira issues (single, project, or `--mine`)            |
| `index rebuild`                    | Regenerate wiki/index.md                                     |
| `log append <message>`             | Add timestamped entry to wiki/log.md                         |
| `wiki search <query>`              | Search across all wiki pages                                 |
| `frontmatter get\|set\|validate`   | Read/write YAML frontmatter on any page                      |
| `backend list\|check`              | Show configured backends, verify connectivity                |
| `update`                           | Update workspace skills to latest bundled versions           |
| `status`                           | Show workspace info                                          |
| `doctor`                           | Run workspace health checks                                  |
| `doctor lint`                      | Lint wiki pages (stale tasks, orphans, broken links, schema) |

## Backends

Backends sync tasks between your wiki and external project management tools. Configure them during `init` or add them later in `workspace.md`:

```yaml
# workspace.md frontmatter
backends:
  - type: github
    mcp_server: github
  - type: jira
    server_url: https://myorg.atlassian.net
    project_key: PROJ
  - type: asana
    workspace_id: "12345"
    project_gid: "67890"
    identifier_field: ECOMM
```

| Backend | Auth                                          | Capabilities                            |
| ------- | --------------------------------------------- | --------------------------------------- |
| GitHub  | `gh` CLI (`gh auth login`)                    | ingest, push, comment                   |
| Jira    | `JIRA_EMAIL` + `JIRA_API_TOKEN` env vars      | ingest, pull, push, comment, transition |
| Asana   | `ASANA_ACCESS_TOKEN` env var                   | ingest, pull, push, comment             |

Asana and Jira use direct REST API calls — no MCP servers required. Set up auth by creating a Personal Access Token (Asana) or API token (Jira) and exporting the env vars. The `/get-setup` skill walks you through it step by step.

Check connectivity:

```bash
rubber-ducky backend check
```

### Ingest

The `ingest` command pulls tasks from external systems into your wiki with full data — description, comments, attachments, status, assignee, tags. Everything is fetched deterministically by the CLI, so no fields are ever skipped.

```bash
rubber-ducky ingest asana                    # all tasks from default project
rubber-ducky ingest asana <task-gid>         # single task
rubber-ducky ingest asana project:<gid>      # specific project
rubber-ducky ingest asana --mine             # only tasks assigned to you

rubber-ducky ingest jira                     # all issues from default project
rubber-ducky ingest jira ECOMM-4643          # single issue
rubber-ducky ingest jira project:ECOMM       # specific project
rubber-ducky ingest jira --mine              # only issues assigned to you
```

Ingest is idempotent — tasks that already exist in your wiki are skipped. Attachments are downloaded to `raw/assets/` so Claude can inspect them. The wiki index and log are updated automatically.

Ingest defaults to your tasks only (`--mine`). Pass `--all` to ingest everything in the project. You can also set `ingest_scope: all` in your `workspace.md` frontmatter to change the default.

### Write-back safety

Every external write (push, comment, transition) goes through a safety layer that:

1. Shows a structured preview of the action, target, and payload
2. Requires explicit confirmation before executing
3. Logs the action to `wiki/log.md` as an audit trail

This is non-configurable and baked into every skill that touches external systems.

## Claude Code skills

These skills run inside [Claude Code](https://claude.ai/claude-code) and use the workspace as context. They live in `.claude/commands/` as markdown files — you can edit them to customize behavior.

### Daily workflow

| Skill                  | What it does                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/good-morning`        | Prioritized morning brief — ASAP items, deadlines, carried-over work                                       |
| `/wrap-up`             | End-of-day summary — updates tasks, logs completions, checks for new vocabulary, suggests tomorrow's focus |
| `/asap-process`        | Interactive triage of your ASAP list — act, convert to task, defer, or dismiss each item                   |
| `/grill-me`            | Stress-test your plan — challenges assumptions, surfaces risks, identifies blind spots                     |
| `/ubiquitous-language` | Scan conversation for domain terms and propose additions to your controlled vocabulary                     |

### Task and backend operations

| Skill            | What it does                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `/start`         | Begin a task — transitions to in-progress, syncs with backend                                 |
| `/close`         | Finish a task — transitions to done, syncs with backend                                       |
| `/push`          | Create an external ticket from a wiki task page                                               |
| `/comment`       | Add a comment to an external ticket from the wiki                                             |
| `/transition`    | Sync a task's status between wiki and backend                                                 |
| `/pull-active`   | Refresh all active tasks from external backends                                               |
| `/reconcile`     | Surface status drift and new comments between wiki and backends                               |
| `/link`          | Create a same-backend relationship between two tickets (blocks, relates to, etc.)             |
| `/ingest-jira`   | Pull a Jira issue into the wiki with comments, attachments, and vocabulary-aware tagging      |
| `/ingest-asana`  | Pull an Asana task into the wiki with comments, attachments, and vocabulary-aware tagging     |
| `/ingest-github` | Pull a GitHub issue/PR into the wiki with comments, attachments, and vocabulary-aware tagging |

### Development and planning

| Skill                     | What it does                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `/commit`                 | Generates a structured commit message from the current diff                                |
| `/write-pr [number]`      | Generates or updates a PR description from the branch diff                                 |
| `/write-a-prd`            | Interactive PRD authoring with user stories and implementation decisions                   |
| `/prd-to-issues`          | Breaks a PRD into vertical-slice GitHub issues                                             |
| `/verify-prd`             | Post-implementation audit — finds unmerged branches, migration conflicts, missing features |
| `/add-integration <name>` | Research and scaffold a new external service integration (Slack, Linear, etc.)             |

### Utility

| Skill    | What it does                                                                             |
| -------- | ---------------------------------------------------------------------------------------- |
| `/query` | Natural language search across your work history via the work-historian agent            |
| `/lint`  | Check workspace health — stale tasks, broken links, frontmatter errors, vocabulary drift |

### Agents

Agents are specialized sub-agents that skills invoke for focused work. They live in `.claude/agents/`.

| Agent                | What it does                                                                          |
| -------------------- | ------------------------------------------------------------------------------------- |
| **work-historian**   | Read-only historical queries with citation support — powers `/query`                  |
| **linter**           | Wiki health and drift detection — powers `/lint` and the morning brief                |
| **ticket-writer**    | Drafts backend-appropriate ticket content — powers `/push`                            |
| **research-partner** | Generic web research agent — searches docs, synthesizes answers with source citations |

## Page types and frontmatter

All pages are markdown with YAML frontmatter. The CLI manages frontmatter; you write the body.

### Daily pages

```yaml
---
title: "2026-04-12"
type: daily
created: 2026-04-12T08:00:00Z
updated: 2026-04-12T14:30:00Z
active_task: fix-auth-timeout # slug of current focus task, or null
morning_brief: true # set by /good-morning
wrap_up: false # set by /wrap-up
tasks_touched: # populated throughout the day
  - fix-auth-timeout
  - update-api-docs
---
```

### Task pages

```yaml
---
title: Fix auth timeout
type: task
ref: "42" # external ID (issue number, task ID), or null
source: github # backend that originated this task, or null
status: in-progress # backlog | to-do | in-progress | in-review | pending | blocked | done | deferred
priority: high
assignee: brandt
tags: [auth, backend]
created: 2026-04-12T10:00:00Z
updated: 2026-04-12T14:30:00Z
closed: null # ISO timestamp when completed
pushed: null # ISO timestamp when pushed to backend
due: 2026-04-15
gh_ref: null # GitHub issue/PR URL
jira_ref: null # Jira ticket URL
asana_ref: null # Asana task URL
comment_count: 0
---
```

### Project pages

```yaml
---
title: API v2
type: project
created: 2026-04-12T10:00:00Z
updated: 2026-04-12T10:00:00Z
status: backlog # same status vocabulary as tasks
tags: [api, backend]
---
```

## Health checks

```bash
# Workspace structure, config validity, backend connectivity
rubber-ducky doctor

# Lint wiki pages for issues
rubber-ducky doctor lint
```

The linter checks for:

- **Stale tasks** — no updates in 7+ days
- **Orphan pages** — not linked from any other page
- **Broken wikilinks** — `[[targets]]` that don't exist
- **Frontmatter schema violations** — missing required fields, invalid status values
- **Vocabulary drift** — terms not in UBIQUITOUS_LANGUAGE.md

## Development

Use whichever package manager you prefer — pnpm, npm, and yarn all work.

```bash
pnpm dev -- <command>       # Run CLI via tsx (no build step)
pnpm test                   # Run all test suites
pnpm test:watch             # Watch mode
pnpm typecheck              # Type check without emitting
pnpm build                  # Compile to dist/
```

## Why not just use Claude Code for everything?

You could. Claude Code can read files, write YAML, and update markdown. The CLI exists because of what happens when you do that hundreds of times across a long session.

**Speed.** A CLI command finishes in 50-200ms. Claude Code reading a file, reasoning about the YAML, and writing it back takes 3-10 seconds with multiple round trips. When you say "log this" or "start this task" ten times a day, the CLI makes the tool feel instant instead of sluggish.

**Reliability.** `rubber-ducky frontmatter set` produces valid YAML every single time. Claude Code _almost always_ will — but "almost always" across hundreds of operations per week means occasional malformed frontmatter, a forgotten field, or a status value with a typo. The CLI follows the schema deterministically.

**Atomicity.** `rubber-ducky task start` does three things in one shot: updates the task frontmatter, logs to the daily page, and appends to the activity log. If Claude Code did those as three separate tool calls and failed on the second, your workspace is in an inconsistent state.

**Context window efficiency.** This is the biggest win. Every file Claude Code reads occupies context window space for the rest of the conversation. In a long session — which is the point of staying in Claude Code all day — that compounds. The CLI keeps the context clean. Instead of reading a 100-line task page to flip one field, Claude runs a one-liner and gets back `{"success": true}`. The context window stays available for the intelligent work that actually needs it.

**Token savings.** Real but modest. A typical day of mechanical operations might save 7,000-15,000 tokens compared to doing everything through AI. At current pricing that's maybe $0.10-0.50/day — not the primary motivator, but a nice side effect.

The split follows a simple rule:

| Good fit for CLI                           | Stays in Claude Code                      |
| ------------------------------------------ | ----------------------------------------- |
| High-frequency (many times/day)            | Low-frequency (once a week, once ever)    |
| Deterministic (same input = same output)   | Context-dependent (needs understanding)   |
| Schema-bound (frontmatter, statuses)       | Creative (synthesis, summarization)       |
| Composable (chains into larger operations) | Conversational (back-and-forth with user) |

Page creation, task transitions, frontmatter updates, index rebuilds, health checks — all CLI. Morning briefs, end-of-day summaries, PRD authoring, integration research — all Claude Code. Each tool does what it's best at.

## Acknowledgments

Rubber-Ducky is a direct implementation of the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern described by [Andrej Karpathy](https://github.com/karpathy). The core insight — that LLMs should maintain the wiki while humans curate sources and ask questions — shapes every design decision in this project.

Several of the Claude Code skills in this project were inspired by and adapted from [Matt Pocock's skills collection](https://github.com/mattpocock/skills) — a curated set of reusable agent commands for planning, development, and knowledge work. If you're building your own Claude Code workflows, his repo is a great place to start.

## License

MIT
