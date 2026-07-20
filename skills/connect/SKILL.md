---
name: connect
description: Wire up an external service — invoke on connect github, add an integration, or hook this vault to a tracker.
---

# Connect

Wire an external service into this vault as an integration. There is no
registry of supported services and no built-in backend code — an integration
is a bridge doc plus whatever transport the user picks. The bridge doc at
`.rubber-ducky/integrations/<service>.md` is the single source of truth that
every other integration skill (/ingest, /backend-write, /new-ticket,
/reconcile) reads; nothing service-specific may live anywhere else.

## Arguments

`$ARGUMENTS` — the service to connect (`github`, `jira`, `some-internal-tool`).
Empty → ask which service.

## Already connected?

If `.rubber-ducky/integrations/<service>.md` exists, ask: re-run setup, update
the bridge doc, or cancel? Never silently overwrite.

## Choose a transport

Surface all four options verbatim and let the user pick — don't prescribe,
even when one looks obvious. The user knows their situation:

> Four ways to wire up `<service>`:
>
> **(a) Official CLI** — if `<service>` ships one (e.g. GitHub's `gh`), install it; I'll bridge to it.
> **(b) Generated CLI** — I generate a CLI from the service's API, using whatever generator tooling you have on hand.
> **(c) MCP server** — if a good MCP server exists for `<service>`, point me at it.
> **(d) Hand-written** — you already have a custom CLI or script. Tell me what to call.
>
> Which fits?

Then, per pick:

- **(a) / (d)** — verify the binary with `which <binary>`; missing → stop and
  point at its install docs. Run `<binary> --help` plus the help for its main
  list / get / create verbs; note any structured-output flag (`--json` or
  similar) — that flag is what makes fetches machine-readable.
- **(b)** — generate and install the CLI, then inspect it exactly as (a).
- **(c)** — get the server reference, confirm Claude Code is configured for
  it (`claude mcp`), and record the tool names to invoke in place of shell
  commands. (MCP tool calls are not Bash, so the confirm gate does not see
  them — say so in the bridge doc and lean on Claude Code's native
  permissions for writes.)

Auth stays out of chat: tokens go through the transport's own flow (`gh auth
login`) or live as env var names in `.env.local`. Never accept pasted
credentials and never read `.env*` files.

## Author the bridge doc

Write `.rubber-ducky/integrations/<service>.md` following the section
skeleton in [bridge-doc.md](bridge-doc.md). Fill it from the transport's
actual help output and one sample fetch — never invent flags. Walk the user
through **Field mappings** and **Status normalization** in particular; those
two sections are what every other integration skill depends on.

## Register write patterns

Every write recipe in the bridge doc gets a line in
`.rubber-ducky/write-patterns` so the confirm gate can route it. Append —
never rewrite existing lines (first match wins, and other integrations own
their lines):

```
# registered by /connect (<service>)
<service>.<verb> <command pattern>
```

- The descriptor `<service>.<verb>` is the dotted key its policy lives under
  in settings (`confirm.<service>.<verb>`). Use the vault's verb vocabulary:
  `create`, `comment`, `transition`, `update`.
- The pattern matches against the ENTIRE Bash command; `*` is the only
  wildcard (matches anything, spaces included), everything else is literal.
  Add one line per command spelling the write recipes use.
- An unregistered policy defaults to `preview` (fail-closed). Only run
  `rubber-ducky settings set confirm.<service>.<verb> auto` (or `manual` /
  `preview`) when the user asks for a non-default policy.

## Record the connection

1. `rubber-ducky frontmatter array add workspace.md integrations <service>`
   — adds the service to the `integrations:` list (creates it if absent).
2. Under `## Connected integrations` in `AGENTS.md`, replace the
   no-integrations placeholder with one line per connection: the service name
   and its bridge-doc path.
3. `rubber-ducky log append "[connect] <service> connected via <transport>"`

## Validate end-to-end

Offer: "Want me to pull one ticket in to sanity-check the mapping?" On yes,
invoke /ingest for a single item and fix the bridge doc wherever the mapping
creaked. A bridge doc that hasn't ingested one real item isn't finished.

## Rules

- No service-specific logic outside the bridge doc — a wrong mapping is fixed
  in the doc, never special-cased in a skill.
- Bridge docs are per-vault and gitignored with the rest of `.rubber-ducky/`:
  they travel with the connection (and its machine-local auth), not with git.
- Never handle credential values; env var names only.
