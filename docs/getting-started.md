[← Docs index](./README.md)

# Getting started

This guide walks you from nothing to a working Rubber-Ducky workspace, covering both fresh installs and migrations of existing Obsidian vaults.

## Prerequisites

Three pieces of software need to be installed before you begin:

1. **[Node.js](https://nodejs.org/) 18 or later.** Rubber-Ducky is a Node CLI. If you don't have Node, grab the LTS build from [nodejs.org](https://nodejs.org/).

2. **[Obsidian](https://obsidian.md/).** Download and install — you don't need to create a vault yet. Rubber-Ducky creates one for you (or adopts your existing one).

3. **[Claude Code](https://claude.ai/claude-code).** This is how you interact with your workspace day-to-day. You talk to it throughout the day — telling it what you're working on, asking about related work, asking what you should focus on next — and it drives Rubber-Ducky's skills and CLI behind the scenes to keep your log in sync. The skills (`/good-morning`, `/wrap-up`, etc.) all run inside it. Three substeps:

   **a) Get a Claude account.** You need either a [Claude Pro or Max](https://claude.com/pricing) subscription or a [Claude Console](https://console.anthropic.com/) account with pre-paid credits.

   **b) Install Claude Code.** The native installer auto-updates in the background:

   ```bash
   # macOS / Linux / WSL
   curl -fsSL https://claude.ai/install.sh | bash

   # Windows PowerShell
   irm https://claude.ai/install.ps1 | iex

   # Or via Homebrew
   brew install --cask claude-code
   ```

   **c) Authenticate.** The first time you run `claude` anywhere, it opens your browser for login. Credentials are stored locally — one-time setup.

   ```bash
   claude          # opens browser login on first run
   ```

## Install Rubber-Ducky

Clone the repo and build:

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
npm install
npm run build
```

pnpm works too:

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
pnpm install
pnpm build
```

Make the `rubber-ducky` command available globally:

```bash
# npm — works out of the box
npm link

# pnpm — requires pnpm's global bin in your PATH
pnpm setup            # adds pnpm bin to your shell profile (one-time)
source ~/.zshrc       # reload your shell
pnpm link --global
```

Verify:

```bash
rubber-ducky --version
```

If you see a version number, you're set. If you get "command not found," re-check the link step.

## Choose your path

Two starting scenarios. Pick the one that matches your situation:

- **[Scenario A: Starting fresh](#scenario-a-starting-fresh)** — No existing files, no existing vault.
- **[Scenario B: Migrating an existing vault](#scenario-b-migrating-an-existing-vault)** — You already have an Obsidian vault, markdown second brain, or earlier work log.

---

## Scenario A: Starting fresh

### A1. Create your workspace

Pick a directory name for your work log. This becomes an Obsidian vault.

```bash
rubber-ducky init my-work-log
```

The wizard walks through four things:

1. **Workspace name** — a friendly display label (e.g., "My Work Log") that appears in `workspace.md`. This is display text only — it doesn't need to match the directory you passed to `init`. A folder called `my-work-log/` can have "Engineering Brain" as its workspace name if you prefer.
2. **Purpose** — a one-liner for Claude Code context (e.g., "Track daily engineering work and tasks").
3. **Backends** — optional connections to GitHub, Jira, or Asana. Space to select, Enter to confirm. See the [integration guides](./integrations/asana.md) for details. You can skip all backends and add them later by editing `workspace.md`.
4. **Controlled vocabulary** — brands, teams, and labels for consistent metadata. Skip with Enter; add terms later via `/ubiquitous-language`.

When the wizard finishes you have:

```
my-work-log/
├── workspace.md                 # Workspace config (YAML frontmatter)
├── CLAUDE.md                    # Claude Code context file
├── UBIQUITOUS_LANGUAGE.md       # Controlled vocabulary
├── .claude/
│   ├── commands/                # Claude Code skills
│   ├── agents/                  # Claude Code agents
│   └── settings.json            # Claude Code permissions
├── wiki/
│   ├── daily/                   # Daily work logs (YYYY-MM-DD.md)
│   ├── tasks/                   # Task pages
│   ├── projects/                # Project pages
│   ├── index.md                 # Auto-generated index
│   └── log.md                   # Timestamped activity log
├── references/                  # Shared templates (schemas, ticket formats)
├── raw/                         # Screenshots, attachments
└── .obsidian/                   # Obsidian vault marker (pre-created)
```

### A2. Open it in Obsidian

1. Open Obsidian.
2. Click **Open folder as vault**.
3. Select the `my-work-log/` directory.

Your workspace files appear in the sidebar. The `wiki/` folder is where everything lives — daily logs, tasks, and projects accumulate here as you work.

### A3. Start Claude Code and finish setup

Open a terminal, `cd` into your workspace, and start Claude Code:

```bash
cd my-work-log
claude
```

Claude Code reads `CLAUDE.md` from the workspace root — that file tells it about the structure, conventions, and available skills.

If you configured any backends during `init`, finish setup from inside Claude Code:

```
/get-setup
```

Today `/get-setup` verifies your credentials, checks backend connectivity, and (for Asana) walks you through naming configuration. It's the home for onboarding logic — as Rubber-Ducky grows, more setup tasks land here so first-time users have one place to go. The skill is only installed if you configured at least one backend; skip this step if you didn't.

### A4. Start your first day

Rubber-Ducky is designed to be talked to in plain English. You rarely need to memorize commands or slash-skills — just describe what you want ("ingest the Asana task TIK-4647", "log that I finished the auth bug", "remind me about the deploy on Friday") and Claude Code picks the right tool behind the scenes. Skills like `/good-morning` and `/wrap-up` are shorthand for common patterns, but they're never required — they're just convenient.

Inside Claude Code:

```
good morning
```

This creates today's daily page (e.g., `wiki/daily/2026-04-14.md`), scans for existing tasks, and gives you a prioritized brief. On day one the brief will be mostly empty — expected.

You're set. Obsidian is open, Claude Code is running, today's daily page exists. Start talking.

---

## Scenario B: Migrating an existing vault

Already have an Obsidian vault, a pile of markdown notes, or a previous work-log? Rubber-Ducky adopts it without losing anything.

### B1. Put your vault in a clean state

If your vault is a git repo (recommended), commit or stash pending changes:

```bash
cd ~/path/to/my-vault
git status              # check for uncommitted changes
git add -A && git commit -m "Pre-migration snapshot"
```

If it isn't a git repo, initialize one:

```bash
cd ~/path/to/my-vault
git init
git add -A && git commit -m "Pre-migration snapshot"
```

Either way, you get a safety net: `git checkout .` reverts every change if anything goes sideways.

### B2. Run the init wizard on your existing directory

```bash
rubber-ducky init ~/path/to/my-vault
```

The wizard detects existing markdown and shows you the migration plan:

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

After confirmation, the wizard walks through the same questions as a fresh install (name, purpose, backends, vocabulary).

What happens to your files:

- **Markdown without frontmatter** gets a minimal `title` field (derived from filename). Body unchanged.
- **Markdown with existing frontmatter** is preserved untouched.
- **Non-markdown files** (images, PDFs, etc.) are left alone.
- **`CLAUDE.md`** — if present, backed up to `CLAUDE.md.backup` before the bundled version is written. Diff and merge your customizations at your leisure.
- **`UBIQUITOUS_LANGUAGE.md`** and **`workspace.md`** — created if missing; left alone if they exist.
- **`.claude/commands/`** and **`.claude/agents/`** — bundled skills and agents are installed. Bundled skills with matching names overwrite existing ones; custom skills with unique names are untouched.
- **New directories** (`wiki/daily/`, `wiki/tasks/`, `wiki/projects/`, `raw/`, `references/`, `.obsidian/`) are created if they don't already exist.

### B3. Review the changes

```bash
cd ~/path/to/my-vault
git diff                # see all changes
git diff --stat         # summary
```

If you had a custom `CLAUDE.md`:

```bash
diff CLAUDE.md.backup CLAUDE.md
```

Selectively revert anything you don't want:

```bash
git checkout -- path/to/file.md
```

When you're happy:

```bash
git add -A && git commit -m "Add Rubber-Ducky workspace structure"
```

### B4. Reorganize (optional)

Rubber-Ducky expects tasks in `wiki/tasks/`, dailies in `wiki/daily/`, and projects in `wiki/projects/`. Migration doesn't move existing files.

You can reorganize manually, or just start using the new structure going forward. New tasks, dailies, and projects created by the CLI or Claude Code land in the right directories. Old files remain searchable and linkable.

To move existing files in:

```bash
mv my-tasks/*.md wiki/tasks/
rubber-ducky index rebuild
```

### B5. Open in Obsidian, start Claude Code, and finish setup

If the vault is already open in Obsidian, it picks up the new files automatically. Otherwise:

1. Open Obsidian.
2. Click **Open folder as vault**.
3. Select your vault directory.

Start Claude Code:

```bash
cd ~/path/to/my-vault
claude
```

If you configured any backends during `init`, finish setup from inside Claude Code:

```
/get-setup
```

Today `/get-setup` verifies your credentials, checks backend connectivity, and (for Asana) walks you through naming configuration. It's the home for onboarding logic — as Rubber-Ducky grows, more setup tasks land here. The skill is only installed if you configured at least one backend; skip this step if you didn't.

### B6. Start your first day

Inside Claude Code:

```
good morning
```

### B7. Verify everything works

```bash
rubber-ducky doctor
```

This checks workspace structure, config validity, and backend connectivity. Anything off, it tells you.

Run the linter against your migrated content:

```bash
rubber-ducky doctor lint
```

The linter flags stale tasks, broken wikilinks, missing frontmatter fields, and vocabulary drift — useful for getting existing content into shape.

---

## Reference templates

Every workspace includes a `references/` directory with shared templates that Claude Code loads on demand via the `@references/filename.md` syntax:

- **`references/frontmatter-templates.md`** — YAML schema for daily, task, and project pages. Single source of truth for valid fields and values.
- **`references/when-to-use-cli.md`** — decision guide for when Claude should use the CLI vs. handle something directly.
- **`references/<backend>-ticket-template.md`** — tone, structure, field mappings, and status mappings for each configured backend. Created only for backends you configure.

Edit these to customize how Claude formats content for your specific systems.

## Next steps

- Set up a backend — [Asana](./integrations/asana.md), [Jira](./integrations/jira.md), [GitHub](./integrations/github.md).
- Browse the [CLI reference](./cli-reference.md) for every command and flag.
- Explore [Claude Code skills](./skills-reference.md) you can use day to day.
- Understand the design — [Architecture](./architecture.md).
