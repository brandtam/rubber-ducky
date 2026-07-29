# ADR: Confirm gate is one PreToolUse hook and one patterns file

- Status: accepted
- Date: 2026-07-20
- Relates to: issue #7 (part of #1)

## Context

rubber-ducky vaults will connect to external services (issue #9's `/connect`
skill), and the Agent will run commands that write to those services — post a
GitHub comment, transition a Jira issue. Those are the writes a user may want
mediated: always allowed, always confirmed, or previewed first.

The v2→v3 transplant deliberately kept the `confirm.*` settings keys as
reserved contract surface while deleting v2's confirm verb and token
machinery. This slice makes those keys real: schema-validated, audit-logged
policy, plus enforcement.

Claude Code gives us the enforcement point for free: a PreToolUse hook can
inspect every Bash command before it runs and answer `allow`, `deny`, or
`ask` — where `ask` routes the call into Claude Code's native permission
dialog. And Claude Code's native permission system already mediates
everything else; rubber-ducky only needs to add per-action policy for the
writes it *knows about*.

## Decision

**One hook, one patterns file. Deliberate minimalism: needing a second file
or an abstraction layer is the signal to stop and reconsider.**

### The policy keys

`confirm.<transport>.<verb>` in the vault's `settings.json` holds one of:

| policy    | PreToolUse decision | effect                                          |
| --------- | ------------------- | ----------------------------------------------- |
| `auto`    | `allow`             | registered write runs without prompting          |
| `manual`  | `ask`               | blocked pending explicit user confirmation       |
| `preview` | `ask` + command in reason | user reviews the exact command, then approves |

A registered write with no explicit entry defaults to `preview` —
fail-closed for known external writes. The keys are set through the existing
`settings set` verb, so they inherit schema validation, JSONC comment
preservation, and the `wiki/log.md` audit trail. (Natural-language
adjustment arrives with skills in a later slice.)

`manual` and `preview` both resolve to `ask` on purpose: Claude Code's
permission dialog **is** the confirmation UI. v2 needed bespoke
preview/confirm-token machinery because it mediated writes inside its own
CLI; v3's hook only has to route the decision and say why. Re-implementing a
prompt loop, token store, or TTL here would be the abstraction layer this
ADR forbids.

### The patterns file

`<vault>/.rubber-ducky/write-patterns` — plain text, one registration per
line:

```
# registered by /connect
<transport>.<verb> <pattern>

github.comment gh issue comment *
github.comment gh pr comment *
jira.transition jira issue move * --to *
```

- First whitespace run splits the action descriptor from the pattern; the
  pattern may contain spaces.
- The descriptor is exactly the dotted key under `confirm.` in
  `settings.json`.
- The pattern matches against the **entire** Bash command, anchored at both
  ends. `*` is the only wildcard and spans any text, including spaces and
  newlines; everything else is literal. First matching line wins.
- Blank lines and `#` comments are ignored; malformed lines are skipped
  (one bad appended line must not take the gate down).

It lives in `.rubber-ducky/` because that is already the vault's
machine-managed state directory (`manifest.json`, `transactions/`), and it
is gitignored with the rest of that directory by design: registrations are
made by `/connect` alongside machine-local credentials in `.env.local`, so
they travel with the connection, not with git. Issue #9's `/connect` skill
appends to this file; nothing else writes it.

### The hook

`hooks/hooks.json` registers a single Bash-scoped PreToolUse entry alongside
the existing SessionStart pre-warm:

```json
{ "matcher": "Bash", "hooks": [ { "type": "command",
  "command": "\"${CLAUDE_PLUGIN_ROOT}\"/bin/rubber-ducky hook pre-tool-use",
  "timeout": 60 } ] }
```

The command routes through the existing `bin/rubber-ducky` bootstrap wrapper
into a **hidden CLI verb** (`hook pre-tool-use`) rather than shipping a
second shell script, because:

- Users have neither Node nor Bun, and `jq` is not guaranteed either —
  parsing a JSON hook payload robustly in pure POSIX sh means reinventing a
  JSON parser in sed. The compiled binary parses it properly.
- Policy resolution already lives in the binary (`settings.ts`: JSONC
  parsing, schema validation, `resolveConfirmPolicy`). A shell
  reimplementation would be a second source of truth for the schema —
  exactly the duplication this ADR exists to prevent.
