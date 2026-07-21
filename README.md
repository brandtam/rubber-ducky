# rubber-ducky

> **A deterministic memory layer for Claude Code.** You talk to the agent; the agent thinks; rubber-ducky writes it down — typed markdown, in a vault you own, from a CLI that does the same thing every time.

rubber-ducky is a [Claude Code](https://claude.com/claude-code) plugin that gives the agent a place to remember. Describe a task, think out loud, paste in a draft — underneath, deterministic CLI verbs record it as structured markdown: tasks, daily notes, projects, the context of who you are and how you work. Claude brings the judgment; the CLI brings the certainty.

The vault is plain markdown — open it, grep it, keep it in git. It's [Obsidian](https://obsidian.md/)-compatible if you want the graph and dashboards, but it runs perfectly headless. Obsidian is a nice viewer, never a requirement.

**Claude is the brain. The CLI is the hands. The vault is the memory — and it's yours.**

## A lighter rubber-ducky

A ground-up rewrite of [rubber-ducky-legacy](https://github.com/brandtam/rubber-ducky-legacy) — same proven vault engine, none of the weight:

- **Two-command install.** Add the marketplace, install the plugin. No git, no Node, no build step.
- **Light touch.** rubber-ducky only writes files it owns; your notes are untouchable. Point it at a fresh folder or years of existing ones.
- **Integrations you wire, not ones I ship.** It bridges to whatever CLI you already have. Adding a service never waits on a release.
- **Meets the tools where they are.** Native Claude Code memory, Obsidian Bases, the official Obsidian skills — leaned on, not reinvented.

A thin layer that sits *under* the agent's work and keeps it grounded — not a framework that runs the show.

## How it works

You talk to Claude; Claude calls `rubber-ducky` for the must-be-exact parts — create a typed page, set a field, start or close a task atomically across the task page, daily log, and index. Judgment stays with the agent; the record underneath stays deterministic. Everything lives in one folder: `wiki/` for your typed pages, a small CLI for pages/frontmatter/search/tasks/capture/health, and a manifest so updates never reach past rubber-ducky's own files.

## Install

rubber-ducky attaches to a directory — the folder that becomes (or already is) your vault. It doesn't need to be a git repository; any folder works. Start Claude Code there:

```
cd path/to/your-vault    # a fresh folder, or one full of existing notes
claude
```

Then, inside Claude Code:

```
/plugin marketplace add brandtam/rubber-ducky
/plugin install rubber-ducky
```

Claude Code asks where to install. It says "repo" — read that as "this directory":

- **Install for you, in this repo only (local scope)** — the usual choice. This one folder is a vault; every other project is untouched.
- **Install for you (user scope)** — active in every session, in every directory. Pick this if you'll open your vault from several places or want more than one vault.
- **Install for all collaborators (project scope)** — records the plugin in the folder's shared `.claude/settings.json`, so anyone who clones it gets rubber-ducky too. Only meaningful for a vault that really is a shared repo.

Then run `/reload-plugins` (Claude Code reminds you) so the plugin loads into the session you're in.

One toggle worth flipping now: Claude Code does **not** auto-update plugins from third-party marketplaces, so bug fixes won't reach you on their own. Enable it under `/plugin` → Marketplaces → rubber-ducky → **Enable auto-update**. The only manual alternative is a reinstall (`/plugin uninstall rubber-ducky@rubber-ducky`, then `/plugin install rubber-ducky@rubber-ducky`) — `/plugin marketplace update` alone refreshes the catalog but leaves installed plugins pinned while auto-update is off. If it's off, rubber-ducky reminds you once at session start.

The plugin ships a small wrapper; the right binary for your platform is fetched on first use and pre-warmed at session start. The `rubber-ducky` CLI lives inside your Claude Code sessions — the agent runs it for you — it's not on your terminal PATH.

Last step: turn the folder into a vault, by asking.

- **Fresh, empty folder:** say *"set this folder up as a new vault"* — the agent runs `rubber-ducky init` for you.
- **Existing notes** (including a legacy vault): say *"adopt this folder"* — the agent runs `rubber-ducky adopt`, which prints a plan of what it would add and writes nothing until you approve. Either way your files are untouchable: rubber-ducky only writes files it owns.

(Prefer to drive the CLI yourself? Prefix it with `!` at the Claude prompt — `! rubber-ducky adopt .` — a bare `rubber-ducky ...` typed into the prompt is just chat to the agent, not a shell command.)

Then say `hi` — a short onboarding interview seeds the vault with who you are and how you work. After that, just talk. Or say `help`.

### From source

Working on rubber-ducky itself? Clone the repo and load it as a local plugin:

```
git clone https://github.com/brandtam/rubber-ducky.git
claude --plugin-dir rubber-ducky
```

## Integrations

Wired on demand, never pre-baked. `/connect` offers four ways to bridge a service — official CLI (`gh`), generated, MCP server, or a script you already have — and writes a one-page **bridge doc** mapping it onto your schema. Every integration skill (`/ingest`, `/backend-write`, `/new-ticket`, `/reconcile`) reads that doc, so there's no service-specific code anywhere. External writes are gated: a hook previews or holds any registered write until your policy says go.

## Obsidian & native memory (optional)

Use Obsidian and the vault scaffolds **Bases** dashboards off your frontmatter, and pairs with the official Obsidian skills. It can also point Claude Code's native memory at your vault. All opt-in — uninstall Obsidian and every verb still works.

## Background

The name comes from [rubber duck debugging](https://en.wikipedia.org/wiki/Rubber_duck_debugging) — talking a problem through out loud until the answer surfaces. rubber-ducky implements Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: a vault as persistent context the AI maintains across sessions.

## Acknowledgments

A direct implementation of the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern from [Andrej Karpathy](https://github.com/karpathy) — the LLM maintains the wiki while you curate the sources and ask the questions.

## License

MIT
