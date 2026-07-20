# Frontmatter Templates

Single source of truth for all page frontmatter schemas in this workspace.
Reference this file with `@references/frontmatter-templates.md` in skills and agents.

## Daily page

File location: `wiki/daily/YYYY-MM-DD.md`

```yaml
---
title: "2026-04-12"           # The date string (required)
type: daily                    # Always "daily" (required)
created: 2026-04-12T08:00:00Z # ISO timestamp (required)
updated: 2026-04-12T08:00:00Z # ISO timestamp, updated on changes
active_task: fix-auth-timeout  # Slug of the current focus task, or null
morning_brief: false           # Set to true after /good-morning runs
wrap_up: false                 # Set to true after /wrap-up runs
tasks_touched:                 # Array of task slugs worked on today
  - fix-auth-timeout
  - update-api-docs
---
```

### Body sections

```markdown
## Focus
## Work log
## Completed today
## Carried over
## Notes & context
## Blockers
```

## Task page

File location: `wiki/tasks/<slugified-title>.md`

```yaml
---
title: Fix auth timeout         # Human-readable title (required)
type: task                      # Always "task" (required)
ref: "42"                       # External reference ID (issue number, task ID), or null
source: github                  # Backend that originated this task, or null
status: backlog                 # One of: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
priority: null                  # Free-form (high, medium, low, asap), or null
assignee: null                  # Person assigned, or null
tags: []                        # Array of labels/tags
created: 2026-04-12T10:00:00Z  # ISO timestamp (required)
updated: 2026-04-12T14:30:00Z  # ISO timestamp, updated on changes
closed: null                    # ISO timestamp when task was completed, or null
pushed: null                    # ISO timestamp when pushed to external backend, or null
due: null                       # Due date (YYYY-MM-DD string), or null
jira_ref: null                  # Jira ticket URL, or null
asana_ref: null                 # Asana task URL, or null
gh_ref: null                    # GitHub issue/PR URL, or null
jira_needed: null               # Triage state: yes (Jira ticket exists), no (not needed), null (untriaged). Asana-sourced pages only.
comment_count: 0                # Number of comments synced from backend
---
```

### Body sections

```markdown
## Description
## Context
## Comments
## Activity log
## See also
```

## Project page

File location: `wiki/projects/<slugified-title>.md`

```yaml
---
title: API v2                   # Human-readable title (required)
type: project                   # Always "project" (required)
created: 2026-04-12T10:00:00Z  # ISO timestamp (required)
updated: 2026-04-12T10:00:00Z  # ISO timestamp, updated on changes
status: backlog                 # Same status vocabulary as tasks
tags: []                        # Array of labels/tags
---
```

### Body sections

```markdown
## Description
## Tasks
## Notes
```

## Valid statuses

| Status | Meaning |
|--------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| in-review | Awaiting review |
| pending | Waiting on external input |
| blocked | Cannot proceed |
| done | Completed |
| deferred | Postponed indefinitely |

## Naming conventions

- **Daily pages**: Named by date — `YYYY-MM-DD.md`
- **Task pages**: Slugified title — lowercase, hyphens for spaces, no special characters (e.g., "Fix Auth Timeout" → `fix-auth-timeout.md`)
- **Project pages**: Same slugification as tasks
- **Wikilinks**: Use `[[slugified-name]]` to cross-reference between pages
