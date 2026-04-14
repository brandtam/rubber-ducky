[← Docs index](../README.md)

# GitHub

Rubber-Ducky's GitHub backend ingests issues and pull requests into your wiki, pushes local tasks back to GitHub, and syncs comments. It uses the `gh` CLI as the transport — no API tokens to manage beyond what `gh` already handles.

**Capabilities:** ingest, push, comment.

## Authentication

GitHub auth piggybacks on the official GitHub CLI.

### Install the `gh` CLI

macOS / Linux / WSL:

```bash
# Homebrew
brew install gh

# Or see https://github.com/cli/cli#installation for other platforms
```

### Authenticate

```bash
gh auth login
```

Follow the prompts. Rubber-Ducky calls `gh` as a subprocess, so whatever account `gh` is logged into is the account it uses. Switch accounts later with `gh auth switch`.

No workspace-level env vars are needed — `gh` stores credentials in its own config.

## Configuration

GitHub configuration lives in `workspace.md` frontmatter under `backends:`.

```yaml
backends:
  - type: github
    repos:
      - myorg/project-a
      - myorg/project-b
```

| Field | Required | What it does |
|---|---|---|
| `repos` | yes | List of `owner/repo` strings the backend should track. Used for default-project discovery and bulk ingest. |

During `init`, the wizard asks which repos to track. Add more later by editing `workspace.md`.

## Ingest

The `ingest github` command pulls GitHub issues and PRs into your wiki with full data — description, comments, attachments, labels, assignees. Attachments download to `raw/assets/`. The wiki index and log update automatically.

Ingest is **idempotent**: items already in your wiki are skipped.

### From the CLI

```bash
# Single issue or PR by number (uses first configured repo as default)
rubber-ducky ingest github 42

# Single issue or PR by full GitHub URL
rubber-ducky ingest github https://github.com/myorg/project-a/issues/42

# All open issues from a specific repo
rubber-ducky ingest github repo:myorg/project-a

# Filter by label
rubber-ducky ingest github label:myorg/project-a:bug

# Only items assigned to you
rubber-ducky ingest github --mine

# All items, regardless of assignee
rubber-ducky ingest github --all
```

### From Claude Code

You don't need to memorize the slash-commands — just tell Claude Code what you want in plain English:

- *"Ingest GitHub issue 42"*
- *"Pull in PR #128 from myorg/project-a"*
- *"Ingest all the open issues in myorg/project-a"*
- *"Do a full GitHub ingest for my assigned items"*

Claude Code maps these to the `/ingest-github` skill, which invokes the CLI and layers vocabulary-aware tagging on top. You can invoke the skill directly as shorthand:

```
/ingest-github 42
/ingest-github repo:myorg/project-a
/ingest-github label:myorg/project-a:bug
```

## Write-back

Every external write goes through a safety layer that previews the action, requires explicit confirmation, and logs it to `wiki/log.md`.

| Operation | Skill | What it does |
|---|---|---|
| Push | `/push` | Create a GitHub issue from a local wiki task page. Fills title, body, labels, assignee. |
| Comment | `/comment` | Add a comment to an existing GitHub issue or PR from the wiki. |
| Pull | `/pull-active` | Refresh active wiki tasks from their GitHub sources. |
| Reconcile | `/reconcile` | Surface status drift and new comments between wiki and GitHub. |

## Troubleshooting

**"gh: command not found"** — Install the GitHub CLI (see above), then run `gh auth login`.

**"Not authorized"** — Run `gh auth status` to confirm the CLI is logged in. Use `gh auth switch` to change accounts.

**Can't find a repo in the picker** — Confirm the `gh` account has access to the repo. Private repos in organizations may require enabling SSO or requesting org access.

**Connectivity check** — `rubber-ducky backend check` verifies `gh` is installed, authenticated, and can reach each configured repo.

## See also

- [Asana integration](./asana.md) and [Jira integration](./jira.md)
- [CLI reference](../cli-reference.md) for every `rubber-ducky` command and flag
- [Skills reference](../skills-reference.md) for every `/` skill
