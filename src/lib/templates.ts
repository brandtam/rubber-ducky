import { stringify as yamlStringify } from "yaml";

export interface TemplateOptions {
  name: string;
  purpose: string;
}

export function generateWorkspaceMd(opts: TemplateOptions): string {
  const frontmatter = {
    name: opts.name,
    purpose: opts.purpose,
    version: "0.1.0",
    created: new Date().toISOString().split("T")[0],
    backends: [],
  };

  const body = `# ${opts.name}

${opts.purpose}

## Structure

- \`wiki/daily/\` — Daily work logs
- \`wiki/tasks/\` — Task pages (one per task)
- \`wiki/projects/\` — Project pages (groups of related tasks)
- \`raw/\` — Immutable input (screenshots, attachments)

## Configuration

Edit this file's frontmatter to configure your workspace.
See \`rubber-ducky doctor\` to verify configuration.
`;

  return `---\n${yamlStringify(frontmatter).trimEnd()}\n---\n\n${body}`;
}

export function generateClaudeMd(opts: TemplateOptions): string {
  return `# ${opts.name}

${opts.purpose}

## Workspace identity

This is a Rubber-Ducky workspace. Configuration lives in \`workspace.md\`.

## Key files

- \`workspace.md\` — Workspace configuration (YAML frontmatter)
- \`UBIQUITOUS_LANGUAGE.md\` — Controlled vocabulary for this workspace
- \`wiki/\` — The knowledge vault
  - \`wiki/daily/\` — Daily work logs (YYYY-MM-DD.md)
  - \`wiki/tasks/\` — Task pages
  - \`wiki/projects/\` — Project pages
- \`raw/\` — Immutable input files

## Language

Import and follow @UBIQUITOUS_LANGUAGE.md for all terms and conventions.

## Conventions

- All pages use YAML frontmatter + markdown body
- Task statuses: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
- Daily pages are named YYYY-MM-DD.md
- Task pages are named by slugified title
- Use \`[[wikilinks]]\` for cross-references between pages

## Commands

Use \`rubber-ducky\` CLI for mechanical operations (zero token cost).
Use Claude Code skills for intelligent operations.
`;
}

export function generateUbiquitousLanguageMd(): string {
  return `# Ubiquitous Language

Controlled vocabulary for this workspace. All team members and AI assistants
should use these terms consistently.

## Statuses

| Term | Meaning |
|------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| in-review | Awaiting review |
| pending | Waiting on external input |
| blocked | Cannot proceed |
| done | Completed |
| deferred | Postponed indefinitely |

## Page types

| Term | Meaning |
|------|---------|
| daily | A daily work log page (wiki/daily/) |
| task | A single work item page (wiki/tasks/) |
| project | A grouping of related tasks (wiki/projects/) |

## Custom terms

Add workspace-specific terms below.

<!-- Add your terms here -->
`;
}
