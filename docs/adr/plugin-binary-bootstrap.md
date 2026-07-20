# ADR: Plugin distribution via self-marketplace with binary bootstrap

- Status: accepted
- Date: 2026-07-20
- Relates to: issue #6 (part of #1)

## Context

rubber-ducky v3 ships as a compiled single-file Bun binary (see release.yml:
per-platform binaries attached to GitHub Releases on every `v*` tag). Users
consume it through Claude Code, and Claude Code's native distribution unit is
the **plugin**: a directory of plain files fetched from a marketplace — no
npm, no postinstall step, no Node or Bun on the user's machine.

That leaves a gap: a plugin can carry scripts and manifests, but a ~50 MB
per-platform binary has no good home in one. Committing binaries to git
bloats every clone forever and triples the repo per release (three
platforms). Vendoring them into the plugin would also ship every user two
binaries they can't run.

## Decision

The repo is simultaneously the CLI source, an installable Claude Code
plugin, and its own marketplace. **Binaries live on GitHub Releases, never
in git** — the plugin ships a POSIX-sh bootstrap wrapper that fetches the
right one on demand.

Three pieces:

- `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` — the
  plugin manifest and a single-entry marketplace whose plugin `source` is
  `./`, so `/plugin marketplace add brandtam/rubber-ducky` is all a user
  needs. (Submission to the community marketplace is a separate launch step,
  #11.)
- `bin/rubber-ducky` — bootstrap wrapper, pure POSIX sh (users have neither
  Node nor Bun; `sh`, `uname`, and `curl`-or-`wget` are the only
  dependencies). Claude Code puts a plugin's `bin/` on the Bash tool's PATH,
  so `rubber-ducky <verb>` just works in sessions. The wrapper resolves
  platform/arch, downloads
  `<releases>/v<version>/rubber-ducky-<platform>` once, caches it, and
  `exec`s it with all arguments passed through.
- `hooks/hooks.json` — a SessionStart hook running `scripts/prewarm.sh`,
  which backgrounds the download and exits 0 immediately, so the first real
  invocation never pays download latency and session start never blocks on
  the network.

## Cache: outside the plugin, versioned in lockstep

The binary is cached at `$XDG_CACHE_HOME/rubber-ducky/<version>/rubber-ducky`
(default `~/.cache/...`), **not** inside the plugin directory — Claude Code
wipes and re-copies plugin directories on update, and a plugin's own files
should stay exactly what the marketplace shipped.

`<version>` is read from `.claude-plugin/plugin.json` at invocation time, so
plugin version and binary version cannot silently diverge: after an update
the versioned path doesn't exist, the wrapper re-fetches, and stale version
directories are pruned. `plugin.json` carries an explicit `version` kept in
lockstep with `package.json` (enforced by test) because release tags are cut
from `package.json` — one bump moves the plugin, the tag, and the binary the
wrapper resolves, together.

Downloads go to a temp file then atomically `mv` into place, so a pre-warm
racing a real invocation never sees a half-written binary.

## Testability

`RUBBER_DUCKY_DOWNLOAD_BASE` overrides the release base URL. The wrapper
suite (`src/__tests__/plugin-wrapper.test.ts`) points it at a local mock
server and asserts the request log, cache state, argv pass-through, and exit
codes — download-exactly-once, cache-hit, and version-divergence behavior are
all covered without the network. The real GitHub Releases fetch is verified
in the launch slice (#11), once the first tag exists.

## Consequences

- No first-class Windows support until release.yml grows a Windows target;
  the wrapper fails fast with a clear platform message rather than guessing.
- The plugin is useless offline until the binary is cached once — accepted;
  the pre-warm hook makes this window one session start wide in practice.
- Every release requires the version bump discipline above; a tag whose
  binaries were never published leaves the wrapper with a clear
  `download failed: <url>` error pointing at the exact missing asset.
- CI validates the manifests headless (`claude plugin validate --strict` in
  the validate-plugin job); interactive plugin behavior (hook firing inside a
  live session) is verified manually and at launch (#11).
