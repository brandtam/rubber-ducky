# ADR: Plugin distribution via self-marketplace with binary bootstrap

- Status: accepted
- Date: 2026-07-20 (integrity chain added 2026-07-29, issue #24)
- Relates to: issue #6 (part of #1), issue #24 (binary integrity)

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

## Integrity chain: git-pinned checksums (issue #24)

GitHub release assets are mutable — anyone with write access to Releases (or
a compromised token) can swap a binary under an existing tag, and the
PreToolUse hook auto-executes whatever the wrapper fetches. The trust anchor
therefore cannot be the release itself; it has to travel through git with
the plugin files.

- The release workflow computes sha256 for every per-platform binary and
  commits them to `main` in `.claude-plugin/checksums.json`, keyed
  `v<version>/<platform>`, **before** publishing any asset. If that commit
  cannot land, the release fails — no asset ever exists without its pinned
  hash in git.
- The wrapper reads the expected hash from the checksums file inside its own
  plugin root (resolved from `dirname $0`, never PATH or cwd), and verifies
  the downloaded temp file with `sha256sum`/`shasum -a 256` **before** the
  `--version` runnability probe and before the `mv` into the cache. A
  mismatch deletes the temp file and exits non-zero with both hashes shown.
  A missing checksums file or missing entry is a hard error before the
  download even starts — fail closed, never open.
- The wrapper also validates the sed-scraped manifest version against
  `[0-9A-Za-z.-]` before it is used in cache paths or the URL, and pins
  transport: curl gets `--proto '=https' --proto-redir '=https'` on the
  production HTTPS URL (redirects pinned to HTTPS even for test overrides);
  wget uses `--https-only` where the build supports it — wget has no
  redirect-only equivalent, so on older builds the sha256 gate is the
  backstop for a downgrade-redirect.
- The release workflow itself is hardened: `contents: write` (plus
  `id-token`/`attestations: write` for `actions/attest-build-provenance`)
  is scoped to the release job only, all actions are pinned by commit SHA,
  and the Bun toolchain version is pinned.

### Release sequencing: atomic in one workflow run (option b)

Two options were considered: (a) warn-but-continue on a missing checksums
file for one release, enforce from the next; or (b) land the checksum commit
and the release assets in the same workflow run so enforcement is immediate.

**Chosen: (b).** The release job commits checksums to `main` first, then
attests provenance, then publishes assets. Warn-but-continue (a) would ship
a wrapper that sometimes skips verification — exactly the downgrade path an
attacker wants, and a window that tends to become permanent. With (b) the
enforcing wrapper and the checksums it needs move through git together:
Claude Code installs the plugin from the repo, so any copy that contains the
enforcing wrapper also sees `main`'s checksums file. The residual window —
a user updating the plugin between the tag push and the checksum commit
landing — fails closed with a clear "no checksum entry" error and heals on
the next plugin refresh, which is strictly better than executing an
unverified binary.

### Cached binary is not re-hashed at exec time

Re-verifying the cache on every invocation would close a local TOCTOU
(swap the cached file after verification). It is deliberately skipped: the
cache lives under the user's own `$HOME` with user-only write access, so the
attacker in that scenario already writes to the user's home directory —
i.e. can edit shellrc, the wrapper's own plugin copy, or `PATH` — and
hashing a ~50 MB binary on every call (including every PreToolUse hook
fire) would tax the hot path to defend a boundary that is already lost.
The HTML-block-page sniff (self-heal) remains as a correctness, not
security, measure.

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
