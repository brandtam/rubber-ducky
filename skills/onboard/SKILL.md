---
name: onboard
description: First-run interview — invoke on a fresh vault or when the user says onboard me or help me get set up.
---

# Onboard

A short first-run interview: the smallest viable context to be useful next
conversation — not a comprehensive intake. Context capture is ongoing; anything
missed here gets captured later in normal conversation.

## When to run

No vault here yet (`rubber-ducky status` reports no workspace)? Invoke the
`adopt` skill first — onboarding writes to context pages that only exist once
the vault does.

Check `rubber-ducky settings get onboard.completed`. `false` (the default) →
run the interview. `true` → skip silently unless explicitly asked; if asked,
confirm first: "We've onboarded before — re-run, top up one section, or skip?"

## Interview

**One question per turn**, position-prefixed so the commitment is visible.
Four questions max:

1. *Question 1 of 4.* In one sentence, what's this vault going to hold?
2. *Question 2 of 4.* What should I call you, and anything about your role I
   should know to make my replies useful?
3. *Question 3 of 4.* Any internal-system names, acronyms, or in-house words
   that come up a lot? *(skip if the vault is clearly personal)*
4. *Question 4 of 4.* Any communication preferences — short or long, casual or
   formal, anything to avoid? *(skip if Q2 already answered this)*

## Persistence

Append each answer to the right context page with the Edit tool (read the
current state first via `rubber-ducky context query <kind>`):

| Answer | Page |
| :--- | :--- |
| 1 | `wiki/about.md` — Projects section |
| 2 | `wiki/about.md` — Identity section |
| 3 | `wiki/vocabulary.md` |
| 4 | `wiki/preferences.md` |

Then mark completion:

```
rubber-ducky log append "[onboard] completed lightweight intake"
rubber-ducky settings enable onboard.completed
```

If `rubber-ducky settings get ingest.auto_on_onboard` returns `true`, invite
one paste before finishing: "Paste any writing you already have about yourself
or this vault — bios, docs, anything — and I'll route what's useful into the
right pages. Or say skip." Route pasted material into the same four context
pages, append-only.

## Pairings (optional, offer both)

Two opt-ins after the interview, offered one at a time. Yes/no each; a decline
just moves on — never re-pitch. Neither requires Obsidian to be installed, and
both stay available later (the help skill lists them).

**1. Official Obsidian skills.** Ask: "Want me to install the official
Obsidian skills (by Obsidian's creator)? They teach me Obsidian-flavored
markdown, Bases, and canvas files." On yes, run:

```
claude plugin marketplace add kepano/obsidian-skills
claude plugin install obsidian@obsidian-skills
```

Then tell the user the skills load next session (or after `/reload-plugins`).
If the commands fail, give the in-session fallback to run themselves:
`/plugin marketplace add kepano/obsidian-skills` then
`/plugin install obsidian@obsidian-skills`.

**2. Memory in the vault.** Ask: "Want Claude Code's auto-memory to live
inside this vault, so my notes-to-self are visible in Obsidian next to
everything else?" On yes:

1. `mkdir -p memory` in the vault root.
2. Set `autoMemoryDirectory` in `.claude/settings.local.json` to the vault's
   **absolute** path plus `/memory` (expand it via `pwd`; relative values are
   rejected). Merge with any existing keys in that file — never clobber. Use
   `settings.local.json`, not `settings.json`: the path is machine-specific
   and `settings.json` is adopt-managed.
3. Tell the user: takes effect next session; to carry over existing memory,
   copy the contents of `~/.claude/projects/<project>/memory/` into
   `memory/`. See `docs/spikes/auto-memory-redirect.md` in the plugin repo
   for the full semantics.

Record the outcome either way:

```
rubber-ducky log append "[onboard] pairings: obsidian-skills=<yes|no> memory-in-vault=<yes|no>"
```

## Hand-off

End with exactly one sentence: *I'm rubber-ducky. Say `help` anytime to see
everything I can do.* No capability dump here — that's the help skill's job.
No project or task creation, either — this skill seeds context only.
