# Bridge doc template

A bridge doc is a one-page markdown map of one external service, written for
the Agent — prose to read, not config to parse. Location:
`.rubber-ducky/integrations/<service>.md`. Every integration skill reads it;
none of them may know anything about the service that isn't written here.

Sections, in order:

## Transport

Which path was chosen (official CLI / generated CLI / MCP server /
hand-written), the binary name or MCP server reference, and the
structured-output flag if one exists.

## Auth

How the transport authenticates and how to *check* it (e.g. a status
subcommand), or the env var NAMES it reads from `.env.local`. Never values.

## Fetch recipes

Exact commands to fetch a list of items and a single item, with the flags
that produce structured output. State the canonical reference form for an
item (number, key, URL) — that form is what goes in the page's `ref` field.

## Write recipes

Exact commands to create, comment, transition/close, and update. If a write
isn't supported by the transport, say so explicitly — skills must refuse
rather than improvise. Every command shape listed here must have a matching
`<service>.<verb>` line in `.rubber-ducky/write-patterns`.

## Field mappings

Service field → vault frontmatter field, one per line, using the vault
schema (`references/frontmatter-templates.md`): `title`, `status`,
`priority`, `assignee`, `due`, `tags`, plus `source: <service>`, `ref` (the
canonical reference form), and — when the schema reserves a URL field for
this service (`gh_ref` / `jira_ref` / `asana_ref`) — which one to set.
Unmapped service fields go to the page body, not frontmatter.

## Gate limits

A standing section, copied verbatim into every generated bridge doc (fill in
the service and binary names):

```markdown
## Gate limits

The confirm gate is a preview/UX layer, not a security boundary. Two known
bypasses to keep in mind for this integration:

- A broad allowlist for `<binary>` in Claude Code's native permissions
  (e.g. `Bash(<binary>:*)`) lets any command spelling NOT registered in
  `.rubber-ducky/write-patterns` run without a gate policy. Keep native
  allowlist entries narrow, or keep the write-patterns lines in sync with
  every write spelling this doc lists.
- MCP tool calls are not Bash — if this integration (or a sibling) uses an
  MCP transport, the gate never sees those writes. Rely on Claude Code's
  native permissions for them.
```

## Status normalization

A two-way table: every service status → one vault status (`backlog`,
`to-do`, `in-progress`, `in-review`, `pending`, `blocked`, `done`,
`deferred`), and, for each vault status a write recipe can set, the command
or value that produces it. Vault statuses with no service equivalent are
wiki-only — mark them so writes know to leave the service untouched. This
table is what /ingest and /reconcile normalize with; a status missing here
surfaces as a question to the user, and the answer belongs back in this
table.

---

## Worked example (GitHub via `gh` — for shape only, not shipped logic)

```markdown
# Integration: github

## Transport
Official CLI: `gh` (https://cli.github.com). Structured output: `--json <fields>`.

## Auth
`gh auth login` (browser flow). Check with `gh auth status`. No env vars needed.

## Fetch recipes
- List open issues: `gh issue list --repo <owner>/<repo> --state open --json number,title,state,url`
- Single issue: `gh issue view <number> --repo <owner>/<repo> --json number,title,state,body,url,labels,assignees,createdAt,closedAt,comments`
- Reference form for `ref`: `<owner>/<repo>#<number>`

## Write recipes
- Create: `gh issue create --repo <owner>/<repo> --title "<title>" --body "<body>"`
- Comment: `gh issue comment <number> --repo <owner>/<repo> --body "<text>"`
- Transition: `gh issue close <number> --repo <owner>/<repo>` / `gh issue reopen <number> --repo <owner>/<repo>`
- Update: `gh issue edit <number> --repo <owner>/<repo> ...`

## Field mappings
- title → title
- state (+ assignees) → status (see normalization)
- labels[].name → tags
- assignees[0].login → assignee
- url → gh_ref
- source: github; ref: <owner>/<repo>#<number>
- body → page body `## Description` (not frontmatter)

## Gate limits
The confirm gate is a preview/UX layer, not a security boundary. A broad
`Bash(gh:*)` allowlist in Claude Code's native permissions lets unregistered
`gh` spellings run ungated; MCP transports bypass the gate entirely.

## Status normalization
| GitHub | vault |
| :-- | :-- |
| open, unassigned | to-do |
| open, assigned | in-progress |
| closed | done |

Writes: done → `gh issue close`; any open vault status → `gh issue reopen`
if closed, otherwise wiki-only (GitHub has no native in-review/blocked —
leave the service untouched and say so in the preview).
```
