# Spike: redirecting Claude Code auto-memory into the vault

Verification spike for issue #10 — can Claude Code's auto-memory directory be
pointed at an arbitrary path (specifically, a folder inside the vault), and by
what mechanism? Verified 2026-07-20 against the official docs at
`code.claude.com/docs/en/memory` (the `docs.claude.com/.../memory` URL 301s
there).

## How auto-memory works today

- On by default. Each project gets a memory directory at
  `~/.claude/projects/<project>/memory/`, where `<project>` is derived from
  the git repository — all worktrees and subdirectories of one repo share one
  memory directory. Outside a git repo, the project root is used.
- The directory holds a `MEMORY.md` index plus optional topic files
  (`debugging.md`, …). The first 200 lines or 25KB of `MEMORY.md` (whichever
  comes first) load into every session; topic files load on demand via normal
  file tools.
- Toggles: `autoMemoryEnabled` in settings, `/memory` in-session, or
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- Memory is machine-local; it is not synced across machines by Claude Code.

## The redirect mechanism (verified — it exists and is supported)

The `autoMemoryDirectory` setting relocates the memory directory:

```json
{
  "autoMemoryDirectory": "/absolute/path/to/vault/memory"
}
```

Semantics, per the official docs:

- Read from **any settings scope**: user, project (`.claude/settings.json`),
  local (`.claude/settings.local.json`), managed policy, or `--settings`.
- The value **must be an absolute path or start with `~/`** — a
  vault-relative value is rejected, so the applying agent has to expand the
  vault's absolute path at write time.
- When set at project or local scope, it is honored **only after the user
  accepts the workspace trust dialog** for that folder (same gate as hooks).

## Chosen approach

On acceptance during `/onboard`, write `autoMemoryDirectory` into the vault's
`.claude/settings.local.json` (merging with any existing content), pointing at
`<vault>/memory/`, and create that directory.

Why local scope, not `.claude/settings.json`:

1. The value is an **absolute, machine-specific path** — committing it would
   break every other clone/machine.
2. The vault's `.claude/settings.json` is an **adopt-managed file**
   (content-hashed in `.rubber-ducky/manifest.json`); a hand edit would turn
   every future `rubber-ducky adopt` into a conflict prompt.
   `settings.local.json` is invisible to adopt by construction.

Why `<vault>/memory/` (vault root, not under `wiki/`): memory notes become
plain markdown visible and linkable in Obsidian — the "one memory system" the
issue asks for — while staying out of `wiki/`, preserving the documented
memory-vs-wiki boundary (memory = how we work; wiki = the work itself).

Migration note surfaced to the user on acceptance: existing memory can be
carried over by copying the contents of `~/.claude/projects/<project>/memory/`
into `<vault>/memory/`; the change takes effect on the next session.

## Documented fallback (if the setting is ever unavailable)

If a Claude Code version without `autoMemoryDirectory` support is in play, the
same effect is achievable with a symlink, because the per-repo directory
resolution happens before the filesystem is touched:

```sh
mkdir -p <vault>/memory
rm -rf ~/.claude/projects/<project>/memory
ln -s <vault>/memory ~/.claude/projects/<project>/memory
```

This is fallback-only: the setting is the supported path and survives Claude
Code relocating or restructuring its project cache; the symlink does not.

## Caveats

- The trust-dialog gate means the redirect activates only after the user has
  trusted the vault folder — acceptable, since a rubber-ducky vault is trusted
  as part of normal use.
- Memory remains machine-local from Claude Code's perspective; putting it in
  the vault makes it *syncable* by whatever syncs the vault (git, Obsidian
  Sync). Two machines writing memory into one synced vault can race — noted,
  accepted, out of scope.
- `MEMORY.md`'s 200-line/25KB index limit is unchanged by the redirect.
