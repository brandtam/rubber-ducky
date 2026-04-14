[← Docs index](../README.md)

# Jira

Rubber-Ducky's Jira backend ingests issues into your wiki, pushes local tasks back to Jira, and syncs comments, status, and transitions. It uses the Jira REST API directly — no MCP server required.

**Capabilities:** ingest, pull, push, comment, transition.

## Authentication

Jira uses Basic Auth with an account email plus an API token.

### Create an API token

1. Sign in to [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token**.
3. Give it a recognizable label (e.g., "rubber-ducky").
4. Copy the token — Atlassian only shows it once.

### Store credentials

Save everything in your workspace's `.env.local`:

```bash
# .env.local (at workspace root)
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-token-here
JIRA_SERVER_URL=https://myorg.atlassian.net    # optional — overrides workspace.md
```

Rubber-Ducky reads `.env.local` automatically from the workspace root. Never commit this file.

> **Don't use your shell profile.** Keep credentials scoped to the workspace.

## Configuration

Jira configuration lives in `workspace.md` frontmatter under `backends:`.

```yaml
backends:
  - type: jira
    server_url: https://myorg.atlassian.net
    project_key: ECOMM
```

| Field | Required | What it does |
|---|---|---|
| `server_url` | yes | Your Jira Cloud or Server URL. Can be overridden by `JIRA_SERVER_URL` env var. |
| `project_key` | yes | Default project key used by `rubber-ducky ingest jira` (no args) and by `/ingest-jira` (no args). |

If `ASANA_ACCESS_TOKEN` and `JIRA_EMAIL`/`JIRA_API_TOKEN` are set during `init`, the wizard auto-discovers your projects so you don't have to hunt for keys manually.

## Ingest

The `ingest jira` command pulls Jira issues into your wiki with full data — description, comments, attachments, status, assignee, tags. Attachments download to `raw/assets/`. The wiki index and log update automatically.

Ingest is **idempotent**: issues that already exist in your wiki are skipped by default.

### From the CLI

```bash
# Single issue by key
rubber-ducky ingest jira ECOMM-4643

# All issues from a project
rubber-ducky ingest jira project:ECOMM

# All issues from the default project (requires project_key)
rubber-ducky ingest jira

# Only issues assigned to you
rubber-ducky ingest jira --mine

# All issues, regardless of assignee
rubber-ducky ingest jira --all
```

Ingest defaults to your issues only (`--mine`). Pass `--all` for everything, or set `ingest_scope: all` in `workspace.md` to change the default.

### From Claude Code

You don't need to memorize the slash-commands — just tell Claude Code what you want in plain English:

- *"Ingest ECOMM-4643 from Jira"*
- *"Pull in Jira issue WEB-288"*
- *"Ingest everything in the ECOMM project"*
- *"Do a full Jira ingest"* (pulls the default project)
- *"Pull in all my Jira issues"* (applies `--mine`)

Claude Code maps these to the `/ingest-jira` skill, which invokes the CLI and layers vocabulary-aware tagging on top. You can invoke the skill directly as shorthand:

```
/ingest-jira ECOMM-4643
/ingest-jira project:ECOMM
```

## Write-back

Every external write — `push`, `comment`, `transition` — goes through a safety layer that previews the action, requires explicit confirmation, and logs it to `wiki/log.md`.

| Operation | Skill | What it does |
|---|---|---|
| Push | `/push` | Create a Jira issue from a local wiki task page. |
| Comment | `/comment` | Add a comment to an existing Jira issue from the wiki. |
| Transition | `/transition` | Move a Jira issue through its workflow (to-do → in-progress → done, etc.). |
| Pull | `/pull-active` | Refresh active wiki tasks from their Jira sources. |
| Reconcile | `/reconcile` | Surface status drift and new comments between wiki and Jira. |

Jira's transition workflow is project-specific. Rubber-Ducky fetches valid transitions from the Jira API before asking you to confirm, so you can't accidentally pick an invalid target status.

## Troubleshooting

**"JIRA_EMAIL is not set" or "JIRA_API_TOKEN is not set"** — Create `.env.local` in your workspace root with both values. No shell restart needed.

**"server_url is not configured"** — Either set `server_url` in `workspace.md` under the Jira backend entry or export `JIRA_SERVER_URL` in `.env.local`. The URL must include the scheme (`https://`) and no trailing slash.

**401 Unauthorized** — Usually means the API token was revoked or the email is wrong. Regenerate the token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) and update `.env.local`.

**Transition fails with "no such transition"** — The target status isn't reachable from the current status in your Jira workflow. Check the valid transitions in Jira or use `/transition` which fetches them dynamically.

**Connectivity check** — `rubber-ducky backend check` verifies auth, server URL, and project accessibility.

## See also

- [Asana integration](./asana.md) and [GitHub integration](./github.md)
- [CLI reference](../cli-reference.md) for every `rubber-ducky` command and flag
- [Skills reference](../skills-reference.md) for every `/` skill
