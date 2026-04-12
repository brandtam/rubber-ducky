# Rubber-Ducky

An AI-assisted work log and second brain CLI, built on [Obsidian](https://obsidian.md) and [Claude Code](https://claude.ai/claude-code).

The name comes from [rubber duck debugging](https://en.wikipedia.org/wiki/Rubber_duck_debugging) — the engineering technique where you explain your problem out loud to a rubber duck on your desk, and the act of articulating it helps you find the answer. Rubber-Ducky started after a shoulder surgery that took me off the keyboard. I was coding almost entirely through speech-to-text with Claude Code, and I realized I was doing the rubber duck technique all day — talking through my work, narrating decisions, thinking out loud into the microphone. It was an incredibly effective way to work, but the problem was that all of that context evaporated at the end of every conversation. This tool makes the duck remember — and unlike the one on your desk, this one actually answers back.

Inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern — the idea that the tedious part of maintaining a knowledge base isn't the reading or thinking, it's the bookkeeping. Rubber-Ducky gives that bookkeeping to the LLM: CLI commands handle the mechanical work (creating pages, updating frontmatter, rebuilding indexes) at zero token cost, while Claude Code skills handle the intelligent work (morning briefs, end-of-day summaries, PRD authoring) using the workspace as context.

The architecture follows Karpathy's three-layer model: **raw sources** (immutable, in `raw/`) → **wiki** (LLM-maintained markdown, in `wiki/`) → **schema** (configuration in `workspace.md` + `CLAUDE.md`). The operations map directly too: **ingest** external tickets into wiki pages, **query** across the wiki, and **lint** for contradictions, stale claims, and orphan pages.

## Why Obsidian

Rubber-Ducky workspaces are Obsidian vaults. The workspace is plain markdown and YAML frontmatter — you *could* read it in any editor — but Obsidian turns it into something more:

- **`[[Wikilinks]]`** — Pages cross-reference each other with `[[wikilinks]]`. Obsidian resolves these into clickable navigation and a backlinks panel, so you can see every page that references a task without searching.
- **Graph view** — Obsidian's graph visualizes how daily logs, tasks, and projects connect. Over time the graph becomes a map of where your attention has gone.
- **Dataview** — The [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin can query YAML frontmatter across pages. Filter tasks by status, list everything due this week, or roll up project progress — all from within Obsidian.
- **Local-first** — Everything is files on disk. No sync service, no vendor lock-in, no API rate limits. Git handles versioning.

The `init` wizard creates an `.obsidian/` directory so the workspace is ready to open as a vault immediately.

## Getting started

### Step 1: Install the prerequisites

You need three things installed before you start:

1. **[Node.js](https://nodejs.org/) 18+** — Rubber-Ducky is a Node CLI. If you don't have Node, download the LTS version from [nodejs.org](https://nodejs.org/).

2. **[Obsidian](https://obsidian.md/)** — Download and install it. You don't need to create a vault yet — Rubber-Ducky will create one for you.

3. **[Claude Code](https://claude.ai/claude-code)** — The AI skills (`/good-morning`, `/wrap-up`, etc.) run inside Claude Code. Install it if you haven't:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

### Step 2: Install Rubber-Ducky

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
npm install
npm run build
npm link
```

The `npm link` step makes the `rubber-ducky` command available globally in your terminal. Verify it worked:

```bash
rubber-ducky --version
```

### Step 3: Create your workspace

Pick a directory where you want your work log to live. This will become an Obsidian vault. Run the init wizard from wherever you want the directory created:

```bash
rubber-ducky init my-work-log
```

The wizard asks you three things:

1. **Workspace name** — a name for your work log (e.g., "My Work Log")
2. **Purpose** — a one-liner describing what this workspace is for (e.g., "Track daily engineering work and tasks")
3. **Backends** — optionally connect GitHub Issues, Jira, or Asana. You can skip this and add them later. If you're just getting started, skip it.

When it finishes, you'll have a new `my-work-log/` directory:

```
my-work-log/
├── workspace.md                 # Workspace config (YAML frontmatter)
├── CLAUDE.md                    # Claude Code context file
├── UBIQUITOUS_LANGUAGE.md       # Controlled vocabulary
├── wiki/
│   ├── daily/                   # Daily work logs (YYYY-MM-DD.md)
│   ├── tasks/                   # Task pages
│   ├── projects/                # Project pages
│   ├── index.md                 # Auto-generated index
│   └── log.md                   # Timestamped activity log
├── raw/                         # Screenshots, attachments
└── .obsidian/                   # Obsidian config (pre-created)
```

### Step 4: Open it in Obsidian

1. Open Obsidian
2. Click **"Open folder as vault"**
3. Select the `my-work-log/` directory you just created

You'll see your workspace files in the sidebar. The `wiki/` folder is where everything lives — daily logs, tasks, and projects will accumulate here as you use the tool.

### Step 5: Start Claude Code in your workspace

Open a terminal, `cd` into your workspace, and start Claude Code:

```bash
cd my-work-log
claude
```

Claude Code reads the `CLAUDE.md` file in the workspace root, which tells it about the workspace structure, conventions, and available commands. This is what makes Claude Code workspace-aware — it knows about your pages, your tasks, and your vocabulary.

### Step 6: Start your first day

Inside Claude Code, type:

```
/good-morning
```

This creates today's daily page (e.g., `wiki/daily/2026-04-12.md`), scans for any existing tasks, and gives you a prioritized morning brief. On day one it'll be mostly empty — that's fine.

Now you're set up. Obsidian is open showing your vault, Claude Code is running in the workspace, and you have a daily page for today.

### Already have an Obsidian vault?

If you have an existing vault with markdown notes, point `init` at it instead of creating a new directory:

```bash
rubber-ducky init ~/path/to/my-vault
```

The wizard detects existing markdown files and offers to adopt them — adding YAML frontmatter where needed without changing your content. Your existing notes become part of the Rubber-Ducky workspace alongside the new `wiki/` structure.

## Using it day to day

All `rubber-ducky` CLI commands run from your terminal inside the workspace directory. Claude Code skills (the `/slash-commands`) run inside a Claude Code session started in the same directory. Obsidian stays open so you can browse and edit pages visually while the CLI and Claude Code handle the bookkeeping.

### Morning

In Claude Code, run `/good-morning`. It:

- Creates today's daily page if it doesn't exist
- Scans for ASAP items, tasks due today, upcoming deadlines
- Shows carried-over work from yesterday
- Suggests a focus task for the day

### During the day

Use CLI commands from your terminal for quick captures — these are instant and cost zero tokens:

```bash
# Create a new task page
rubber-ducky page create task "Fix auth timeout"

# Mark it as in-progress (updates frontmatter + logs to daily page)
rubber-ducky task start wiki/tasks/fix-auth-timeout.md

# Something urgent comes up — capture it
rubber-ducky asap add "Client reported 500 on checkout"

# Set a reminder for later this week
rubber-ducky remind add 2026-04-15 "Follow up on deployment"

# Jot down an idea for later
rubber-ducky idea add "Rate limiting middleware for API v2"

# Log what you're working on
rubber-ducky log append "Traced timeout to missing refresh token rotation"
```

As you work, you'll see pages appear and update in Obsidian in real time. Click into any task or daily page to read it, add notes, or edit the body — Rubber-Ducky manages the frontmatter, you own the content.

### End of day

In Claude Code, run `/wrap-up`. It:

- Updates task statuses based on the day's activity
- Stamps today's daily page with completed work, carried-over items, and blockers
- Suggests what to focus on tomorrow
- Clears the active task so tomorrow starts fresh

## CLI commands

Every command supports `--json` for structured output.

| Command | What it does |
|---|---|
| `init [directory]` | Create a new workspace (interactive wizard) |
| `page create <type> [args]` | Create a daily, task, or project page |
| `task start <file>` | Transition task to in-progress |
| `task close <file>` | Transition task to done |
| `asap add\|list\|resolve` | Manage urgent items |
| `remind add\|list\|resolve` | Date-keyed reminders |
| `idea add\|list` | Someday/maybe ideas |
| `screenshot ingest <path> <title>` | Capture a screenshot with a linked task page |
| `index rebuild` | Regenerate wiki/index.md |
| `log append <message>` | Add timestamped entry to wiki/log.md |
| `wiki search <query>` | Search across all wiki pages |
| `frontmatter get\|set\|validate` | Read/write YAML frontmatter on any page |
| `backend list\|check` | Show configured backends, verify connectivity |
| `update` | Update workspace skills to latest bundled versions |
| `status` | Show workspace info |
| `doctor` | Run workspace health checks |
| `doctor lint` | Lint wiki pages (stale tasks, orphans, broken links, schema) |

## Backends

Backends sync tasks between your wiki and external project management tools. Configure them during `init` or add them later in `workspace.md`:

```yaml
# workspace.md frontmatter
backends:
  - type: github
    mcp_server: github
  - type: jira
    mcp_server: atlassian-remote
    server_url: https://myorg.atlassian.net
    project_key: PROJ
  - type: asana
    mcp_server: asana
    workspace_id: "12345"
```

| Backend | Requires | Capabilities |
|---|---|---|
| GitHub | `gh` CLI, authenticated | ingest, push, comment |
| Jira | atlassian-remote MCP server | ingest, pull, push, comment, transition |
| Asana | Asana MCP server | ingest, pull, push, comment, transition |

Check connectivity:

```bash
rubber-ducky backend check
```

### Write-back safety

Every external write (push, comment, transition) goes through a safety layer that:

1. Shows a structured preview of the action, target, and payload
2. Requires explicit confirmation before executing
3. Logs the action to `wiki/log.md` as an audit trail

This is non-configurable and baked into every skill that touches external systems.

## Claude Code skills

These skills run inside [Claude Code](https://claude.ai/claude-code) and use the workspace as context.

| Skill | What it does |
|---|---|
| `/good-morning` | Prioritized morning brief — ASAP items, deadlines, carried-over work |
| `/wrap-up` | End-of-day summary — updates tasks, logs completions, suggests tomorrow's focus |
| `/commit` | Generates a structured commit message from the current diff |
| `/write-pr [number]` | Generates or updates a PR description from the branch diff |
| `/verify-prd` | Post-implementation audit — finds unmerged branches, migration conflicts, missing features |
| `/write-a-prd` | Interactive PRD authoring with user stories and implementation decisions |
| `/prd-to-issues` | Breaks a PRD into vertical-slice GitHub issues |

## Page types and frontmatter

All pages are markdown with YAML frontmatter. The CLI manages frontmatter; you write the body.

### Daily pages

```yaml
---
title: "2026-04-12"
date: "2026-04-12"
morning_brief: true
active_task: fix-auth-timeout
wrap_up: false
tasks_touched: ["fix-auth-timeout", "update-api-docs"]
---
```

### Task pages

```yaml
---
title: Fix auth timeout
status: in-progress        # backlog | to-do | in-progress | in-review | pending | blocked | done | deferred
priority: high
assignee: brandt
tags: [auth, backend]
source: github
ref: "42"
created: 2026-04-12T10:00:00Z
updated: 2026-04-12T14:30:00Z
due: 2026-04-15
---
```

### Project pages

```yaml
---
title: API v2
status: in-progress
description: Next-gen API with rate limiting and versioned endpoints
tasks: [fix-auth-timeout, add-rate-limiting, api-versioning]
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

```bash
npm run dev -- <command>    # Run CLI via tsx (no build step)
npm test                    # Run all 26 test suites
npm run test:watch          # Watch mode
npm run typecheck           # Type check without emitting
npm run build               # Compile to dist/
```

## Acknowledgments

Rubber-Ducky is a direct implementation of the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern described by [Andrej Karpathy](https://github.com/karpathy). The core insight — that LLMs should maintain the wiki while humans curate sources and ask questions — shapes every design decision in this project.

## License

MIT
