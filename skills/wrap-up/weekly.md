# Weekly mode — curated weekly summary

A bulleted summary of work completed since the last summary plus work genuinely
in flight, saved to `wiki/weekly/<period-end>.md` and rendered in chat.

## Period

Last summary → today, **not** the calendar week. Find the most recent file in
`wiki/weekly/`; the period starts the day after its `period_end` frontmatter.
No prior file → the last 7 days.

**Same-day rerun is an amend.** If the most recent weekly file's `period_end`
is already today, don't compute a new period (it would invert — start after
end) and don't scaffold a second page. Reuse that file's `period_start`, update
the existing file in place (Read + Edit), and skip step 3 below.

## Source material

Read in parallel: every daily page in the period, task frontmatter for anything
`in-progress` / `in-review` / `blocked`, and the previous weekly file for tone.

## Structure

Two top-level sections, each split into **Theme** and **Admin**:

1. **Completed & In Review since last summary**
2. **In Progress and Upcoming**

- **Theme** = tasks with an external ref (`jira_ref`, `asana_ref`, `gh_ref`).
- **Admin** = wiki-only tasks (`source: internal` or no ref).

The split is derived from frontmatter — never ask the user which bucket.
An empty Theme section (no refs in the vault) is fine.

Subsection headings always carry the parent context: `### Theme — Completed`,
`### Admin — In Review`, `### Theme — In Progress and Upcoming`, etc. Never bare
`### Theme`. Tasks with `status: in-review` are real progress: they go under
**Completed & In Review**, once, and are never duplicated under Upcoming.

## Curation rules

**Do not dump the backlog.** Aim for ~6–10 Theme and ~8–12 Admin items in "In
Progress and Upcoming"; 15+ in either means you're listing too much.

Include: in-progress / in-review items; actively-escalated blocked items;
carry-forwards named in recent dailies; items due within ~2 weeks. Exclude:
unmoved backlog items, parked/waiting items, anything owned by someone else
with no user touchpoint. When in doubt, leave it out.

Each bullet: `[[wikilink]] — <why it matters> ; <where it stands>` in one short
clause. No diff stats, no roadmap, no implementation notes — but not so pruned
that the bullet says nothing the title didn't.

## Procedure

1. Determine the period (above) — including whether this is a same-day amend.
2. Build both sections from the dailies and task frontmatter.
3. Scaffold: `rubber-ducky page create weekly --period-start <start> --period-end <end>`
   (skip on a same-day amend — the file already exists).
4. Write the content into the file (Read + Edit).
5. `rubber-ducky index rebuild`
6. `rubber-ducky log append "[wrap-up weekly] <start> → <end>. Theme: <N> done, <M> upcoming. Admin: <N> done, <M> upcoming."`
   (on an amend, note it: `[wrap-up weekly amended] ...`).
7. Render the summary in chat — the file is canonical; the chat copy is a read-back.
