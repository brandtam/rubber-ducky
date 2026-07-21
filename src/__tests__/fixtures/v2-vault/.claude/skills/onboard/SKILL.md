---
name: onboard
description: "Lightweight first-run interview that seeds the ongoing-context-capture pages and hands off to /help"
risk_class: soft
---

# Onboard

A short first-run interview. The goal is the **smallest viable amount** of
context the Agent needs to be useful in the next conversation — not a
comprehensive intake. Heavy context-building is delegated to
`/ingest-writing`, which the user can invoke any time with raw material.

## When to invoke

- The first time the user opens a vault — check
  `rubber-ducky settings get onboard.completed`. If it returns `false`
  (the default), proceed with the interview. If it returns `true`,
  skip silently unless the user explicitly asks.
- Whenever the user explicitly asks: "onboard me", "help me get set up",
  "introduce yourself", "what should I tell you about me?"

If `onboard.completed` is already `true`, don't re-run silently — confirm:
*"We've onboarded before — re-run, top up just one section, or skip?"*
This flag is the authoritative "have we onboarded?" state. The wiki log
is append-only history; the flag is current state.

## Interview shape

**One question per turn**, prefixed with its position so the user knows
the commitment up front. The whole interview is 4 questions:

> **Question 1 of 4.** In one sentence, what's this vault going to hold?
> (Work, a project, your boat, your personal life, anything.)

> **Question 2 of 4.** What should I call you, and is there anything about
> your role I should know to make my replies useful?

> **Question 3 of 4.** Are there any internal-system names, acronyms, or
> in-house words that come up a lot? (e.g., project codenames, tool names.)

> **Question 4 of 4.** Any communication preferences? Short or long
> answers, casual or formal, anything I should avoid?

Skip Q3 if the user signals the vault is personal / non-work, and skip Q4
if the user already gave a clear style signal in Q2.

## Persistence

After each answered question, route the answer through `/ingest-writing`
so it lands in the right page (don't write to the context pages
directly):

| Question  | Page                     |
| :-------- | :----------------------- |
| 1         | `wiki/about.md` — _Projects_ section, prefixed with the vault's purpose |
| 2         | `wiki/about.md` — _Identity_ section |
| 3         | `wiki/vocabulary.md` |
| 4         | `wiki/preferences.md` |

Audit and mark completion once the interview is done:

```bash
rubber-ducky log append "[onboard] completed lightweight intake (4 questions)"
rubber-ducky settings enable onboard.completed
```

The settings flip is the authoritative signal that future invocations
read on entry; the log entry is the human-readable trail.

## Paste-raw invitation

Before the hand-off, check the auto_on_onboard setting:

```bash
rubber-ducky settings get ingest.auto_on_onboard
```

If it returns `true` (the default), invite the user to paste raw material:

> Last thing — paste any writing you already have about yourself or what
> this vault is for. Old bios, performance reviews, articles, project
> docs, anything. I'll route what's useful into the right pages. (Or
> just say "skip" — you can paste any time later with `/ingest-writing`.)

If the user pastes, hand the raw text straight to `/ingest-writing`
(skill-to-skill). If they skip, move on.

If `auto_on_onboard` is `false`, skip the invitation entirely.

## Hand-off

End the session with the canonical "now what?" pointer:

> I'm rubber-ducky. Type `help` anytime to see everything I can do.

Do **not** dump the full capability list here — that's `/help`'s job.
Keep this final line a single sentence so the user lands in a clean state
and decides their own next move.

## What this skill does NOT do

- **No exhaustive interview.** Four questions, max. The plan explicitly
  treats context capture as ongoing — anything missed here gets captured
  later via paste-raw.
- **No backend wiring.** Integrations are added on demand via
  `/connect`. Don't ask about Jira / Slack / GitHub here.
- **No project / task creation.** This skill seeds context only. The user
  describes work to the Agent in normal conversation afterward.
