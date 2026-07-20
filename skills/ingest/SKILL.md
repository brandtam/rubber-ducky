---
name: ingest
description: Pull an external ticket into the wiki — invoke on ingest issue 42, pull in that ticket, or import from a tracker.
---

# Ingest

Land one external ticket as a typed wiki task page. Everything
service-specific comes from the bridge doc — this flow is identical for
GitHub, Jira, or a homegrown tracker.

## Steps

1. **Resolve the integration.** Work out which service the reference belongs
   to and read `.rubber-ducky/integrations/<service>.md`. No bridge doc →
   offer /connect and stop.
2. **Fetch.** Run the bridge doc's single-item fetch recipe with its
   structured-output flag. On failure, surface the error (auth? check per
   the bridge doc's Auth section) and stop — never create a page from a
   failed fetch.
3. **Dedup.** `rubber-ducky wiki search "<ref>" --type task` (auto-JSON on
   pipe); if a page already carries this ref, offer a refresh of that page
   (that's /reconcile's job) instead — never create a second page.
4. **Create the page.**
   `rubber-ducky page create task "<title>" --source <service> --ref "<ref>"`
   — `ref` in exactly the bridge doc's canonical reference form.
5. **Map frontmatter.** Apply the bridge doc's Field mappings and Status
   normalization via `rubber-ducky frontmatter set <file> <field> <value>`
   (`rubber-ducky frontmatter array add <file> tags <value>` for array
   fields): at minimum the normalized `status`; also `priority` /
   `assignee` / `due` / `tags` where mapped. If the schema reserves a URL ref field for this
   service (`gh_ref` / `jira_ref` / `asana_ref` — check
   `references/frontmatter-templates.md`), set it to the item's URL.
6. **Body.** Ticket description → `## Description`; useful links and
   surrounding context → `## Context`; comments (only if the fetch recipe
   returns them) summarized under `## Comments`. Add the ingest line to
   `## Activity log`.
7. **Verify + log.** `rubber-ducky frontmatter validate <file> --type task`,
   then
   `rubber-ducky log append "[ingest] <service> <ref> -> wiki/tasks/<slug>.md"`.
8. **Confirm in one line** — `Ingested <service> <ref>: [[<slug>]] (<status>).`

## Rules

- Ingest is read-only against the service — no external writes, ever.
- Statuses land normalized, never raw. A service status with no row in the
  bridge doc's table → ask the user once, then add the row to the bridge doc
  so it's never asked again.
- Bulk ("pull in my open tickets") = the bridge doc's list recipe, then this
  flow per item; end with a one-line tally.
