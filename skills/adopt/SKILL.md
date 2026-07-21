---
name: adopt
description: Vault lifecycle — invoke on adopt this folder, make this a vault, set up rubber-ducky here, or to refresh managed files after an update.
---

# Adopt

Turn the current directory into a vault — or refresh an existing one — through
`rubber-ducky adopt`'s plan/apply cycle. The contract the user was promised:
**show the plan, write nothing until they approve, never touch their notes.**

## Steps

1. **Detect state** — `rubber-ducky status`.
   - Reports a workspace → this is a **refresh** (step 4).
   - No workspace + directory is empty → **fresh vault** (step 2).
   - No workspace + directory has files → **adoption** (step 3).
2. **Fresh, empty directory** — `rubber-ducky init .` scaffolds the whole
   vault in one shot (init is adopt-on-empty; no plan preview needed since
   there is nothing to collide with). Go to step 6.
3. **Adoption (existing notes)** — run the dry-run first: `rubber-ducky adopt .`
   Relay the plan faithfully — what it will create, refresh, and keep, and
   that existing files are untouched. Never skip the preview, and never apply
   in the same turn: ask, wait for a yes, then `rubber-ducky adopt . --apply`.
4. **Refresh (vault already exists)** — same plan → approval → apply cycle.
   Frame it as picking up managed-file updates; `keep` lines mean already
   current.
5. **Conflicts** — a `conflict` line means a managed file was locally
   modified. Applied from here (non-TTY), `--apply` leaves conflicts
   unresolved rather than prompting. List each conflicted path and what
   `--force` would overwrite; only run `adopt . --apply --force` after the
   user explicitly approves that list. Never lead with `--force`.
6. **Hand off** — after a fresh init or first adoption, check
   `rubber-ducky settings get onboard.completed`; if `false`, offer the
   short onboarding interview (invoke `/onboard`). Declined? Fine — confirm
   the vault is ready in one line and get out of the way.
