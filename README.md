# Rubber-Ducky

> A typed, queryable, Obsidian-native memory layer for Claude, with bidirectional sync to your work tools.

Rubber-Ducky turns an Obsidian vault into a persistent workspace that [Claude Code](https://claude.ai/claude-code) maintains across sessions. Talk to Claude throughout the day — about what you're working on, what you should work on next, what you finished yesterday — and it keeps your structured work log in sync behind the scenes.

Three architectural commitments make this work:

- **Structured frontmatter as a contract.** Every page has a known schema. Claude reads pages as typed data, not fuzzy text — so it can answer *"show me everything in-progress that's due this week"* as a deterministic query instead of a hopeful search.
- **Obsidian-native conventions.** Wikilinks, daily pages, controlled vocabulary, graph view. You don't learn Rubber-Ducky — you use Obsidian, and Rubber-Ducky respects how Obsidian already works.
- **CLI as Claude's contract.** A testable, deterministic command surface between Claude Code and the filesystem. Mechanical operations (create a page, update status, log an entry) take 50–200ms and cost zero tokens. Claude does the thinking; the CLI does the bookkeeping.

See [Architecture](./docs/architecture.md) for why these three pillars and what each buys you.

## Who is this for?

Engineers, researchers, and knowledge workers who already spend real time with an AI assistant and want that assistant to have a persistent, structured memory of their work — one that survives across sessions, integrates with the tools they already use (Jira, Asana, GitHub), and stays readable as plain markdown in Obsidian.

If you want Claude to remember what you told it yesterday, know what's on your plate today, and keep the thread across a dozen context switches — this is for you. If you just want a nicer notes app, it's probably overkill.

## Quickstart

Prerequisites: [Node.js 18+](https://nodejs.org/), [Obsidian](https://obsidian.md/), and [Claude Code](https://claude.ai/claude-code) authenticated.

```bash
git clone https://github.com/brandtam/rubber-ducky.git
cd rubber-ducky
npm install
npm run build
npm link                          # makes `rubber-ducky` available globally

rubber-ducky init my-work-log     # interactive wizard: name, purpose, backends
```

Open `my-work-log/` in Obsidian as a vault, then:

```bash
cd my-work-log
claude                            # start Claude Code in your workspace
```

Inside Claude Code:

```
/get-setup      # if you configured backends — finishes tokens, naming, connectivity
good morning    # creates today's daily page and gives you a prioritized brief
```

Talk to Claude about your work throughout the day; it handles the bookkeeping.

For the full walkthrough (including migrating an existing Obsidian vault) see [Getting started](./docs/getting-started.md).

## Documentation

- **[Getting started](./docs/getting-started.md)** — fresh installs, existing-vault migrations, first-day walkthrough.
- **Integrations** — [Asana](./docs/integrations/asana.md) · [Jira](./docs/integrations/jira.md) · [GitHub](./docs/integrations/github.md).
- **[CLI reference](./docs/cli-reference.md)** — every `rubber-ducky` command with examples.
- **[Skills reference](./docs/skills-reference.md)** — every Claude Code skill grouped by workflow.
- **[Architecture](./docs/architecture.md)** — the three-layer model, why REST over MCP, the CLI-vs-Claude split.
- **[Contributing](./docs/contributing.md)** — add a backend, write a skill, testing conventions.

## Background

The name comes from [rubber duck debugging](https://en.wikipedia.org/wiki/Rubber_duck_debugging). The project started after a shoulder surgery forced me off the keyboard — I was coding entirely through speech-to-text with Claude Code, narrating my work like talking to a rubber duck that actually talked back. It worked, but the context evaporated at the end of every session. That's when I discovered what Andrej Karpathy calls the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern — using Obsidian as a persistent workspace that the AI maintains across sessions.

I had such a good experience with the pattern that I decided to build a tool around it: CLI commands handle the mechanical work (creating pages, updating frontmatter, rebuilding indexes) at zero token cost, while Claude Code skills handle the intelligent work (morning briefs, end-of-day summaries, PRD authoring) using the workspace as context.

## Acknowledgments

Rubber-Ducky is a direct implementation of the [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern described by [Andrej Karpathy](https://github.com/karpathy). The core insight — that LLMs should maintain the wiki while humans curate sources and ask questions — shapes every design decision in this project.

Several of the Claude Code skills in this project were inspired by and adapted from [Matt Pocock's skills collection](https://github.com/mattpocock/skills) — a curated set of reusable agent commands for planning, development, and knowledge work. If you're building your own Claude Code workflows, his repo is a great place to start.

## License

MIT
