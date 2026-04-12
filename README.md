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
pnpm install    # or npm install, or yarn install
pnpm build      # or npm run build
pnpm link       # or npm link
```

The link step makes the `rubber-ducky` command available globally in your terminal. Verify it worked:

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
├── references/                  # Shared templates (frontmatter schemas, ticket formats)
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

Your primary interface is Claude Code. You stay in a Claude Code session all day, and just talk to it. When something needs AI — synthesizing a morning brief, writing a summary — Claude does that directly. When something is mechanical — creating a page, updating a status, logging an entry — Claude runs the `rubber-ducky` CLI behind the scenes so you don't burn tokens on bookkeeping. You don't need to learn the CLI commands; Claude knows them.

Obsidian stays open alongside so you can browse and edit pages visually. As Claude creates and updates pages, they appear in Obsidian in real time.

### Morning

```
/good-morning
```

Creates today's daily page, scans for urgent items, deadlines, and carried-over work, and gives you a prioritized brief. Suggests a focus task for the day.

### During the day

Just talk to Claude Code like you would a colleague:

- *"Create a task for fixing the auth timeout"* — Claude runs the CLI to scaffold the page
- *"I'm starting on the auth task"* — Claude marks it in-progress and logs it to your daily page
- *"Client just reported a 500 on checkout, need to deal with that first"* — Claude captures it as an ASAP item and switches your active task
- *"Remind me Friday to follow up on the deployment"* — Claude sets a date-keyed reminder
- *"Had an idea — we should add rate limiting to API v2"* — Claude files it in your ideas list
- *"The timeout was caused by missing refresh token rotation"* — Claude logs the finding

Everything you say gets captured in your workspace. Pages appear and update in Obsidian as you work. Click into any task or daily page to add your own notes — Rubber-Ducky manages the frontmatter, you own the content.

### End of day

```
/wrap-up
```

Updates task statuses, stamps today's daily page with what you completed, what's carrying over, and any blockers. Suggests what to focus on tomorrow. Clears your active task so the next morning starts fresh.

### The CLI is still there

You don't *have* to go through Claude Code for everything. The `rubber-ducky` CLI works directly from any terminal in your workspace directory. This is useful for scripting, automation, or if you just prefer typing commands:

```bash
rubber-ducky page create task "Fix auth timeout"
rubber-ducky task start wiki/tasks/fix-auth-timeout.md
rubber-ducky asap add "Client reported 500 on checkout"
rubber-ducky log append "Traced timeout to missing refresh token rotation"
```

Every command supports `--json` for structured output, so you can pipe them into other tools.

## CLI reference

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
| Asana | Asana MCP server | ingest, pull, push, comment |

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
type: daily
created: 2026-04-12T08:00:00Z
updated: 2026-04-12T14:30:00Z
active_task: fix-auth-timeout  # slug of current focus task, or null
morning_brief: true            # set by /good-morning
wrap_up: false                 # set by /wrap-up
tasks_touched:                 # populated throughout the day
  - fix-auth-timeout
  - update-api-docs
---
```

### Task pages

```yaml
---
title: Fix auth timeout
type: task
ref: "42"                      # external ID (issue number, task ID), or null
source: github                 # backend that originated this task, or null
status: in-progress            # backlog | to-do | in-progress | in-review | pending | blocked | done | deferred
priority: high
assignee: brandt
tags: [auth, backend]
created: 2026-04-12T10:00:00Z
updated: 2026-04-12T14:30:00Z
closed: null                   # ISO timestamp when completed
pushed: null                   # ISO timestamp when pushed to backend
due: 2026-04-15
gh_ref: null                   # GitHub issue/PR URL
jira_ref: null                 # Jira ticket URL
asana_ref: null                # Asana task URL
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
status: in-progress
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

**Reliability.** `rubber-ducky frontmatter set` produces valid YAML every single time. Claude Code *almost always* will — but "almost always" across hundreds of operations per week means occasional malformed frontmatter, a forgotten field, or a status value with a typo. The CLI follows the schema deterministically.

**Atomicity.** `rubber-ducky task start` does three things in one shot: updates the task frontmatter, logs to the daily page, and appends to the activity log. If Claude Code did those as three separate tool calls and failed on the second, your workspace is in an inconsistent state.

**Context window efficiency.** This is the biggest win. Every file Claude Code reads occupies context window space for the rest of the conversation. In a long session — which is the point of staying in Claude Code all day — that compounds. The CLI keeps the context clean. Instead of reading a 100-line task page to flip one field, Claude runs a one-liner and gets back `{"success": true}`. The context window stays available for the intelligent work that actually needs it.

**Token savings.** Real but modest. A typical day of mechanical operations might save 7,000-15,000 tokens compared to doing everything through AI. At current pricing that's maybe $0.10-0.50/day — not the primary motivator, but a nice side effect.

The split follows a simple rule:

| Good fit for CLI | Stays in Claude Code |
|---|---|
| High-frequency (many times/day) | Low-frequency (once a week, once ever) |
| Deterministic (same input = same output) | Context-dependent (needs understanding) |
| Schema-bound (frontmatter, statuses) | Creative (synthesis, summarization) |
| Composable (chains into larger operations) | Conversational (back-and-forth with user) |

Page creation, task transitions, frontmatter updates, index rebuilds, health checks — all CLI. Morning briefs, end-of-day summaries, PRD authoring, integration research — all Claude Code. Each tool does what it's best at.

## Acknowledgments

Rubber-Ducky is a direct implementation of the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern described by [Andrej Karpathy](https://github.com/karpathy). The core insight — that LLMs should maintain the wiki while humans curate sources and ask questions — shapes every design decision in this project.

Several of the Claude Code skills in this project were inspired by and adapted from [Matt Pocock's skills collection](https://github.com/mattpocock/skills) — a curated set of reusable agent commands for planning, development, and knowledge work. If you're building your own Claude Code workflows, his repo is a great place to start.

## License

MIT
