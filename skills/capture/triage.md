# Triage mode — walk the captured lists

Interactive, one item at a time. Progress is saved as you go — stopping partway
is safe.

## Which list

Default to the ASAP list. If the user named reminders or ideas, walk that list
instead — same flow, with the CLI swapped (`remind list` / `remind resolve`;
`idea list` — ideas have no resolve verb, so "dismiss" means removing the line
from `wiki/ideas.md` with the Edit tool, and "convert" means creating the task
then removing the line).

## Flow

1. **Load** — `rubber-ducky asap list --json`; filter to `resolved: false`.
   Show a numbered summary `(N pending)`. None pending? Say so and stop. If the
   user gave a starting index, skip items below it.
2. **Walk items one at a time**, each with four options — wait for the choice:

   ```
   [N/total] #<index> — <message>  (added <date>)
     (a) Act on it now       (c) Convert to task
     (d) Defer — keep listed (x) Dismiss — resolve and drop
   ```

3. **Execute**:
   - **Act** — stop triage: "Switching to this item. Say 'process my list'
     again to resume from #<next-index>."
   - **Convert** — `rubber-ducky page create task "<message>"`, then
     `rubber-ducky asap resolve <index>`.
   - **Defer** — no action; move on.
   - **Dismiss** — `rubber-ducky asap resolve <index>`.

4. **Finish** — summarize: acted / converted / deferred / dismissed counts.
