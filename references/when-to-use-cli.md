# When to Use CLI vs. Claude Code

Reference this file with `@references/when-to-use-cli.md` when making architectural decisions about where new functionality should live.

## The rule

**High-frequency, deterministic, schema-bound work → CLI command.**
**Low-frequency, context-dependent, creative work → Claude Code skill or direct conversation.**

## Why

The CLI exists for four reasons, in order of importance:

1. **Speed** — CLI commands finish in 50-200ms. Claude Code reading, reasoning, and writing takes 3-10 seconds per operation. For things that happen many times a day, the user feels the difference.
2. **Reliability** — CLI commands are deterministic. Same input, same output, every time. Claude Code is almost-always correct, but "almost always" across hundreds of operations per week means occasional mistakes.
3. **Atomicity** — CLI commands that do multiple things (like `task start` updating frontmatter + daily page + log) do them in one shot. Multiple Claude Code tool calls can fail partway through.
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
| `page create` | Fixed template, schema-bound frontmatter |
| `task start` / `task close` | Deterministic state transition + multi-file atomic update |
| `frontmatter get` / `set` / `validate` | Pure YAML manipulation, no judgment needed |
| `asap` / `remind` / `idea` | Append to file, parse structured format |
| `index rebuild` | Scan all files, generate grouped table — mechanical |
| `log append` | Timestamp + append to file |
| `wiki search` | Text search across files, return matches |
| `doctor` / `doctor lint` | Check-based validation against known rules |
| `backend check` | Connectivity test, returns pass/fail |
| `screenshot ingest` | Copy file + create page — mechanical |
| `update` | Diff template files, apply changes |
| `status` | Read config, report values |

### Claude Code skills (intelligent)

| Skill | Why Claude Code |
|-------|----------------|
| `/good-morning` | Synthesizes priorities from multiple sources, makes judgment calls about focus |
| `/wrap-up` | Summarizes a day's work, identifies patterns, suggests tomorrow's focus |
| `/write-a-prd` | Creative — interviews user, explores codebase, designs architecture |
| `/prd-to-issues` | Judgment — decides how to slice work, what dependencies exist |
| `/verify-prd` | Analysis — cross-references branches, code, and issues |
| `/commit` | Reads diff, synthesizes intent into a message |
| `/write-pr` | Reads full branch diff, writes narrative description |
| `/add-integration` | Research — evaluates MCP servers, APIs, capabilities |

### Hybrid pattern (skill calls CLI)

Most skills are hybrid. `/good-morning` calls `rubber-ducky page create daily` (CLI) to ensure the daily page exists, then reads task pages and synthesizes a brief (AI). The skill orchestrates; the CLI does the mechanical parts.

## When adding new features

Ask these questions:

1. **Could a bash script do this?** If yes, it's a CLI command.
2. **Does it need to read content and make decisions?** If yes, it's a Claude Code skill (that may call CLI commands for the mechanical parts).
3. **Is it a new operation on an existing page type?** Probably CLI — add a subcommand.
4. **Is it a new workflow that combines multiple operations?** Probably a skill — it orchestrates CLI commands + AI synthesis.
5. **Is it something the user will want to customize or override?** Skill — the user can edit the `.claude/commands/` file.

## The cli_mode toggle

`workspace.md` frontmatter includes `cli_mode: true`. When set to `false`, Claude Code performs all operations directly (reading/writing files, managing frontmatter by hand) instead of calling the `rubber-ducky` CLI. This is useful for:

- A/B testing whether the CLI actually helps
- Debugging when you suspect the CLI is causing an issue
- Working in environments where the CLI isn't installed
