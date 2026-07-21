---
name: reconcile
description: Check the wiki against connected trackers — invoke on reconcile, check drift, or are we in sync.
---

# Reconcile

The wiki is the source of truth *normatively*; reality moves in the trackers
where teammates work. Reconcile is what makes the claim true: fetch,
normalize, detect drift with `rubber-ducky drift`, and let the user pick the
winner per disagreement. The tool never decides on its own.

## Phase 1 — Detect

1. **Scope.** Connected services = the bridge docs in
   `.rubber-ducky/integrations/`. Candidate pages = active task pages
   (status not `done` / `deferred`) whose `source` names a connected service
   and whose `ref` is set — enumerate with
   `rubber-ducky wiki search "<service>" --type task` (auto-JSON on pipe)
   and filter on frontmatter. If the user named a page, just that one.
2. **Fetch + normalize, per page.** Run the bridge doc's single-item fetch
   recipe, then build a flat JSON object containing only the fields the
   bridge doc maps, with field names and values normalized per its Field
   mappings and Status normalization tables (statuses in vault vocabulary).
   Normalization happens HERE — drift is a pure structural diff and gives
   no leniency.
3. **Diff.** Write the object to a temp file and run
   `rubber-ducky drift <page> --incoming <file>`. Exit 0 = in sync; exit 7 =
   drift, with a per-field `disagreements` report on stdout; exit 2 = your
   payload was malformed (fix it and re-run); exit 3 = page or frontmatter
   missing (surface it, move on).
4. **Fetch failed** for a page → report it as unreachable and move on;
   unreachable is not drift.
5. **Nothing drifted** → `No drift across N page(s), M service(s).` Stop.

## Phase 2 — Resolve, one page at a time

If several pages drifted, summarize the shape first ("Three pages drifted:
two statuses moved upstream, one assignee changed"), then walk pages one at
a time — never batch choices across pages. Per disagreement (or per page
when the user says "all of it"), show it in plain language — `status: wiki
says in-progress, <service> says done` — and offer three moves:

- **(t) Accept theirs** — the tracker is right. Apply the incoming value
  with `rubber-ducky frontmatter set <page> <field> <value>` (use
  `rubber-ducky task close <page>` when the incoming status is `done`),
  stamp `updated`, and add an activity-log line
  `reconciled <field> from <service>`.
- **(w) Accept wiki** — the wiki is right; the tracker catches up. This is
  a `<service>.<verb>` external write: compose it from the bridge doc's
  write recipe (status translated wiki→service through its normalization
  table) and follow /backend-write's preview-and-policy step. If the bridge
  doc has no write recipe for that field, say so — the fix upstream is
  manual.
- **(s) Skip** — change nothing, run nothing. The drift re-surfaces on the
  next run; there is no skip-with-memory, ever — a hidden disagreement is
  how a source of truth rots.

## Phase 3 — Summary

One line: `Reconciled N page(s): X took theirs, Y kept wiki, Z skipped.`
Then `rubber-ducky log append "[reconcile] <that line>"`.

## Rules

- The user picks every winner. "Just sync it" → ask which side wins.
- A disagreement caused by sloppy normalization is your bug: fix the
  payload (and the bridge doc's table), don't ask the user to arbitrate
  spelling.
- Bodies are out of scope — reconcile compares frontmatter only; body
  divergence is a manual merge. Flag it and move on.
- Good moments to *offer* (never force) a run: the morning brief, wrap-up.
