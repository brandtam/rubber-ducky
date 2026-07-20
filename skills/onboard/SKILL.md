---
name: onboard
description: First-run interview — invoke on a fresh vault or when the user says onboard me or help me get set up.
---

# Onboard

A short first-run interview: the smallest viable context to be useful next
conversation — not a comprehensive intake. Context capture is ongoing; anything
missed here gets captured later in normal conversation.

## When to run

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

## Hand-off

End with exactly one sentence: *I'm rubber-ducky. Say `help` anytime to see
everything I can do.* No capability dump here — that's the help skill's job.
No project or task creation, either — this skill seeds context only.
