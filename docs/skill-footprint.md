# Skill-listing context footprint

Every skill's `name` + `description` is injected into context in every session
so Claude can decide when to invoke it — the roster's listing size is a
permanent per-session tax. This doc tracks that cost for the v3 roster against
the v2 baseline. Tokens are approximated as characters / 4.

Measurement: sum of `len(name) + len(description)` over each roster's
`SKILL.md` frontmatter. Re-measure with:

```sh
cd skills && total=0; for d in */; do n="${d%/}"; \
  desc=$(sed -n 's/^description: *//p' "$d/SKILL.md" | head -1); \
  total=$((total + ${#n} + ${#desc})); done; echo "$total chars (~$((total/4)) tokens)"
```

## v3 roster (this repo, `skills/`)

| Skill | name+description chars |
| :--- | ---: |
| capture | 123 |
| wrap-up | 118 |
| meeting-note | 108 |
| onboard | 108 |
| start | 99 |
| start-project | 94 |
| good-morning | 90 |
| help | 89 |
| close | 85 |
| **Total (9 skills)** | **914 chars ≈ 228 tokens** |

## v2 baseline (`rubber-ducky-legacy`, `src/skills/`)

28 skills (asap, asap-process, remind, weekly-summary, query, lint, push,
comment, transition, link, reconcile, connect, triage, new-ticket, release,
ingest-writing, add-data-source, ubiquitous-language, code-review, grill-me,
plus the nine that survived consolidation), measured the same way:

**Total (28 skills): 2270 chars ≈ 567 tokens**

## Result

**914 vs 2270 chars — a 60% reduction (~339 tokens saved per session).**

The consolidation that pays for it:

- asap + remind + idea-capture + asap-process → one `capture` skill
- weekly-summary → a mode of `wrap-up`
- query → the `work-historian` agent; lint → the `linter` agent (agent
  descriptions live in the agent roster, not the skill listing)
- backend-facing skills (push, comment, transition, link, reconcile, connect,
  triage, new-ticket, release) are not part of the v3 core roster (issue #9
  owns backend-write surfaces)

Discipline going forward: one line per description, written as an invocation
trigger; per-skill detail lives in reference files inside the skill directory,
loaded only on invocation.
