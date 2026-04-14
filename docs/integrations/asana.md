[← Docs index](../README.md)

# Asana

Rubber-Ducky's Asana backend ingests tasks into your wiki, pushes local tasks back to Asana, and syncs comments and status. It uses the Asana REST API directly — no MCP server required.

**Capabilities:** ingest, pull, push, comment.

## Authentication

Asana auth uses a Personal Access Token (PAT).

### Create a token

1. Sign in to [Asana Developer Console](https://app.asana.com/0/my-apps).
2. Under **Personal access tokens**, click **Create new token**.
3. Give it a recognizable name (e.g., "rubber-ducky").
4. Copy the token immediately — Asana only shows it once.

### Store it

Save the token in your workspace's `.env.local`:

```bash
# .env.local (at workspace root)
ASANA_ACCESS_TOKEN=your-token-here
```

Rubber-Ducky reads `.env.local` automatically from the workspace root when you run any CLI command. Never commit this file — it's already in `.gitignore` on new workspaces.

> **Don't use your shell profile.** Keep tokens scoped to the workspace so they don't leak across projects or stay on your machine after you stop using a vault.

## Configuration

Asana configuration lives in `workspace.md` frontmatter under `backends:`.

```yaml
backends:
  - type: asana
    workspace_id: "1234567890123"      # Asana workspace GID
    project_gid: "9876543210987"       # Default project for ingest
    identifier_field: TIK              # Custom field name (optional)
    naming_source: identifier          # identifier | title | gid
    naming_case: preserve              # preserve | lower
```

| Field | Required | What it does |
|---|---|---|
| `workspace_id` | yes | Asana workspace GID. Used to resolve custom ID refs (e.g. `TIK-4647`) via workspace-scoped lookup. |
| `project_gid` | yes | Default project GID used by `rubber-ducky ingest asana` (no args) and by `/ingest-asana` (no args). |
| `identifier_field` | optional | Name of the Asana custom field whose value is the canonical identifier for each task (e.g., `TIK`, `ECOMM`). Used when `naming_source: identifier`. |
| `naming_source` | optional | Which value drives the task page filename: `identifier` (custom field), `title` (slugified name), or `gid` (raw Asana GID). |
| `naming_case` | optional | Casing policy when `naming_source: identifier`: `preserve` (keeps `TIK-4647`) or `lower` (lowercases to `tik-4647`). |

Most users set this up via the init wizard or the dedicated configure-naming flow — you rarely need to edit `workspace.md` by hand.

### Naming configuration

When you first ingest from Asana, Rubber-Ducky walks you through an interactive picker so task filenames match your expectations before any files get created. It shows your custom fields (ID-type fields sorted first), plus "Task title" and "Asana GID" as alternatives, and previews real filenames from your actual project before confirming.

To re-run the picker later:

```bash
rubber-ducky asana configure-naming
```

The prompt also fires automatically the first time you ingest in a workspace that has no `naming_source` set.

## Ingest

The `ingest asana` command pulls Asana tasks into your wiki with full data — description, comments, attachments, status, assignee, tags. Attachments download to `raw/assets/`. The wiki index and log update automatically.

Ingest is **idempotent**: tasks that already exist in your wiki are skipped by default.

### From the CLI

```bash
# Single task by GID
rubber-ducky ingest asana 1234567890

# Single task by custom ID (requires identifier_field + workspace_id)
rubber-ducky ingest asana TIK-4647

# Single task by Asana URL
rubber-ducky ingest asana https://app.asana.com/0/123/456

# All tasks from a specific project
rubber-ducky ingest asana project:<project-gid>

# All tasks from a section
rubber-ducky ingest asana section:<section-gid>

# All tasks from the default project (requires project_gid)
rubber-ducky ingest asana

# Only tasks assigned to you
rubber-ducky ingest asana --mine

# All tasks, regardless of assignee
rubber-ducky ingest asana --all
```

Ingest defaults to your tasks only (`--mine`). Pass `--all` for everything, or set `ingest_scope: all` in `workspace.md` to change the default.

### From Claude Code

You don't need to memorize the slash-commands — just tell Claude Code what you want in plain English:

- *"Ingest TIK-4647 from Asana"*
- *"Pull in Asana task 1234567890"*
- *"Ingest everything in Asana project 9876543210987"*
- *"Do a full Asana ingest"* (pulls the default project)
- *"Pull in all my Asana tasks"* (applies `--mine`)

Claude Code maps these to the `/ingest-asana` skill, which invokes the CLI and layers vocabulary-aware tagging on top. You can invoke the skill directly as shorthand:

```
/ingest-asana 1234567890
/ingest-asana TIK-4647
/ingest-asana project:9876543210987
```

## Write-back

Every external write — `push`, `comment`, `transition` — goes through a safety layer that previews the action, requires explicit confirmation, and logs it to `wiki/log.md` as an audit trail.

| Operation | Skill | What it does |
|---|---|---|
| Push | `/push` | Create an Asana task from a local wiki task page. Fills title, description, assignee, tags. |
| Comment | `/comment` | Add a comment to an existing Asana task from the wiki. |
| Transition | `/transition` | Sync a task's status between wiki and Asana (open/closed). |
| Pull | `/pull-active` | Refresh active wiki tasks from their Asana sources. |
| Reconcile | `/reconcile` | Surface status drift and new comments between wiki and Asana. |

## Troubleshooting

**"ASANA_ACCESS_TOKEN is not set"** — Create `.env.local` in your workspace root with `ASANA_ACCESS_TOKEN=...`. No shell restart needed; rubber-ducky reads the file on every command.

**Custom ID lookup fails** — Custom ID resolution (`TIK-4647`) requires both `workspace_id` and `identifier_field` set in `workspace.md`. Run `rubber-ducky asana configure-naming` to re-pick your identifier field if unsure.

**Filenames look wrong** — Check `naming_source` and `naming_case` in `workspace.md`. Re-run `rubber-ducky asana configure-naming` to preview and confirm a new scheme. Existing files aren't renamed; only new ingests use the new scheme.

**Empty custom field on a task** — If a task's identifier field is empty, the filename falls back to the Asana GID so the ingest doesn't crash or create a `.md`-only file.

**Zero custom fields in the project** — The source picker still offers "Task title" and "Asana GID" as fallbacks. You won't dead-end.

**Connectivity check** — `rubber-ducky backend check` verifies the token, workspace access, and default project reachability.

## See also

- [Jira integration](./jira.md) and [GitHub integration](./github.md)
- [CLI reference](../cli-reference.md) for every `rubber-ducky` command and flag
- [Skills reference](../skills-reference.md) for every `/` skill
