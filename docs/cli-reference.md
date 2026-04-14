[← Docs index](./README.md)

# CLI reference

Every `rubber-ducky` command, grouped by purpose. All commands run from inside a workspace directory (or a subdirectory of one) — the CLI finds the workspace root by walking upward looking for `workspace.md`.

**Global flags:**

- `-v, --version` — print the installed version.
- `--json` — emit structured JSON instead of human-readable output. Useful for scripting.

> **You'll rarely type these yourself.** Claude Code calls the CLI behind the scenes whenever you describe something mechanical — *"log that I finished X"*, *"start this task"*, *"ingest that Asana ticket"*. The CLI is documented here for scripting, debugging, and the occasional moment when you want the operation to be exact and instantaneous.

---

## Workspace management

### `init [directory]`

Create a new workspace (or adopt an existing one) via an interactive wizard.

```bash
rubber-ducky init my-work-log           # create a new directory
rubber-ducky init ~/path/to/my-vault    # adopt an existing vault
rubber-ducky init                       # use the current directory
```

The wizard walks through name, purpose, backends, and controlled vocabulary. See [getting started](./getting-started.md) for the full flow.

### `status`

Show workspace info — name, location, configured backends, counts of daily/task/project pages.

```bash
rubber-ducky status
rubber-ducky status --json
```

### `update`

Update bundled skills and agents to the latest versions shipped with the installed CLI. Diffs every file and lets you choose keep / overwrite / skip per-file.

```bash
rubber-ducky update
```

### `doctor`

Run workspace health checks — structure, config validity, backend connectivity.

```bash
rubber-ducky doctor
```

### `doctor lint`

Lint wiki pages for issues:

- **Stale tasks** — no updates in 7+ days.
- **Orphan pages** — not linked from any other page.
- **Broken wikilinks** — `[[targets]]` that don't exist.
- **Frontmatter schema violations** — missing required fields, invalid status values.
- **Vocabulary drift** — terms not in `UBIQUITOUS_LANGUAGE.md`.

```bash
rubber-ducky doctor lint
rubber-ducky doctor lint --json
```

---

## Pages and frontmatter

### `page create <type> [args]`

Create a daily, task, or project page.

```bash
rubber-ducky page create daily                     # today's daily page
rubber-ducky page create task "Fix auth timeout"   # new task
rubber-ducky page create project "API v2"          # new project
```

Daily pages are idempotent — if today's page exists, the command is a no-op and reports it exists.

### `frontmatter get <file> <field>`

Read a single frontmatter field from a page.

```bash
rubber-ducky frontmatter get wiki/tasks/fix-auth.md status
# in-progress
```

### `frontmatter set <file> <field> <value>`

Write a frontmatter field (creates or updates).

```bash
rubber-ducky frontmatter set wiki/tasks/fix-auth.md priority high
rubber-ducky frontmatter set wiki/daily/2026-04-14.md active_task fix-auth
```

### `frontmatter validate <file>`

Validate a page's frontmatter against the schema.

```bash
rubber-ducky frontmatter validate wiki/tasks/fix-auth.md
```

---

## Tasks

### `task start <file>`

Atomic transition to in-progress: updates task frontmatter, logs to today's daily page, appends to the activity log.

```bash
rubber-ducky task start wiki/tasks/fix-auth.md
```

### `task close <file>`

Atomic close: sets `status: done`, stamps `closed` timestamp, logs completion.

```bash
rubber-ducky task close wiki/tasks/fix-auth.md
```

---

## Capture

Quick-capture commands for common inputs during the day.

### `asap add | list | resolve`

Urgent items that need to be surfaced in tomorrow's morning brief.

```bash
rubber-ducky asap add "Client reported 500 on checkout"
rubber-ducky asap list
rubber-ducky asap resolve <id>
```

### `remind add | list | resolve`

Date-keyed reminders that surface on their due date.

```bash
rubber-ducky remind add "2026-04-18" "Follow up on deployment"
rubber-ducky remind list
```

### `idea add | list`

Someday/maybe capture.

```bash
rubber-ducky idea add "Add rate limiting to API v2"
rubber-ducky idea list
```

### `screenshot ingest <path> <title>`

Import a screenshot into `raw/assets/` and scaffold a linked task page.

```bash
rubber-ducky screenshot ingest ~/Desktop/bug.png "Checkout 500 error"
```

### `log append <message>`

Add a timestamped entry to `wiki/log.md`.

```bash
rubber-ducky log append "Traced timeout to missing refresh token rotation"
```

---

## Wiki

### `wiki search <query>`

Search across all wiki pages.

```bash
rubber-ducky wiki search "refresh token"
rubber-ducky wiki search "refresh token" --json
```

### `index rebuild`

Regenerate `wiki/index.md` from the current state of all pages.

```bash
rubber-ducky index rebuild
```

Run this after manually moving files into `wiki/tasks/`, `wiki/daily/`, or `wiki/projects/`.

---

## Backends

### `backend list`

Show configured backends with their type and key fields.

```bash
rubber-ducky backend list
```

### `backend check`

Verify connectivity for each configured backend — token, server URL, default project reachability.

```bash
rubber-ducky backend check
```

### `ingest asana [ref]`

Ingest Asana tasks. See [Asana integration](./integrations/asana.md) for full detail.

```bash
rubber-ducky ingest asana                      # default project (requires --all or --mine)
rubber-ducky ingest asana 1234567890           # single task by GID
rubber-ducky ingest asana TIK-4647             # single task by custom ID
rubber-ducky ingest asana project:<gid>        # bulk from a project
rubber-ducky ingest asana section:<gid>        # bulk from a section
rubber-ducky ingest asana --mine               # only tasks assigned to you
rubber-ducky ingest asana --all                # all tasks
```

### `ingest jira [ref]`

Ingest Jira issues. See [Jira integration](./integrations/jira.md) for full detail.

```bash
rubber-ducky ingest jira                       # default project
rubber-ducky ingest jira ECOMM-4643            # single issue
rubber-ducky ingest jira project:ECOMM         # bulk from a project
rubber-ducky ingest jira --mine                # only issues assigned to you
rubber-ducky ingest jira --all                 # all issues
```

### `ingest github [ref]`

Ingest GitHub issues and PRs. See [GitHub integration](./integrations/github.md) for full detail.

```bash
rubber-ducky ingest github 42                           # single item by number
rubber-ducky ingest github repo:myorg/project-a         # bulk from a repo
rubber-ducky ingest github label:myorg/project-a:bug    # filter by label
rubber-ducky ingest github --mine                       # only items assigned to you
rubber-ducky ingest github --all                        # all items
```

---

## Asana-specific

### `asana configure-naming`

Re-run the interactive naming picker to change how Asana task files are named (source, casing). Shows live previews of real filenames before confirming.

```bash
rubber-ducky asana configure-naming
```

See [Asana integration → Naming configuration](./integrations/asana.md#naming-configuration) for detail.

---

## Exit codes

- `0` — success.
- `1` — command failed (details on stderr).
- `2` — invalid arguments or usage error.

`--json` mode always emits valid JSON even on error (the error is in the structure), so you can script against it reliably.

## See also

- [Skills reference](./skills-reference.md) — the `/` skills that invoke these commands from Claude Code.
- [Architecture](./architecture.md) — why the CLI exists and how it fits with Claude Code.
