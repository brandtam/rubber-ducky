# v2-vault

## You are the primary interface

This is a Rubber-Ducky workspace. The user works by talking to you inside Claude Code. When they describe what they want — creating tasks, logging work, capturing ideas — you make it happen.

Use the `rubber-ducky` CLI commands listed below for all mechanical operations (page creation, frontmatter updates, logging). This is faster, more reliable, and preserves your context window.

See @references/when-to-use-cli.md for the full rationale on what goes to CLI vs. what stays in Claude Code.

## On a fresh session

Before responding to the user on the first turn of a new conversation, run:

```bash
rubber-ducky settings get onboard.completed
```

If the value is `false`, invoke `/onboard` before anything else — that's the short first-run interview that seeds the context pages (`wiki/voice.md`, `about.md`, `vocabulary.md`, `preferences.md`). `/onboard` flips the flag itself when it completes, so this check is self-quieting after the first run. Whatever the user said on this first turn can wait until `/onboard` hands back.

If the value is `true`, proceed normally.

## Workspace structure

- `workspace.md` — Workspace configuration (YAML frontmatter)
- `wiki/daily/` — Daily work logs (YYYY-MM-DD.md)
- `wiki/tasks/` — Task pages (slugified-title.md)
- `wiki/projects/` — Project pages
- `wiki/index.md` — Auto-generated page index
- `wiki/log.md` — Timestamped activity log
- `raw/` — Immutable input files (screenshots, attachments)

## Connected integrations

