import { stringify as yamlStringify } from "yaml";

export interface BackendConfig {
  type: "github" | "jira" | "asana";
  mcp_server: string;
  server_url?: string;
  project_key?: string;
  workspace_id?: string;
}

export interface VocabularyOptions {
  brands?: string[];
  teams?: string[];
  labels?: string[];
}

export interface TemplateOptions {
  name: string;
  purpose: string;
  backends?: BackendConfig[];
}

export function generateWorkspaceMd(opts: TemplateOptions): string {
  const backends = (opts.backends ?? []).map((b) => {
    const entry: Record<string, string> = {
      type: b.type,
      mcp_server: b.mcp_server,
    };
    if (b.server_url) entry.server_url = b.server_url;
    if (b.project_key) entry.project_key = b.project_key;
    if (b.workspace_id) entry.workspace_id = b.workspace_id;
    return entry;
  });

  const frontmatter = {
    name: opts.name,
    purpose: opts.purpose,
    version: "0.1.0",
    created: new Date().toISOString().split("T")[0],
    backends,
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

/**
 * Generate backend-specific skill files for Claude Code.
 * Returns an array of { path, content } for each skill to create.
 */
export function generateBackendSkills(
  backends?: BackendConfig[]
): Array<{ path: string; content: string }> {
  if (!backends || backends.length === 0) return [];

  const skills: Array<{ path: string; content: string }> = [];

  for (const backend of backends) {
    if (backend.type === "asana") {
      skills.push({
        path: ".claude/commands/ingest-asana.md",
        content: generateIngestAsanaSkill(backend),
      });
    }
  }

  return skills;
}

function generateIngestAsanaSkill(config: BackendConfig): string {
  const workspaceIdNote = config.workspace_id
    ? `Default workspace ID: \`${config.workspace_id}\`\n\n`
    : "";

  return `# Ingest Asana Task

Ingest an Asana task into the wiki as a task page.

${workspaceIdNote}## Usage

\`\`\`
/ingest-asana <task-id-or-url>
\`\`\`

## Steps

1. Run \`rubber-ducky backend check asana\` to verify connectivity
2. Use the Asana MCP server to fetch the task by ID or URL
3. Run \`rubber-ducky page create task "<title>" --source asana --ref <task-gid>\` to scaffold the page
4. Update the page frontmatter with fields from the Asana task:
   - \`asana_ref\`: The Asana permalink URL
   - \`status\`: Mapped from Asana section/completion state
   - \`assignee\`: From Asana assignee
   - \`due\`: From Asana due date
   - \`tags\`: From Asana tags
5. Write the task description and comments into the page body
6. Run \`rubber-ducky index rebuild\` to update the index

## Bulk ingest

To ingest all tasks from a project: \`/ingest-asana project:<project-gid>\`
To ingest all tasks from a section: \`/ingest-asana section:<section-gid>\`
`;
}

export function generateUbiquitousLanguageMd(vocabulary?: VocabularyOptions): string {
  const sections: string[] = [];

  sections.push(`# Ubiquitous Language

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
| project | A grouping of related tasks (wiki/projects/) |`);

  if (vocabulary?.brands && vocabulary.brands.length > 0) {
    sections.push(`\n## Brands\n\n| Term |\n|------|\n${vocabulary.brands.map((b) => `| ${b} |`).join("\n")}`);
  }

  if (vocabulary?.teams && vocabulary.teams.length > 0) {
    sections.push(`\n## Teams\n\n| Term |\n|------|\n${vocabulary.teams.map((t) => `| ${t} |`).join("\n")}`);
  }

  if (vocabulary?.labels && vocabulary.labels.length > 0) {
    sections.push(`\n## Labels\n\n| Term |\n|------|\n${vocabulary.labels.map((l) => `| ${l} |`).join("\n")}`);
  }

  sections.push(`\n## Custom terms

Add workspace-specific terms below.

<!-- Add your terms here -->
`);

  return sections.join("\n");
}
