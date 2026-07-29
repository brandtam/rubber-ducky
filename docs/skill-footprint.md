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
| adopt | 141 |
| backend-write | 141 |
| capture | 123 |
| task-note | 122 |
| ingest | 119 |
| wrap-up | 118 |
| new-ticket | 117 |
| connect | 115 |
| meeting-note | 108 |
| onboard | 108 |
| reconcile | 105 |
| start | 99 |
| start-project | 94 |
| good-morning | 90 |
| help | 89 |
| close | 85 |
| **Total (16 skills)** | **1774 chars ≈ 443 tokens** |

The nine consolidated core skills (issue #8) cost 914 chars ≈ 228 tokens;
the five bridge-doc integration skills (issue #9) add 597 chars ≈ 149
tokens; the `adopt` lifecycle skill (UAT fixes) adds 141 chars ≈ 35 tokens;
the `task-note` mid-life update skill (issue #25) adds 122 chars ≈ 30
tokens.

## v2 baseline (`rubber-ducky-legacy`, `src/skills/`)

28 skills (asap, asap-process, remind, weekly-summary, query, lint, push,
comment, transition, link, reconcile, connect, triage, new-ticket, release,
ingest-writing, add-data-source, ubiquitous-language, code-review, grill-me,
plus the nine that survived consolidation), measured the same way:

**Total (28 skills): 2270 chars ≈ 567 tokens**

## Result

**1774 vs 2270 chars — a 22% reduction (~124 tokens saved per session),
with the full integration surface, vault lifecycle, and mid-life task
updates included.** (The nine-skill core alone was 914 vs 2270 — a 60%
reduction; the 15-skill roster before `task-note` measured 1652 chars
≈ 413 tokens.)

The consolidation that pays for it:

- asap + remind + idea-capture + asap-process → one `capture` skill
- weekly-summary → a mode of `wrap-up`
- query → the `work-historian` agent; lint → the `linter` agent (agent
  descriptions live in the agent roster, not the skill listing)
- v2's push + comment + transition + link → one `backend-write` skill;
  triage folded into `capture`; release dropped. The five integration
  skills (connect, ingest, backend-write, new-ticket, reconcile) replace
  nine backend-facing v2 skills

Discipline going forward: one line per description, written as an invocation
trigger; per-skill detail lives in reference files inside the skill directory,
loaded only on invocation.
