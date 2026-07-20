---
name: meeting-note
description: File a structured meeting page — invoke on meeting note, log this meeting, or after the meeting.
---

# Meeting Note

Capture a substantive meeting as a structured wiki page. One-line standups
belong inline on the daily page; a standalone page is for meetings with
multiple decisions or action items, external attendees, or notes worth
referencing later.

## Steps

1. **Gather metadata** — ask only for what wasn't already provided: title,
   date (default today), start/end times (optional), attendees, project slug
   (optional).
2. **Create the page**:

   ```
   rubber-ducky page create meeting "<title>" --date <YYYY-MM-DD> \
     --start <HH:MM> --end <HH:MM> --attendees "<names>" --project <slug>
   ```

   Omit flags the user didn't supply. The page lands in `wiki/meetings/` with
   Agenda / Notes / Decisions / Action items / Related sections.
3. **Fill the body** with the Edit tool — verbatim quotes for key moments, one
   bullet per decision, `- [ ]` per action item with assignee. Then ask:
   "Convert any action items to tasks?" — on yes,
   `rubber-ducky page create task "<item>"` for each.
4. **Cross-link** — append `- Discussed in [[<meeting page>|<title>]]` to the
   activity log of any task the meeting touched; add the meeting wikilink to
   the project page if one was given.
5. **Daily page** — add one line to today's daily page:
   `- **<HH:MM>–<HH:MM>** — [[<meeting page>|<title>]] — <one-line takeaway>`

## Output

Confirm where the page was saved and whether any action items became tasks.