- The verb is exercised by the shared test harness in both source and
  compiled-binary modes, like every other CLI surface.
- The wrapper is already the plugin's one bridge to the binary (see
  docs/adr/plugin-binary-bootstrap.md), and the SessionStart pre-warm keeps
  its cache hot, so the hook's cold-start window is one session start wide.

### Fail-open, with one carve-out

Unregistered commands **always** pass through untouched — Claude Code's
native permission system is the general backstop, and a vault with no
connections must behave as if the gate did not exist. The gate encodes
"pass through" as exit 0 with empty stdout (the hooks contract's "defer"),
and it *always* exits 0: unparseable payload, no workspace at the payload's
`cwd`, missing or unreadable patterns file — silence, never exit 2. If the
bootstrap wrapper itself fails (no network on an uncached binary,
unsupported platform), its non-zero/non-2 exit is a non-blocking hook error
and the tool call still proceeds — fail-open end to end.

One deliberate carve-out: a command that **did** match a registered pattern
but whose `settings.json` is unreadable gets the fail-closed default
(`preview` → `ask`) instead of a free pass. A known external write should
never lose its gate to a corrupted settings file.

### A preview/UX layer, not a security boundary

The gate mediates the writes it knows about; it does not — and cannot —
contain a hostile agent. Known limits, accepted rather than papered over:

- **Unregistered spellings.** A broad allowlist for a transport binary in
  Claude Code's native permissions (e.g. `Bash(gh:*)`) lets any command
  spelling not present in `write-patterns` run without a gate decision.
- **MCP transports.** MCP tool calls are not Bash; the gate never sees
  them. `/connect` says so in the transport menu and every bridge doc
  carries a standing "Gate limits" section.
- **Shell spellings are unbounded.** Pattern matching and the self-gating
  detector below are string-level heuristics; an adversarial encoding
  (base64 through `sh`, variable indirection) gets past them. The goal is
  making evasion *visibly evasive* in the transcript, not impossible.

### Self-gating carve-out

The gate's own configuration — the `confirm.*` keys in `settings.json` and
the `.rubber-ducky/write-patterns` registrations — must not be rewritable by
an ungated (or auto-allowed) Bash command, or the gate can be switched off
by the very layer it mediates. Before normal pattern matching, the hook
detects:

- `rubber-ducky settings set` with a `confirm.*` key (any binary spelling);
- common Bash writes onto the two config files: `>` / `>>` redirection
  targets, `tee`, and `cp` / `mv` onto the paths.

A hit always answers preview-style `ask`. This is **not configurable** — no
policy, including a hostile `* → auto` registration, can suppress it, and it
fires even when no patterns file exists. The legitimate path is unchanged:
`settings set confirm.*` executes normally once the user approves the
prompt. Matching `settings.json` by basename means other settings files
(`.vscode/settings.json`) inside a vault also prompt — accepted, because a
false positive costs one visible dialog.

### `SHELL_CONTROL` and plain `>` / `<` — a decision, not an accident

The wildcard-span safety check (`autoAllowIsUnsafe`) downgrades `auto` to
`ask` when a `*` span carries `;` `&` `|` backtick, newline, or a
`$(` / `<(` / `>(` opener — constructs that chain or spawn a second command.
Plain `>` / `<` redirection is deliberately excluded: a redirect writes a
local file rather than executing anything, and `>` appears routinely in
quoted prose (markdown blockquotes, arrows) that comment-style writes carry.
Redirections aimed at the gate's own config files are covered separately and
unconditionally by the self-gating detector.

## Consequences

- The gate is only as good as the registered patterns; `/connect` (#9) owns
  their quality. A pattern that is too narrow degrades safely: the command
  falls back to Claude Code's native permission prompt.
- Pattern matching is intentionally primitive (`*` only, first match wins).
  If registrations ever need regex, negation, or per-pattern options, that
  is the second-abstraction signal — reconsider the design rather than
  growing the format.
- The hook runs on every Bash call in sessions where the plugin is active.
  The non-matching path is one binary exec, one file read, and a handful of
  pattern tests — no network, no settings read.
- Headless verification covers payload→decision behavior and hook
  registration (`claude --plugin-dir`); the permission dialog that `ask`
  produces is interactive by nature and is verified manually.
