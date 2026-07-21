---
name: start-project
description: Create a project page — invoke when the user says start a project or new project.
---

# Start Project

Create a project page and seed its description. Lightweight — page creation
plus a clean exit, nothing more.

## Steps

1. **Create the page** — `rubber-ducky page create project "<title>"` and
   capture the slug from the output (`path` ends in `<slug>.md`).
2. **Seed the description** — suggest a one-line description from the title
   (e.g. "Personal finances" → *"Track spending, accounts, and monthly
   review."*). Ask the user to accept or edit, then write the chosen line under
   `## Description` with the Edit tool.
3. **Point forward** — mention that tasks and meetings can attach to the
   project via `--project <slug>`, then exit. Don't interview about scope or
   goals — the user will describe work in normal conversation.

## Output

New project page at `wiki/projects/<slug>.md` with a seeded description.
