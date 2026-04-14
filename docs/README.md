# Rubber-Ducky docs

Reference material for users and contributors. For the project pitch and quickstart, see the [main README](../README.md).

## Where do I start?

- **New to rubber-ducky?** Read [Getting started](./getting-started.md) for install, first workspace, and first day.
- **Setting up a backend?** Jump straight to [Asana](./integrations/asana.md), [Jira](./integrations/jira.md), or [GitHub](./integrations/github.md).
- **Looking up a CLI flag?** The [CLI reference](./cli-reference.md) has every command with examples.
- **Exploring Claude Code skills?** The [skills reference](./skills-reference.md) groups them by workflow.
- **Curious how the pieces fit together?** [Architecture](./architecture.md) covers the design decisions.
- **Want to contribute?** [Contributing](./contributing.md) walks through adding a backend or writing a skill.

## Table of contents

### Setup

- [Getting started](./getting-started.md) — install, create or migrate a workspace, and run your first day
- [Contributing](./contributing.md) — add a backend, write a skill, testing conventions

### Integrations

- [Asana](./integrations/asana.md) — auth, configuration, ingest, write-back, troubleshooting
- [Jira](./integrations/jira.md) — auth, configuration, ingest, write-back, troubleshooting
- [GitHub](./integrations/github.md) — auth, configuration, ingest, write-back, troubleshooting

### Reference

- [CLI reference](./cli-reference.md) — every `rubber-ducky` command with flags and examples
- [Skills reference](./skills-reference.md) — every Claude Code skill grouped by workflow

### Background

- [Architecture](./architecture.md) — why REST over MCP, the shared ingest layer, the three-layer model, the CLI-vs-Claude split
