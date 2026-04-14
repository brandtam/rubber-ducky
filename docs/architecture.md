[← Docs index](./README.md)

# Architecture

Rubber-Ducky is a typed, queryable, Obsidian-native memory layer for Claude, with bidirectional sync to your work tools. This page explains what that means in practice and why the pieces are shaped the way they are.

If you're looking for how to *use* any of this, see [getting started](./getting-started.md). If you want to extend it — add a backend, write a skill — see [contributing](./contributing.md). What follows is the "why."

## The shape of the project

Three architectural commitments do most of the work:

1. **Structured frontmatter as a contract.** Every wiki page has a known schema. Claude reads pages as typed data, not fuzzy text.
2. **Obsidian-native conventions.** Wikilinks for graph and backlinks, daily pages as the temporal spine, dataview-ready frontmatter. Users don't learn Rubber-Ducky — they use Obsidian, and Rubber-Ducky respects how Obsidian already works.
3. **CLI as Claude's contract.** A testable, deterministic command surface sits between Claude Code and the filesystem. Claude calls the CLI; the CLI does the mechanical work. Backends talk REST, not MCP.

Each commitment corresponds to a class of pain we're deliberately avoiding, and each shapes what contributions should look like. The rest of this page walks through them.

## Three layers: raw → wiki → schema

