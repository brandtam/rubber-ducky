---
name: backend-write
description: Write back to a connected tracker — invoke on comment on the ticket, close it upstream, push this task out, or link two tickets.
---

# Backend Write

Every external write runs through this one flow: comment, transition
(status / close), update fields, push a wiki page out as a new ticket, link
two tickets. Compose from the bridge doc, preview, honor the confirm
policy, stamp the wiki after.

## Steps

1. **Resolve page + service.** Read the task page; its `source` / `ref` (or
   its service URL ref field) names the service. Read
   `.rubber-ducky/integrations/<service>.md`. No bridge doc → offer /connect
   and stop. Page has no ref yet → this is a **push**: the write recipe is
   `create`, and the content is drafted by the ticket-writer agent first.
2. **Compose the exact command** from the bridge doc's write recipe, with
   statuses translated wiki→service through its Status normalization table.
   The command must match a registered `<service>.<verb>` line in
   `.rubber-ducky/write-patterns`; if no pattern covers this shape, stop and
   register one (or re-run /connect) before writing.
   <!-- CANONICAL COPY: this preview-and-policy step (and the
        authored-prose-is-never-auto rule under Rules) is inlined verbatim
        in skills/new-ticket/SKILL.md and skills/reconcile/SKILL.md, whose
        contexts do not include this file. Edit all three together. -->
3. **Preview, then honor the policy.** Read
   `rubber-ducky settings get confirm.<service>.<verb>`:
   - `auto` — state what you're doing in one line and run it; the gate
     allows the command without a dialog.
   - `manual`, `preview`, or unset (default is `preview`) — show the preview
     below and run only after the user says yes. The PreToolUse gate
     additionally routes the command through the permission dialog — that
     dialog is the enforcement; your preview is what makes it a rubber
     stamp instead of a surprise.

   ```
   WRITE PREVIEW — <service>.<verb>
   Target:  <ref> (<title>)
   Command: <exact command>
   Content: <the body / status / fields being written>
   ```
4. **Run it.** On failure: report the error, change nothing in the wiki,
   never retry silently.
5. **Stamp the wiki** (only after the write succeeds) — one composite call:

   ```
   rubber-ducky task stamp-write <file> \
     --activity "<one-line summary of the write>" \
     --log "[backend-write] <service>.<verb> <ref> — <summary>"
   ```

   plus the verb's flags:
   - create / push → `--set source=<service> --set ref="<ref>"
     --set <url-ref-field>=<url> --pushed`;
   - transition → `--status <status>` (`done` runs the full task-close flow:
     closed date, daily page, log);
   - comment → `--bump-comments`.

   `updated` is stamped automatically on every call.
6. **Link** (relate two tickets) = two comment writes — one per ticket, each
   previewed and gated per step 3, cross-referencing URLs only — plus
   `## See also` wikilinks on both wiki pages. If the bridge doc documents a
   native link recipe, prefer it over comments.

## Rules

- Nothing external runs before the preview unless the policy is `auto` —
  and `auto` covers mechanical writes (status flips, URL back-links), not
  authored prose: drafted comment or ticket text is always shown to the
  user before posting, whatever the policy says.
- Never restructure a command to dodge a write pattern (no `bash -c`
  wrapping, no aliases, no here-doc detours). If the gate blocks, that is
  the user's answer.
- One confirmation covers one external call; a flow with two calls (link)
  previews each.
- The wiki is stamped only on success — a failed external call must leave
  the page exactly as it was.
