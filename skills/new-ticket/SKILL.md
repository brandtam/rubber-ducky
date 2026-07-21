---
name: new-ticket
description: File a brand-new ticket upstream — invoke on new ticket for, file a bug about, or create an issue for this.
---

# New Ticket

Originate work: draft locally, create in the connected tracker on approval,
then land the wiki page linked to the new ticket. (Lifting an *existing*
wiki page into a tracker is a push — /backend-write.)

## Steps

1. **Pick the target.** One bridge doc in `.rubber-ducky/integrations/` →
   use it and say so. Several → ask which. None → offer /connect and stop.
   The bridge doc must have a `create` write recipe; if it says creation is
   unsupported, stop and say so.
2. **Capture title + description.** Parse from what the user said; if too
   thin, ask one question — never an interview. Title is a tight TODO-style
   line, not a sentence.
3. **Draft** via the ticket-writer agent (it reads the vault's voice and
   preferences pages for tone). Walk the user through any NEEDS_INPUT
   placeholders one at a time; "ship it" accepts all defaults.
4. **Preview + create.** This is a `<service>.create` external write —
   follow /backend-write's preview-and-policy step, then run the bridge
   doc's create recipe. Capture the new ticket's reference and URL from the
   command output. Creation failed → stop here; no wiki page (a page
   without a backing ticket is exactly the drift this vault avoids).
5. **Land the wiki page.**
   `rubber-ducky page create task "<title>" --source <service> --ref "<ref>"`,
   set the URL ref field if the schema reserves one for this service, put
   the approved draft under `## Description`, add an `## Activity log` line
   naming the creation.
6. **Log + confirm.**
   `rubber-ducky log append "[new-ticket] <service> <ref> created via /new-ticket"`,
   then one line: `Filed <service> <ref>: [[<slug>]] — <url>`.

## Rules

- Draft first, create second, wiki last. Nothing external happens before
  the user approves the draft — and the confirm gate backs that up at the
  command layer.
- The wiki page is created only after the tracker create succeeds.
- The target comes from the connected bridge docs, never from a built-in
  service list.