Rubber-Ducky is a direct implementation of [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The architecture follows the three-layer model:

- **Raw sources** live in `raw/` and never change. Ingested tickets, screenshots, attachments — anything we pulled from somewhere else. This is the immutable bottom of the stack.
- **Wiki** lives in `wiki/` and is LLM-maintained markdown. Daily pages, task pages, project pages — the active surface Claude reads and writes all day. This is what you interact with in Obsidian.
- **Schema** lives in `workspace.md`, `CLAUDE.md`, `UBIQUITOUS_LANGUAGE.md`, and `references/`. These are the contracts that tell both humans and Claude how the wiki is supposed to look — frontmatter shapes, valid statuses, controlled vocabulary, ticket formats.

Three operations move data through the layers:

- **Ingest** — pull from external backends (Asana, Jira, GitHub) into `raw/`, then generate a wiki page from the raw data using the schema.
- **Query** — read across the wiki, answering questions with citations. The `work-historian` agent does this.
- **Lint** — check the wiki for contradictions, stale claims, broken links, orphaned pages, and schema violations. The `linter` agent does this.

The clean separation means the wiki is always a function of (raw + schema + LLM decisions). If the wiki gets corrupted, you can rebuild from raw. If the schema changes, you can re-lint to find drift.

## Pillar 1: Structured frontmatter as a contract

Every page has typed YAML frontmatter with a known shape:

- **Daily pages** carry `active_task`, `tasks_touched`, `morning_brief`, `wrap_up`, and timestamps.
- **Task pages** carry `status`, `priority`, `due`, `assignee`, `tags`, backend refs (`gh_ref`, `jira_ref`, `asana_ref`), and lifecycle timestamps.
- **Project pages** carry `status`, `tags`, and timestamps.

The schema is enforced by the CLI (`rubber-ducky frontmatter validate`) and by the linter. It's documented in the per-workspace `references/frontmatter-templates.md` that Claude Code loads on demand.

**Why this matters.** Without structured frontmatter, an Obsidian vault is a pile of text, and Claude becomes a hopeful searcher — asking "do any of my pages mention refresh tokens?" and grepping through noise. With it, Claude can answer "show me all in-progress tasks with a due date this week" as a structured query, deterministically, without reading page bodies. The frontmatter turns the wiki into something closer to a typed database with markdown content.

It also makes Dataview plugins trivially useful — you get dashboards for free as soon as the schema is consistent.

## Pillar 2: Obsidian-native conventions

Rubber-Ducky doesn't invent a new interface. It uses Obsidian's native primitives and makes them first-class:

- **Wikilinks (`[[target]]`)** for cross-page references. Obsidian resolves these into clickable navigation, backlinks, and graph edges.
- **Daily pages** as the temporal spine. Every interaction that has a "when" lands on today's page.
- **Controlled vocabulary** in `UBIQUITOUS_LANGUAGE.md`. Brands, teams, and labels defined here become the canonical tags across the wiki. The linter flags drift.
- **Local files on disk.** No sync service, no vendor lock-in, no API rate limits. Git handles versioning.

The payoff: users don't learn Rubber-Ducky — they use Obsidian and Rubber-Ducky keeps their vault coherent. A new user who already knows Obsidian is productive on day one.

## Pillar 3: CLI as Claude's contract

Claude Code could, in principle, do everything Rubber-Ducky's CLI does. Read the file, reason about the YAML, write it back. That works — but it's slow, lossy, and expensive at scale.

The CLI exists because of four compounding problems that show up when Claude does mechanical work directly:

**Speed.** A CLI command finishes in 50–200ms. Claude Code reading a file, reasoning about the YAML, and writing it back takes 3–10 seconds with multiple round-trips. When you say "log this" or "start this task" ten times a day, the CLI makes the tool feel instant instead of sluggish.

**Reliability.** `rubber-ducky frontmatter set` produces valid YAML every single time. Claude Code *almost always* will — but "almost always" across hundreds of operations per week means occasional malformed frontmatter, a forgotten field, or a status value with a typo. The CLI follows the schema deterministically.

**Atomicity.** `rubber-ducky task start` does three things in one shot: updates the task frontmatter, logs to the daily page, and appends to the activity log. If Claude Code did those as three separate tool calls and failed on the second, your workspace would be in an inconsistent state.

**Context window efficiency.** This is the biggest win. Every file Claude Code reads occupies context space for the rest of the conversation. In a long session — which is the point of staying in Claude Code all day — that compounds. The CLI keeps the context clean. Instead of reading a 100-line task page to flip one field, Claude runs a one-liner and gets back `{"success": true}`. Context stays available for the intelligent work that actually needs it.

### The split rule

The decision boundary between "do this via CLI" and "leave this to Claude Code" follows a simple pattern:

| Good fit for CLI | Stays in Claude Code |
|---|---|
| High-frequency (many times/day) | Low-frequency (once a week, once ever) |
| Deterministic (same input → same output) | Context-dependent (needs understanding) |
| Schema-bound (frontmatter, statuses) | Creative (synthesis, summarization) |
| Composable (chains into larger operations) | Conversational (back-and-forth with user) |

Page creation, task transitions, frontmatter updates, index rebuilds, health checks — all CLI. Morning briefs, end-of-day summaries, PRD authoring, integration research — all Claude Code. Each tool does what it's best at.

### Why REST instead of MCP

Asana and Jira both have Model Context Protocol (MCP) servers available. We chose direct REST instead. The tradeoffs:

- **Debuggability.** A REST call has a URL, headers, a body, and a status code. If something's wrong, you `curl` it and see. MCP adds a protocol layer you can't inspect the same way — when an MCP call returns an odd result, you're debugging the server, the transport, and the API at once.
- **Determinism.** REST clients in code are trivial to test with a `fetch` injector. MCP tool calls are harder to stub deterministically in unit tests.
- **No external process.** Every MCP dependency is a server you have to run and keep alive. REST is just HTTP.
- **Coverage.** MCP servers tend to cover the common cases well and the uncommon cases poorly. Talking REST directly means you can reach anything the API exposes without waiting for the MCP server to support it.

GitHub is the exception — it uses the `gh` CLI as a subprocess rather than talking to the REST API directly. That choice predates the Asana/Jira rewrites and leverages `gh`'s own auth handling and caching. New backends should default to direct REST.

## The Backend interface

Every external system — Asana, Jira, GitHub, and whatever comes next — implements the same `Backend` interface from `src/lib/backend.ts`:

```ts
interface Backend {
  name: string;
  capabilities: Capability[];
  ingest(ref: string): Promise<TaskPage>;
  pull(taskPage: TaskPage): Promise<PullResult>;
  push(taskPage: TaskPage): Promise<PushResult>;
  comment(taskPage: TaskPage, text: string): Promise<CommentResult>;
  transition(taskPage: TaskPage, status: Status): Promise<TransitionResult>;
}
```

Backends declare their `capabilities` honestly — if a backend can't `transition`, it says so, and `assertCapability()` throws a clear error rather than silently no-oping. Callers (skills, CLI commands) never branch on backend type — they call the interface and let each backend handle its specifics.

This matters at two moments:

1. **Adding a new backend.** You implement the interface once, and every skill that already uses a backend (push, comment, transition, reconcile, pull-active) works for your new system without modification.
2. **Reasoning about feature parity.** The capability list tells you at a glance what each backend can do. Feature gaps are explicit, not lurking.

## The shared ingest layer

Ingest is where most of the surface area lives — it's how external data gets into the typed wiki — so the plumbing is factored into `src/lib/ingest-shared.ts` rather than reimplemented per backend. The shared layer provides:

- **Dedup.** Tasks already in the wiki are skipped so bulk re-ingests are idempotent and safe to re-run.
- **Page generation.** Consistent frontmatter shape across every backend — a Jira issue and an Asana task produce pages that look the same structurally, even though the source data is wildly different.
- **Concurrency.** Bounded parallelism for bulk ingests so we don't melt rate limits or drown the filesystem.
- **Attachment handling.** Files download to `raw/assets/` so Claude can later inspect them when reading the task page.

A new backend's `-ingest.ts` module (e.g., `asana-ingest.ts`) is mostly the per-backend glue: authenticate, fetch the source data, map fields into the shared `TaskPage` shape. The shared layer does everything else.

## How a contribution lands

This mental model informs most contribution decisions:

- **Adding a field to frontmatter?** Update the schema in `references/frontmatter-templates.md`, update the TypeScript type, update `frontmatter validate`, update the linter. The contract is load-bearing — don't make it a best-effort convention.
- **Adding a mechanical operation?** It's a CLI command. Make it atomic, give it a `--json` output, and wire a skill if Claude needs to call it.
- **Adding an intelligent workflow?** It's a skill. Write it as a markdown file under `.claude/commands/` with `Behavior` and `Output` sections. Reach for an agent only if the work benefits from a restricted tool surface.
- **Adding a backend?** Implement the `Backend` interface, route through `ingest-shared`, talk REST, and ship a per-backend skill via `generateBackendSkills()`. See [contributing](./contributing.md) for the walkthrough.

## Where to go next

- [Contributing](./contributing.md) — turn this architecture into code.
- [CLI reference](./cli-reference.md) — every command that sits at the CLI-Claude boundary.
- [Skills reference](./skills-reference.md) — every skill Claude Code uses to talk to the CLI.