No integrations connected yet. Run `/connect <name>` from inside Claude Code to wire up a builtin (asana, jira, github) or any [Printing Press](https://github.com/mvanhorn/cli-printing-press)-generated `*-pp-cli` binary.

Once an integration is connected, this section will list it along with a pointer to its bridge guidance at `.rubber-ducky/integrations/<name>.md`.

## Credential safety

**NEVER** do any of the following:
- Read, cat, print, or display the contents of `.env`, `.env.local`, `.env.*`, or any file that may contain tokens or secrets
- Ask the user to paste API tokens, passwords, or credentials into the chat
- Log, echo, or output environment variable values that contain secrets
- Include token values in commit messages, task pages, or any persisted file
- Store credentials in `workspace.md`, `CLAUDE.md`, or any tracked file

Credentials belong **only** in the workspace's untracked `.env.local` file. If a backend connectivity check fails, direct the user to @references/backend-setup.md — never try to debug by inspecting their token values.


## CLI commands

All commands support `--json` for structured output. Run these via bash.

### Pages and tasks

- `rubber-ducky page create daily [date]` — Create a daily page (defaults to today)
- `rubber-ducky page create task "<title>" [--source <backend>] [--ref <id>]` — Create a task page
- `rubber-ducky page create project "<title>"` — Create a project page
- `rubber-ducky task start <file>` — Set task to in-progress, log to daily page
- `rubber-ducky task close <file>` — Set task to done, stamp closed date

### Quick capture

- `rubber-ducky asap add "<message>"` — Urgent item (persists until resolved)
- `rubber-ducky asap list` — Show all ASAP items
- `rubber-ducky asap resolve <index>` — Mark ASAP item resolved
- `rubber-ducky remind add <YYYY-MM-DD> "<message>"` — Date-keyed reminder
- `rubber-ducky remind list [date]` — Show reminders (optionally filtered by date)
- `rubber-ducky remind resolve <index>` — Mark reminder resolved
- `rubber-ducky idea add "<message>"` — Capture an idea for later
- `rubber-ducky idea list` — Show all ideas
- `rubber-ducky screenshot ingest <path> "<title>"` — Import screenshot + create task page

### Wiki operations

- `rubber-ducky index rebuild` — Regenerate wiki/index.md
- `rubber-ducky log append "<message>"` — Add timestamped entry to wiki/log.md
- `rubber-ducky wiki search "<query>" [--type <type>] [--from <date>] [--to <date>]` — Search pages

### Frontmatter

- `rubber-ducky frontmatter get <file> [field]` — Read frontmatter (all or one field)
- `rubber-ducky frontmatter set <file> <field> <value>` — Write a frontmatter field
- `rubber-ducky frontmatter validate <file> [--type <type>]` — Validate against schema

### Ingest

- `rubber-ducky ingest asana [ref]` — Ingest Asana task(s) into wiki (single GID, project:<gid>, section:<gid>)
- `rubber-ducky ingest jira [ref]` — Ingest Jira issue(s) into wiki (single key, project:<key>)
- Flags: `--mine` (only my tasks), `--all` (all tasks), `--json` (structured output)

### Asana

- `rubber-ducky asana configure-naming` — Configure how task filenames are generated (source, casing, live preview)

### Workspace health

- `rubber-ducky doctor` — Run health checks (structure, config, backends)
- `rubber-ducky doctor lint` — Lint pages (stale tasks, orphans, broken links, schema)
- `rubber-ducky backend list` — Show configured backends
- `rubber-ducky backend check [name]` — Verify backend connectivity
- `rubber-ducky backend configure <jira|asana>` — Interactively pick a default project and save to workspace.md
- `rubber-ducky status` — Show workspace info
- `rubber-ducky update` — Update skills to latest bundled versions

## Conventions

### Schema

- All pages use YAML frontmatter + markdown body — see @references/frontmatter-templates.md for complete schemas
- Task statuses: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
- Daily pages are named YYYY-MM-DD.md
- Task pages are named by slugified title (lowercase, hyphens, no special characters)
- **YAML frontmatter quoting**: always double-quote titles, refs, URLs, dates and any value containing colons or special YAML characters. Unquoted strings break Obsidian's Properties panel.

### Wikilinks

- Use `[[wikilinks]]` for cross-references between pages
- A broken wikilink is a *gap signal*, not just an error — it usually means a page should be created. Treat the linter's broken-link warnings as TODOs, not failures.
- Filenames must match wikilink targets exactly (case included). Use hyphens, not slashes.

### Activity log

Every task page has an `## Activity log` section. Append a one-line entry on every meaningful touch:

```
- **YYYY-MM-DD** — [[wiki/daily/YYYY-MM-DD]] — what happened
```

This compounds in value over time: it's how future-you reconstructs *why* a decision was made.

### Append-only operations log

`wiki/log.md` is an append-only record of every ingest, push, write-back, and wrap-up. Use `rubber-ducky log append "<message>"` — never edit prior entries.

### Raw inputs are immutable

`raw/` is the immutable bottom of the three-layer model (raw → wiki → schema). Never modify, rename, or delete files in `raw/` once ingested. If a screenshot or attachment was wrong, ingest a new one and supersede the wiki page; leave the raw artifact in place.

### Write-back safety (hybrid confirmation)

Operations split into two risk classes:

- **Write-soft** — drafts, reads, writes landing in the local workspace. Auto-executes.
- **Write-hard** — sends, posts, creates, updates touching external systems. Gated at the **CLI layer**, not by skill convention.

The hard-action gate:

- `rubber-ducky push | comment | transition` are the only verbs that perform external writes. Each requires `--confirm-token <tok>` and consumes the token before calling the backend; without a valid token the verb exits non-zero and no external call is made.
- `rubber-ducky confirm request --action <backend>.<verb> --preview <text>` issues a token. The CLI shows the preview and prompts the user — unless `settings.confirm.<backend>.<verb>` is `auto`, in which case the token is auto-issued.
- Skills `/push`, `/comment`, `/transition` (plus the composers `/link`, `/release`, `/new-ticket`) orchestrate the request → token → write sequence.

Per-action overrides:

- `rubber-ducky settings get confirm` — read the current policy tree.
- `rubber-ducky settings set confirm.<backend>.<verb> auto` (or `preview`) — flip a single action.

Every issue/consume pair is audit-logged to `wiki/log.md`.

### Memory vs wiki boundary

- **Auto-memory** (Claude Code's persistent context) holds *how we work*: user preferences, repeating patterns, project-shaped facts.
- **Wiki** holds *the work itself*: tasks, daily logs, content, dates.

Never persist work content (tasks, decisions, log entries) to memory. Never persist preferences or how-we-work patterns to wiki pages.

## How to respond to common requests

| User says | You do |
|-----------|--------|
| "good morning" / "morning" / "gm" | Run `/good-morning` immediately — do not ask for confirmation |
| "wrap up" / "wrapping up" / "end of day" / "eod" | Run `/wrap-up` immediately — do not ask for confirmation |
| "Create a task for ..." | `rubber-ducky page create task "<title>"` |
| "I'm starting on ..." | Find the task file, run `rubber-ducky task start <file>` |
| "Done with ..." / "Finished ..." | Find the task file, run `rubber-ducky task close <file>` |
| "Something urgent: ..." | `rubber-ducky asap add "<message>"` |
| "Remind me on Friday to ..." | `rubber-ducky remind add <date> "<message>"` |
| "I had an idea: ..." | `rubber-ducky idea add "<message>"` |
| "Log this: ..." | `rubber-ducky log append "<message>"` |
| "What's on my plate?" | Read today's daily page + task pages, synthesize a summary |
| "What did I do yesterday?" | Read yesterday's daily page, summarize |
| "Run a health check" | `rubber-ducky doctor` |

Natural-language triggers are first-class. When the user's intent maps cleanly to a skill, invoke the skill directly — do not ask "would you like me to run /x?". The point of this workspace is that the user shouldn't have to remember slash commands.

## Ingesting from backends

When the user connects a repo or asks to pull in issues/tickets, **always ask before ingesting**. Never auto-ingest.

### Flow

1. **Create a project page first.** Each repo (or Jira project, or Asana project) becomes a project page:
   `rubber-ducky page create project "<repo-or-project-name>"`

2. **Show a summary.** List the issues/tickets grouped by category, label, or area. Show counts, not full details.

3. **Ask what to ingest.** "Want me to pull all of these in as task pages, or just specific groups?" Let the user choose all, a subset, or none.

4. **Ingest selected issues as task pages.** For each issue:
   - `rubber-ducky page create task "<title>" --source <backend> --ref <id>`
   - Link the task to the project by adding the task slug to the project page's body under `## Tasks`
   - Update the task page body with the issue description and any relevant context

5. **Rebuild the index.** After ingesting, run `rubber-ducky index rebuild`.

### Multiple repos

`workspace.md` may list multiple repos under a single GitHub backend. Each repo should be its own project page. When the user says "pull in issues from all my repos," iterate through each repo, create its project page, then ask about issues per repo.
