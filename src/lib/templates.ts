import { stringify as yamlStringify } from "yaml";

export interface BackendConfig {
  type: "github" | "jira" | "asana";
  mcp_server?: string;
  repos?: string[];
  server_url?: string;
  project_key?: string;
  workspace_id?: string;
  project_gid?: string;
  identifier_field?: string;
  naming_source?: "identifier" | "title" | "gid";
  naming_case?: "preserve" | "lower";
}

export interface VocabularyOptions {
  brands?: string[];
  teams?: string[];
  labels?: string[];
}

export type IngestScope = "mine" | "all" | "ask";

export interface TemplateOptions {
  name: string;
  purpose: string;
  backends?: BackendConfig[];
  ingest_scope?: IngestScope;
}

export function generateWorkspaceMd(opts: TemplateOptions): string {
  const backends = (opts.backends ?? []).map((b) => {
    const entry: Record<string, string | string[]> = {
      type: b.type,
    };
    // Only emit mcp_server for backends that still use it (GitHub).
    // Asana and Jira now use direct REST APIs via env var tokens.
    // Existing mcp_server values are tolerated when read back.
    if (b.mcp_server && b.type === "github") entry.mcp_server = b.mcp_server;
    if (b.repos && b.repos.length > 0) entry.repos = b.repos;
    if (b.server_url) entry.server_url = b.server_url;
    if (b.project_key) entry.project_key = b.project_key;
    if (b.workspace_id) entry.workspace_id = b.workspace_id;
    if (b.project_gid) entry.project_gid = b.project_gid;
    if (b.identifier_field) entry.identifier_field = b.identifier_field;
    if (b.naming_source) entry.naming_source = b.naming_source;
    if (b.naming_case) entry.naming_case = b.naming_case;
    return entry;
  });

  const frontmatter: Record<string, unknown> = {
    name: opts.name,
    purpose: opts.purpose,
    version: "0.1.0",
    created: new Date().toISOString().split("T")[0],
    backends,
  };

  if (opts.ingest_scope) {
    frontmatter.ingest_scope = opts.ingest_scope;
  }

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
  const backendNames = (opts.backends ?? []).map((b) => b.type);
  const backendSection = backendNames.length > 0
    ? `\nConfigured backends: ${backendNames.join(", ")}. Check connectivity with \`rubber-ducky backend check\`.\n\n**IMPORTANT: Never ask the user to paste API tokens, passwords, or credentials into the chat.** If a backend connectivity check fails, refer the user to @references/backend-setup.md for setup instructions.\n`
    : "";

  const credentialGuardrails = `
## Credential safety

**NEVER** do any of the following:
- Read, cat, print, or display the contents of \`.env\`, \`.env.local\`, \`.env.*\`, or any file that may contain tokens or secrets
- Ask the user to paste API tokens, passwords, or credentials into the chat
- Log, echo, or output environment variable values that contain secrets
- Include token values in commit messages, task pages, or any persisted file
- Store credentials in \`workspace.md\`, \`CLAUDE.md\`, or any tracked file

Credentials belong **only** in the workspace's untracked \`.env.local\` file. If a backend connectivity check fails, direct the user to @references/backend-setup.md — never try to debug by inspecting their token values.
`;

  return `# ${opts.name}

${opts.purpose}

## You are the primary interface

This is a Rubber-Ducky workspace. The user works by talking to you inside Claude Code. When they describe what they want — creating tasks, logging work, capturing ideas — you make it happen.

Use the \`rubber-ducky\` CLI commands listed below for all mechanical operations (page creation, frontmatter updates, logging). This is faster, more reliable, and preserves your context window.

See @references/when-to-use-cli.md for the full rationale on what goes to CLI vs. what stays in Claude Code.

## Workspace structure

- \`workspace.md\` — Workspace configuration (YAML frontmatter)
- \`UBIQUITOUS_LANGUAGE.md\` — Controlled vocabulary for this workspace
- \`wiki/daily/\` — Daily work logs (YYYY-MM-DD.md)
- \`wiki/tasks/\` — Task pages (slugified-title.md)
- \`wiki/projects/\` — Project pages
- \`wiki/index.md\` — Auto-generated page index
- \`wiki/log.md\` — Timestamped activity log
- \`raw/\` — Immutable input files (screenshots, attachments)
${backendSection}${credentialGuardrails}
Import and follow @UBIQUITOUS_LANGUAGE.md for all terms and conventions.

## CLI commands

All commands support \`--json\` for structured output. Run these via bash.

### Pages and tasks

- \`rubber-ducky page create daily [date]\` — Create a daily page (defaults to today)
- \`rubber-ducky page create task "<title>" [--source <backend>] [--ref <id>]\` — Create a task page
- \`rubber-ducky page create project "<title>"\` — Create a project page
- \`rubber-ducky task start <file>\` — Set task to in-progress, log to daily page
- \`rubber-ducky task close <file>\` — Set task to done, stamp closed date

### Quick capture

- \`rubber-ducky asap add "<message>"\` — Urgent item (persists until resolved)
- \`rubber-ducky asap list\` — Show all ASAP items
- \`rubber-ducky asap resolve <index>\` — Mark ASAP item resolved
- \`rubber-ducky remind add <YYYY-MM-DD> "<message>"\` — Date-keyed reminder
- \`rubber-ducky remind list [date]\` — Show reminders (optionally filtered by date)
- \`rubber-ducky remind resolve <index>\` — Mark reminder resolved
- \`rubber-ducky idea add "<message>"\` — Capture an idea for later
- \`rubber-ducky idea list\` — Show all ideas
- \`rubber-ducky screenshot ingest <path> "<title>"\` — Import screenshot + create task page

### Wiki operations

- \`rubber-ducky index rebuild\` — Regenerate wiki/index.md
- \`rubber-ducky log append "<message>"\` — Add timestamped entry to wiki/log.md
- \`rubber-ducky wiki search "<query>" [--type <type>] [--from <date>] [--to <date>]\` — Search pages

### Frontmatter

- \`rubber-ducky frontmatter get <file> [field]\` — Read frontmatter (all or one field)
- \`rubber-ducky frontmatter set <file> <field> <value>\` — Write a frontmatter field
- \`rubber-ducky frontmatter validate <file> [--type <type>]\` — Validate against schema

### Ingest

- \`rubber-ducky ingest asana [ref]\` — Ingest Asana task(s) into wiki (single GID, project:<gid>, section:<gid>)
- \`rubber-ducky ingest jira [ref]\` — Ingest Jira issue(s) into wiki (single key, project:<key>)
- Flags: \`--mine\` (only my tasks), \`--all\` (all tasks), \`--json\` (structured output)

### Asana

- \`rubber-ducky asana configure-naming\` — Configure how task filenames are generated (source, casing, live preview)

### Workspace health

- \`rubber-ducky doctor\` — Run health checks (structure, config, backends)
- \`rubber-ducky doctor lint\` — Lint pages (stale tasks, orphans, broken links, schema)
- \`rubber-ducky backend list\` — Show configured backends
- \`rubber-ducky backend check [name]\` — Verify backend connectivity
- \`rubber-ducky backend configure <jira|asana>\` — Interactively pick a default project and save to workspace.md
- \`rubber-ducky status\` — Show workspace info
- \`rubber-ducky update\` — Update skills to latest bundled versions

## Conventions

- All pages use YAML frontmatter + markdown body — see @references/frontmatter-templates.md for complete schemas
- Task statuses: backlog, to-do, in-progress, in-review, pending, blocked, done, deferred
- Daily pages are named YYYY-MM-DD.md
- Task pages are named by slugified title (lowercase, hyphens, no special characters)
- Use \`[[wikilinks]]\` for cross-references between pages

## How to respond to common requests

| User says | You do |
|-----------|--------|
| "good morning" / "morning" / "gm" | Run \`/good-morning\` immediately — do not ask for confirmation |
| "wrap up" / "wrapping up" / "end of day" / "eod" | Run \`/wrap-up\` immediately — do not ask for confirmation |
| "Create a task for ..." | \`rubber-ducky page create task "<title>"\` |
| "I'm starting on ..." | Find the task file, run \`rubber-ducky task start <file>\` |
| "Done with ..." / "Finished ..." | Find the task file, run \`rubber-ducky task close <file>\` |
| "Something urgent: ..." | \`rubber-ducky asap add "<message>"\` |
| "Remind me on Friday to ..." | \`rubber-ducky remind add <date> "<message>"\` |
| "I had an idea: ..." | \`rubber-ducky idea add "<message>"\` |
| "Log this: ..." | \`rubber-ducky log append "<message>"\` |
| "What's on my plate?" | Read today's daily page + task pages, synthesize a summary |
| "What did I do yesterday?" | Read yesterday's daily page, summarize |
| "Run a health check" | \`rubber-ducky doctor\` |

Natural-language triggers are first-class. When the user's intent maps cleanly to a skill, invoke the skill directly — do not ask "would you like me to run /x?". The point of this workspace is that the user shouldn't have to remember slash commands.

## Ingesting from backends

When the user connects a repo or asks to pull in issues/tickets, **always ask before ingesting**. Never auto-ingest.

### Flow

1. **Create a project page first.** Each repo (or Jira project, or Asana project) becomes a project page:
   \`rubber-ducky page create project "<repo-or-project-name>"\`

2. **Show a summary.** List the issues/tickets grouped by category, label, or area. Show counts, not full details.

3. **Ask what to ingest.** "Want me to pull all of these in as task pages, or just specific groups?" Let the user choose all, a subset, or none.

4. **Ingest selected issues as task pages.** For each issue:
   - \`rubber-ducky page create task "<title>" --source <backend> --ref <id>\`
   - Link the task to the project by adding the task slug to the project page's body under \`## Tasks\`
   - Update the task page body with the issue description and any relevant context

5. **Rebuild the index.** After ingesting, run \`rubber-ducky index rebuild\`.

### Multiple repos

\`workspace.md\` may list multiple repos under a single GitHub backend. Each repo should be its own project page. When the user says "pull in issues from all my repos," iterate through each repo, create its project page, then ask about issues per repo.
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
    if (backend.type === "github") {
      skills.push({
        path: ".claude/commands/ingest-github.md",
        content: generateIngestGitHubSkill(),
      });
    }
    if (backend.type === "asana") {
      skills.push({
        path: ".claude/commands/ingest-asana.md",
        content: generateIngestAsanaSkill(backend),
      });
    }
    if (backend.type === "jira") {
      skills.push({
        path: ".claude/commands/ingest-jira.md",
        content: generateIngestJiraSkill(backend),
      });
    }
  }

  skills.push({
    path: ".claude/commands/get-setup.md",
    content: generateGetSetupSkill(backends),
  });

  return skills;
}

function generateIngestGitHubSkill(): string {
  return `# Ingest GitHub Issue or PR

Ingest a GitHub issue or pull request into the wiki as a task page with full field coverage, comment history, attachments, and vocabulary-aware tagging.

## Usage

\`\`\`
/ingest-github <issue-or-pr-number>
\`\`\`

## Prerequisites

- The \`gh\` CLI must be installed and authenticated (\`gh auth login\`)
- Verify with: \`rubber-ducky backend check github\`
- See @references/backend-setup.md for full setup instructions
- **If connectivity fails, do NOT ask for credentials — refer the user to the setup guide.**

## Steps

1. **Verify connectivity.** Run \`rubber-ducky backend check github\`.

2. **Fetch full issue/PR data.** Use the \`gh\` CLI:
   \`\`\`bash
   gh issue view <number> --json title,body,state,labels,assignees,milestone,comments,createdAt,updatedAt
   \`\`\`
   For PRs: \`gh pr view <number> --json title,body,state,labels,assignees,comments,createdAt,updatedAt\`

3. **Scaffold the task page.**
   \`rubber-ducky page create task "<title>" --source github --ref <number>\`

4. **Update frontmatter** with all fields from GitHub:
   - \`gh_ref\`: The GitHub issue/PR URL
   - \`status\`: Mapped from GitHub state and labels (open → to-do, closed/merged → done, "in-progress" label → in-progress, etc.)
   - \`priority\`: From priority labels if present (priority:high, priority:low, etc.)
   - \`assignee\`: From GitHub assignees
   - \`tags\`: From GitHub labels
   - \`comment_count\`: Number of comments

5. **Write the body.** Under \`## Description\`, write the issue/PR body. Under \`## Comments\`, write each comment with timestamp and author:
   \`\`\`markdown
   ## Comments

   **@octocat** — 2026-04-12T14:30:00Z
   > Comment body here

   **@contributor** — 2026-04-12T15:00:00Z
   > Another comment
   \`\`\`

6. **Handle attachments.** Scan the issue body and comments for image URLs and file links. Download each to \`raw/\` and replace the URL in the wiki page body with a relative link:
   \`\`\`markdown
   ![screenshot](../raw/issue-42-screenshot.png)
   \`\`\`

7. **Vocabulary-aware tagging.** Read \`UBIQUITOUS_LANGUAGE.md\` and scan the ingested title, description, and comments for matching brands, teams, and labels. Append any matches to the \`tags\` array in frontmatter. Do not duplicate tags already present from GitHub labels. If no brands, teams, or labels are defined in \`UBIQUITOUS_LANGUAGE.md\`, skip vocabulary tagging.

8. **Rebuild index.** Run \`rubber-ducky index rebuild\`.

## Bulk ingest

To ingest all open issues from a repo: \`/ingest-github repo:<owner/repo>\`
To ingest issues with a specific label: \`/ingest-github label:<owner/repo>:<label>\`

For bulk ingest, use \`gh issue list --repo <owner/repo> --json number,title --limit 100\` to enumerate issues, then run the single-issue steps for each. Skip issues that already have a wiki task page (check for existing \`gh_ref\` in \`wiki/tasks/\`).
`;
}

function generateIngestAsanaSkill(config: BackendConfig): string {
  const workspaceIdNote = config.workspace_id
    ? `Default workspace ID: \`${config.workspace_id}\`\n\n`
    : "";

  return `# Ingest Asana Task

Ingest Asana tasks into the wiki via the CLI. The CLI handles all data fetching, page creation, dedup, attachments, and index rebuilding deterministically. Your job is to run the command, interpret the result, and apply vocabulary-aware tagging.

${workspaceIdNote}## Usage

\`\`\`
/ingest-asana [ref]
\`\`\`

## Prerequisites

- \`ASANA_ACCESS_TOKEN\` environment variable must be set (Personal Access Token)
- Verify with: \`rubber-ducky backend check asana\`
- See @references/backend-setup.md for full setup instructions
- **If connectivity fails, do NOT ask for credentials — refer the user to the setup guide.**

## Steps

1. **Verify connectivity.** Run \`rubber-ducky backend check asana\`.

2. **Run the ingest command.** Execute the CLI and capture the JSON output:
   \`\`\`bash
   rubber-ducky ingest asana <ref> --json
   \`\`\`
   The CLI creates fully populated task pages with description, comments (author + timestamp attributed), attachments downloaded to \`raw/assets/\`, frontmatter fields (status, assignee, due, tags, asana_ref, comment_count), and rebuilds the index automatically.

   **Do NOT prompt the user about scope.** The CLI reads \`ingest_scope\` from \`workspace.md\` and defaults to \`mine\` (your tasks only). If the user wants all tasks, they will pass \`--all\` explicitly. Never add \`--all\` unless the user asks for it.

   **If the CLI errors with "No ref provided and no default project configured"** — the Asana backend does not yet have a default \`project_gid\`. Do not ask the user to look it up. Resolve it inline:
   1. Fetch workspaces and projects: \`rubber-ducky backend configure asana --list --json\` (if the response has more than one workspace, ask the user which one and re-run with \`--workspace-id <GID>\` to get that workspace's projects)
   2. Show the user the project list by name and ask which one to use as the default
   3. Save their choice (always include naming flags, otherwise ingest will crash trying to open an interactive prompt): \`rubber-ducky backend configure asana --workspace-id <GID> --project-gid <GID> --naming-source title --naming-case lower --json\`
   4. Retry the ingest

   **If the CLI errors with "Asana naming config is not set"** — the backend has a project but no \`naming_source\`. Set a safe default non-interactively: \`rubber-ducky backend configure asana --naming-source title --naming-case lower --json\`. Then retry the ingest.

3. **Report results.** Parse the JSON output and tell the user:
   - How many tasks were ingested vs. skipped (already in wiki)
   - Any errors encountered
   - The file paths of newly created pages

4. **Vocabulary-aware tagging.** Read \`UBIQUITOUS_LANGUAGE.md\` and scan each newly ingested task page's title, description, and comments for matching brands, teams, and labels. Append any matches to the \`tags\` array in frontmatter using \`rubber-ducky frontmatter set\`. Do not duplicate tags already present. If no brands, teams, or labels are defined in \`UBIQUITOUS_LANGUAGE.md\`, skip vocabulary tagging.

## Ref formats

- Single task: \`/ingest-asana <task-gid>\` or \`/ingest-asana <asana-url>\`
- Project bulk: \`/ingest-asana project:<project-gid>\`
- Section bulk: \`/ingest-asana section:<section-gid>\`
- Default project: \`/ingest-asana\` (uses configured project_gid)

## Scope flags

- \`--mine\` — Only ingest tasks assigned to the authenticated user (default)
- \`--all\` — Ingest all tasks in the project
`;
}

function generateIngestJiraSkill(config: BackendConfig): string {
  const serverNote = config.server_url
    ? `Jira instance: \`${config.server_url}\`\n`
    : "";
  const projectNote = config.project_key
    ? `Default project key: \`${config.project_key}\`\n`
    : "";
  const configNotes = serverNote || projectNote
    ? `${serverNote}${projectNote}\n`
    : "";

  return `# Ingest Jira Issue

Ingest Jira issues into the wiki via the CLI. The CLI handles all data fetching, page creation, dedup, comments, and index rebuilding deterministically. Your job is to run the command, interpret the result, and apply vocabulary-aware tagging.

${configNotes}## Usage

\`\`\`
/ingest-jira [issue-key]
\`\`\`

Example: \`/ingest-jira WEB-288\`

## Prerequisites

- \`JIRA_EMAIL\` and \`JIRA_API_TOKEN\` environment variables must be set
- Verify with: \`rubber-ducky backend check jira\`
- See @references/backend-setup.md for full setup instructions
- **If connectivity fails, do NOT ask for credentials — refer the user to the setup guide.**

## Steps

1. **Verify connectivity.** Run \`rubber-ducky backend check jira\`.

2. **Run the ingest command.** Execute the CLI and capture the JSON output:
   \`\`\`bash
   rubber-ducky ingest jira <issue-key> --json
   \`\`\`
   The CLI creates fully populated task pages with description, comments (author + timestamp attributed), attachments downloaded to \`raw/assets/\`, frontmatter fields (status, priority, assignee, due, tags, jira_ref, comment_count), and rebuilds the index automatically.

   **Do NOT prompt the user about scope.** The CLI reads \`ingest_scope\` from \`workspace.md\` and defaults to \`mine\` (your issues only). If the user wants all issues, they will pass \`--all\` explicitly. Never add \`--all\` unless the user asks for it.

   **If the CLI errors with "No project specified and no project_key in Jira backend config"** — the Jira backend does not yet have a default \`project_key\`. Do not ask the user to look it up or paste it from a URL. Resolve it inline:
   1. Fetch projects: \`rubber-ducky backend configure jira --list --json\`
   2. Show the user the list (key — name) and ask which one to use as the default
   3. Save their choice: \`rubber-ducky backend configure jira --project-key <KEY> --json\`
   4. Retry the ingest

3. **Report results.** Parse the JSON output and tell the user:
   - How many issues were ingested vs. skipped (already in wiki)
   - Any errors encountered
   - The file paths of newly created pages

4. **Vocabulary-aware tagging.** Read \`UBIQUITOUS_LANGUAGE.md\` and scan each newly ingested task page's title, description, and comments for matching brands, teams, and labels. Append any matches to the \`tags\` array in frontmatter using \`rubber-ducky frontmatter set\`. Do not duplicate tags already present. If no brands, teams, or labels are defined in \`UBIQUITOUS_LANGUAGE.md\`, skip vocabulary tagging.

## Ref formats

- Single issue: \`/ingest-jira <issue-key>\` (e.g., \`/ingest-jira WEB-288\`)
- Project bulk: \`/ingest-jira project:<project-key>\`
- Default project: \`/ingest-jira\` (uses configured project_key)

## Scope flags

- \`--mine\` — Only ingest issues assigned to the authenticated user (default)
- \`--all\` — Ingest all issues in the project
`;
}

function generateGetSetupSkill(backends: BackendConfig[]): string {
  const backendChecks = backends
    .map((b) => `rubber-ducky backend check ${b.type}`)
    .join("\n");

  const ingestableBackends = backends.filter(
    (b) => b.type === "asana" || b.type === "jira" || b.type === "github"
  );
  const ingestableBackendList = ingestableBackends.length > 0
    ? ingestableBackends.map((b) => b.type).join(", ")
    : "(none configured)";
  const ingestCommandLines = ingestableBackends.map((b) => {
    if (b.type === "asana") {
      return "- **Asana**: `rubber-ducky ingest asana --mine --json`";
    }
    if (b.type === "jira") {
      return "- **Jira**: `rubber-ducky ingest jira --mine --json`";
    }
    return "- **GitHub**: GitHub does not have a single `--mine` ingest command — ask the user which repo to pull from, then run `/ingest-github repo:<owner/repo>` (or filter by label with `label:<owner/repo>:<label>`).";
  });
  const ingestCommands = ingestCommandLines.length > 0
    ? ingestCommandLines.join("\n")
    : "_No ingestable backends configured — skip this step._";

  const configureExplanationLines: string[] = [];
  const writeChoiceLines: string[] = [];
  for (const b of backends) {
    if (b.type === "jira") {
      configureExplanationLines.push(
        "- **Jira**: the project key is the uppercase prefix in any Jira issue URL — `https://yourorg.atlassian.net/browse/`**`ABC`**`-123` means the key is `ABC`. You don't need to find it yourself — the configure command lists your projects."
      );
      writeChoiceLines.push(
        "   - Jira: `rubber-ducky backend configure jira --project-key <KEY> --json`"
      );
    }
    if (b.type === "asana") {
      configureExplanationLines.push(
        "- **Asana**: the project GID is the long number in a project URL — `https://app.asana.com/0/`**`1234567890`**`/list`. Again, you don't need to copy it — the configure command lists your projects."
      );
      writeChoiceLines.push(
        "   - Asana: `rubber-ducky backend configure asana --workspace-id <GID> --project-gid <GID> --json` (if Asana's `workspaces` list has more than one entry, ask which workspace first as its own question; then re-run `--list` with `--workspace-id <chosen>` to get that workspace's projects). **Check the JSON response for an `id_fields` array.** If `id_fields` is non-empty, the project has custom ID fields (e.g. `ECOMM-123`) that can be used as filenames. Present the options to the user: each custom ID field name from `id_fields`, plus \"Task title\" as the default. If the user picks a custom ID field, run: `rubber-ducky backend configure asana --naming-source identifier --naming-case lower --identifier-field \"<field name>\" --json`. If the user picks \"Task title\" or `id_fields` is empty, run: `rubber-ducky backend configure asana --naming-source title --naming-case lower --json`. **Always set `--naming-source` and `--naming-case`** — without them, the next ingest will crash trying to open an interactive naming prompt."
      );
    }
  }
  const hasProjectDefaults = writeChoiceLines.length > 0;

  const step4Block = hasProjectDefaults
    ? `### Step 4 — Ensure each backend has a default project

Ingest needs a default project for Jira (\`project_key\`) and Asana (\`project_gid\`). These are populated during \`rubber-ducky init\` when the env vars are already set, but a first-time user who adds credentials *after* init will be missing them.

Before offering ingest, read \`workspace.md\`'s \`backends:\` array and verify:

- **Jira**: \`project_key\` is set
- **Asana**: \`project_gid\` and \`workspace_id\` are set
- **GitHub**: nothing extra needed (repos are passed per ingest)

**Handle backends one at a time.** If both Jira and Asana need a default, do Jira first end-to-end (fetch → present → user picks → save), then move on to Asana. Do **not** fetch both lists up front and ask one combined question — multi-backend prompts are confusing and users miss options.

For each backend missing its default, do this inline — do **not** ask the user to paste values from URLs, and do **not** send them to run a separate command in their terminal:

1. **Fetch the list** over the API (just this backend):
   \`\`\`bash
   rubber-ducky backend configure <type> --list --json
   \`\`\`
   This returns \`{ projects: [{ key, name }] }\` for Jira, or \`{ workspaces: [...], projects: [{ gid, name }] }\` for Asana.

2. **Show the user the options** in chat — a short list of \`key — name\` (Jira) or \`name\` (Asana). Don't dump the raw JSON. If the list is long (more than ~10), show the top 10 and tell the user there are more — they can name a different one or ask to see the full list.

3. **Ask one question about this backend only.** Wait for the answer before touching the next backend.

4. **Write the choice** with the appropriate flag (the JSON response confirms the write):
${writeChoiceLines.join("\n")}

5. **Move to the next backend** (if any) and repeat from step 1.

${configureExplanationLines.join("\n")}

If the user genuinely wants to see the URL pattern instead of picking from a list, you can show it, but prefer the list flow — it's faster and error-proof.`
    : "";

  const setupSteps: string[] = [];

  for (const backend of backends) {
    if (backend.type === "github") {
      setupSteps.push(`#### GitHub

GitHub uses the \`gh\` CLI. Tell the user to run this in their terminal:

\`\`\`bash
gh auth login
\`\`\`

Then verify: \`rubber-ducky backend check github\``);
    }
    if (backend.type === "asana") {
      setupSteps.push(`#### Asana

Asana uses a Personal Access Token (PAT) for authentication.

**Step 1: Create a PAT**

Tell the user to open this URL in their browser:

> https://app.asana.com/0/my-apps

Then click **Create new token**, name it something descriptive like "rubber-ducky", and copy the token.

**Step 2: Add to .env.local**

Tell the user to open \`.env.local\` in the workspace root (copy from \`.env.example\` if it doesn't exist) and set:

\`\`\`
export ASANA_ACCESS_TOKEN=<their-token>
\`\`\`

The CLI picks up \`.env.local\` automatically — no need to source it.

**Step 3: Verify connectivity**

\`\`\`bash
rubber-ducky backend check asana
\`\`\`

If it fails, ask the user to double-check their token value in \`.env.local\`.

**Step 4: Run discovery (if project/workspace not yet configured)**

If the workspace config is missing \`workspace_id\` or \`project_gid\`, tell the user to run \`rubber-ducky init\` again with their token set — it will auto-discover workspaces, projects, and custom fields via the API.

**Step 5: Configure task naming**

Once connectivity is confirmed and the project is configured, run the naming setup:

\`\`\`bash
rubber-ducky asana configure-naming
\`\`\`

This walks the user through choosing how task filenames are generated (custom field, title, or GID) with a live preview of real filenames from their project. The result is saved to workspace.md so that all future ingests use the chosen scheme.`);
    }
    if (backend.type === "jira") {
      const serverUrl = backend.server_url;
      const urlNote = serverUrl ? ` (configured instance: \`${serverUrl}\`)` : "";
      setupSteps.push(`#### Jira

Jira uses an API token with Basic Auth for authentication${urlNote}.

**Step 1: Create an API token**

Tell the user to open this URL in their browser:

> https://id.atlassian.com/manage-profile/security/api-tokens

Then click **Create API token**, give it a label like "rubber-ducky", and copy the token.

**Step 2: Add to .env.local**

Tell the user to open \`.env.local\` in the workspace root (copy from \`.env.example\` if it doesn't exist) and set:

\`\`\`
export JIRA_SERVER_URL=https://yourcompany.atlassian.net
export JIRA_EMAIL=<their-atlassian-email>
export JIRA_API_TOKEN=<their-token>
\`\`\`

The CLI picks up \`.env.local\` automatically — no need to source it.

**Step 3: Verify connectivity**

\`\`\`bash
rubber-ducky backend check jira
\`\`\`

If it fails, ask the user to double-check their credentials in \`.env.local\`.

**Step 4: Run discovery**

After connectivity is confirmed, tell the user to re-run \`rubber-ducky init\` with their credentials loaded — it will read \`JIRA_SERVER_URL\` from the environment, write it to workspace config, and auto-discover projects.`);
    }
  }

  return `# Get Setup

Walk through connecting the backends configured in this workspace.

**IMPORTANT: Never ask the user to paste API tokens, passwords, or credentials into the chat.** All authentication happens through environment variables. Never read or display the contents of \`.env\`, \`.env.local\`, or any file that may contain secrets.

## Steps

### Step 1 — Check current connectivity

Run each backend check via Bash to see what is already connected:

\`\`\`bash
${backendChecks}
\`\`\`

Report which backends are connected and which need setup.

If all backends are connected, continue to the next step below. Do not stop here — a fresh workspace has no tasks yet, so \`/good-morning\` would have nothing to work with until something is ingested.

### Step 2 — Set up unconnected backends

For each backend that failed the connectivity check, tell the user:

1. Open \`.env.example\` in the workspace root — it lists the exact environment variables needed for their configured backends, with links to create tokens
2. Copy it to \`.env.local\`: \`cp .env.example .env.local\`
3. Fill in the values (instructions for creating each token are below)
4. The CLI picks up \`.env.local\` automatically — no manual sourcing needed

Then walk through each backend's token creation steps. **The user must create tokens and set env vars themselves** — never accept credentials pasted in the chat.

${setupSteps.join("\n\n")}

### Step 3 — Verify

After the user completes setup, re-run the connectivity checks:

\`\`\`bash
${backendChecks}
\`\`\`

Report the results. If any backend still fails, refer the user to @references/backend-setup.md for detailed troubleshooting and stop here. Otherwise continue to the next step.

${step4Block}

### Step 5 — Offer initial ingest

Now that each backend has a default project, offer to pull the user's open work into the wiki. A fresh workspace has no tasks yet, and \`/good-morning\` needs task pages to prioritize.

**Ask per backend — not one grouped question.** Take them one at a time so the user can decide each integration on its own merits. If they say yes to one and no to the next, that's fine.

For each ingestable backend, ask something like:

> "Want me to pull in your assigned \`<backend>\` work now? (yes / skip)"

Wait for the answer, run the ingest if they agree, report the result for that backend, and then move to the next backend. Run ingest commands with \`--mine\` scope (their assigned items only — the safe default). Do **not** pass \`--all\` unless the user explicitly asks for everything in the project.

${ingestCommands}

Report the result for each backend (count ingested, count skipped, any errors) before moving on.

If ingest succeeds and at least one task page now exists, tell the user they are ready to go and can try \`/good-morning\` to start their day — or just say "good morning", natural language works.

If the user skipped, tell them they can ingest anytime with the commands above, or by saying "pull in my Asana tasks" / "pull in my Jira issues".

## Output

Keep it conversational and concise. One backend at a time during setup. Wait for the user to confirm they have completed each step before moving to the next.
`;
}

/**
 * Generate reference template files for the workspace.
 * These are the single source of truth for schemas and formats that
 * CLAUDE.md, skills, and agents pull in via @references/... when needed.
 */
export function generateReferenceFiles(
  backends?: BackendConfig[]
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [
    { path: "references/frontmatter-templates.md", content: generateFrontmatterTemplatesRef() },
    { path: "references/when-to-use-cli.md", content: generateWhenToUseCliRef() },
  ];

  const backendTypes = (backends ?? []).map((b) => b.type);

  if (backendTypes.length > 0) {
    files.push({
      path: "references/backend-setup.md",
      content: generateBackendSetupRef(backends!),
    });
  }

  if (backendTypes.includes("github")) {
    files.push({
      path: "references/github-ticket-template.md",
      content: generateGitHubTicketTemplateRef(),
    });
  }
  if (backendTypes.includes("jira")) {
    files.push({
      path: "references/jira-ticket-template.md",
      content: generateJiraTicketTemplateRef(),
    });
  }
  if (backendTypes.includes("asana")) {
    files.push({
      path: "references/asana-ticket-template.md",
      content: generateAsanaTicketTemplateRef(),
    });
  }

  return files;
}

function generateFrontmatterTemplatesRef(): string {
  return `# Frontmatter Templates

Single source of truth for all page frontmatter schemas in this workspace.
Reference this file with \`@references/frontmatter-templates.md\` in skills and agents.

## Daily page

File location: \`wiki/daily/YYYY-MM-DD.md\`

\`\`\`yaml
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
\`\`\`

### Body sections

\`\`\`markdown
## Focus
## Work log
## Completed today
## Carried over
## Notes & context
## Blockers
\`\`\`

## Task page

File location: \`wiki/tasks/<slugified-title>.md\`

\`\`\`yaml
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
comment_count: 0                # Number of comments synced from backend
---
\`\`\`

### Body sections

\`\`\`markdown
## Description
## Context
## Comments
## Activity log
## See also
\`\`\`

## Project page

File location: \`wiki/projects/<slugified-title>.md\`

\`\`\`yaml
---
title: API v2                   # Human-readable title (required)
type: project                   # Always "project" (required)
created: 2026-04-12T10:00:00Z  # ISO timestamp (required)
updated: 2026-04-12T10:00:00Z  # ISO timestamp, updated on changes
status: backlog                 # Same status vocabulary as tasks
tags: []                        # Array of labels/tags
---
\`\`\`

### Body sections

\`\`\`markdown
## Description
## Tasks
## Notes
\`\`\`

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

- **Daily pages**: Named by date — \`YYYY-MM-DD.md\`
- **Task pages**: Slugified title — lowercase, hyphens for spaces, no special characters (e.g., "Fix Auth Timeout" → \`fix-auth-timeout.md\`)
- **Project pages**: Same slugification as tasks
- **Wikilinks**: Use \`[[slugified-name]]\` to cross-reference between pages
`;
}

function generateGitHubTicketTemplateRef(): string {
  return `# GitHub Ticket Template

How to format content when creating or updating GitHub Issues from wiki task pages.
Reference this file with \`@references/github-ticket-template.md\` in skills and agents.

## Tone

Direct, developer-focused, technical. Write for engineers who will read this in a GitHub notification email.

## Structure

**Title**: Concise, action-oriented, imperative mood.
- Good: "Fix login form crash on submit"
- Bad: "Login form is crashing" or "Bug: login form"

**Body** (GitHub-flavored markdown):

\`\`\`markdown
## Description

<From wiki task page ## Description section>

## Steps to Reproduce

<If applicable — numbered list>

## Context

<From wiki task page ## Context section, if present>

## Acceptance Criteria

<Derived from description — bulleted checklist>
- [ ] Criterion 1
- [ ] Criterion 2
\`\`\`

**Labels**: Map directly from the task page \`tags\` array.

**Assignee**: From task page \`assignee\` field if it maps to a GitHub username.

## Field mapping

| Wiki frontmatter | GitHub field |
|-------------------|-------------|
| title | Issue title |
| tags | Labels |
| assignee | Assignee |
| priority | Label (priority:high, priority:low) |
| status | State (open/closed) + labels for granularity |
| description (body) | Issue body |

## Status mapping

| Wiki status | GitHub representation |
|-------------|---------------------|
| backlog | Open |
| to-do | Open |
| in-progress | Open + "in-progress" label |
| in-review | Open + "in-review" label |
| blocked | Open + "blocked" label |
| done | Closed |
| deferred | Open + "deferred" label |
`;
}

function generateJiraTicketTemplateRef(): string {
  return `# Jira Ticket Template

How to format content when creating or updating Jira tickets from wiki task pages.
Reference this file with \`@references/jira-ticket-template.md\` in skills and agents.

## Tone

Structured, process-oriented, team-readable. Jira tickets are read by PMs, QA, and developers across teams.

## Structure

**Summary**: Clear, structured. Prefix with component or area in brackets.
- Good: "[Login] Fix form crash on submit"
- Bad: "Fix login bug"

**Description** (Jira wiki markup or markdown, depending on instance):

\`\`\`
h3. Description

<From wiki task page ## Description section>

h3. Acceptance Criteria

* Criterion 1
* Criterion 2

h3. Context

<From wiki task page ## Context section, if present>
\`\`\`

**Issue Type**: Infer from content:
- Code defect → Bug
- Implementation work → Task
- User-facing feature → Story

**Labels**: From task page \`tags\` array.

**Priority**: Map from task page \`priority\` field:
| Wiki priority | Jira priority |
|---------------|--------------|
| asap | Highest |
| high | High |
| medium | Medium |
| low | Low |
| null | Medium (default) |

## Field mapping

| Wiki frontmatter | Jira field |
|-------------------|-----------|
| title | Summary |
| tags | Labels |
| assignee | Assignee |
| priority | Priority |
| due | Due Date |
| description (body) | Description |

## Status mapping

| Wiki status | Jira transition |
|-------------|----------------|
| backlog | Backlog / Open |
| to-do | To Do / Selected for Development |
| in-progress | In Progress / Start Progress |
| in-review | In Review |
| blocked | Blocked / Flagged |
| done | Done / Resolve |
| deferred | On Hold / Deferred |
`;
}

function generateAsanaTicketTemplateRef(): string {
  return `# Asana Ticket Template

How to format content when creating or updating Asana tasks from wiki task pages.
Reference this file with \`@references/asana-ticket-template.md\` in skills and agents.

## Tone

Collaborative, clear, action-oriented. Asana tasks are read by cross-functional teams. Keep language accessible.

## Structure

**Name**: Clear, brief task name. No brackets or prefixes — Asana uses projects and sections for organization.
- Good: "Fix login form crash on submit"
- Bad: "[Login] Fix form crash on submit"

**Notes** (rich text):

\`\`\`
Description

<From wiki task page ## Description section>

Context

<From wiki task page ## Context section, if present>

Related tasks

<From wiki task page ## See also, as Asana task links if possible>
\`\`\`

**Tags**: From task page \`tags\` array.

## Field mapping

| Wiki frontmatter | Asana field |
|-------------------|------------|
| title | Task name |
| tags | Tags |
| assignee | Assignee |
| due | Due date |
| description (body) | Notes |

## Status mapping

Asana maps status via the task's **section** within a project and the **completed** flag:

| Wiki status | Asana representation |
|-------------|---------------------|
| backlog | Section: Backlog |
| to-do | Section: To Do |
| in-progress | Section: In Progress |
| in-review | Section: In Review |
| blocked | Section: Blocked |
| done | Completed = true |
| deferred | Section: Later / Deferred |
`;
}

function generateBackendSetupRef(backends: BackendConfig[]): string {
  const backendTypes = backends.map((b) => b.type);
  const sections: string[] = [];

  sections.push(`# Backend Setup

How to install, authenticate, and verify each configured backend.
Reference this file with \`@references/backend-setup.md\` in skills and agents.

> **Never paste API tokens, passwords, or credentials into the Claude Code chat.**
> All credentials belong in environment variables or CLI auth flows — not in conversation.
`);

  if (backendTypes.includes("github")) {
    sections.push(`## GitHub

GitHub uses the \`gh\` CLI directly — no additional setup needed.

### Install

Install the GitHub CLI: https://cli.github.com/

### Authenticate

\`\`\`bash
gh auth login
\`\`\`

Follow the interactive prompts to authenticate via browser or token.

### Verify

\`\`\`bash
gh auth status
rubber-ducky backend check github
\`\`\`
`);
  }

  if (backendTypes.includes("asana")) {
    sections.push(`## Asana

Asana uses a Personal Access Token (PAT) via the \`ASANA_ACCESS_TOKEN\` environment variable.

### Create a Personal Access Token

1. Go to the [Asana Developer Console](https://app.asana.com/0/developer-console)
2. Navigate to **Personal Access Tokens**
3. Click **Create new token**
4. Give it a descriptive name (e.g., "rubber-ducky CLI")
5. Copy the token — you won't be able to see it again

### Configure

Copy \`.env.example\` to \`.env.local\` if it doesn't exist, then add your token:

\`\`\`
export ASANA_ACCESS_TOKEN="<your-token>"
\`\`\`

The CLI picks up \`.env.local\` automatically — no manual sourcing needed.

### Verify

\`\`\`bash
rubber-ducky backend check asana
\`\`\`
`);
  }

  if (backendTypes.includes("jira")) {
    const serverUrl = backends.find((b) => b.type === "jira")?.server_url;
    const serverNote = serverUrl ? `Configured Jira instance: \`${serverUrl}\`\n\n` : "";

    sections.push(`## Jira

Jira uses an API token via the \`JIRA_EMAIL\` and \`JIRA_API_TOKEN\` environment variables.

${serverNote}### Create an API token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a descriptive name (e.g., "rubber-ducky CLI")
4. Copy the token — you won't be able to see it again

### Configure

Copy \`.env.example\` to \`.env.local\` if it doesn't exist, then add your credentials:

\`\`\`
export JIRA_SERVER_URL="https://yourcompany.atlassian.net"
export JIRA_EMAIL="<your-atlassian-email>"
export JIRA_API_TOKEN="<your-token>"
\`\`\`

The CLI picks up \`.env.local\` automatically — no manual sourcing needed.

### Verify

\`\`\`bash
rubber-ducky backend check jira
\`\`\`
`);
  }

  return sections.join("\n");
}

function generateWhenToUseCliRef(): string {
  return `# When to Use CLI vs. Claude Code

Reference this file with \`@references/when-to-use-cli.md\` when making architectural decisions about where new functionality should live.

## The rule

**High-frequency, deterministic, schema-bound work → CLI command.**
**Low-frequency, context-dependent, creative work → Claude Code skill or direct conversation.**

## Why

The CLI exists for four reasons, in order of importance:

1. **Speed** — CLI commands finish in 50-200ms. Claude Code reading, reasoning, and writing takes 3-10 seconds per operation. For things that happen many times a day, the user feels the difference.
2. **Reliability** — CLI commands are deterministic. Same input, same output, every time. Claude Code is almost-always correct, but "almost always" across hundreds of operations per week means occasional mistakes.
3. **Atomicity** — CLI commands that do multiple things (like \`task start\` updating frontmatter + daily page + log) do them in one shot. Multiple Claude Code tool calls can fail partway through.
4. **Context efficiency** — Every file Claude Code reads occupies context window space. CLI commands keep the conversation lean for the work that actually needs AI.

Token savings are real but modest (~7,000-15,000 tokens/day). Not the primary motivator.

## Decision guide

| Question | If yes → CLI | If yes → Claude Code |
|----------|-------------|---------------------|
| Will this run multiple times per day? | Yes | |
| Is the output fully determined by the input? | Yes | |
| Does it follow a fixed schema? | Yes | |
| Does it need to understand context to act? | | Yes |
| Does it require judgment or synthesis? | | Yes |
| Is it a conversation with the user? | | Yes |
| Will it run once a week or less? | | Yes |

## Current split

### CLI commands (mechanical)

| Command | Why CLI |
|---------|---------|
| \`page create\` | Fixed template, schema-bound frontmatter |
| \`task start\` / \`task close\` | Deterministic state transition + multi-file atomic update |
| \`frontmatter get\` / \`set\` / \`validate\` | Pure YAML manipulation, no judgment needed |
| \`asap\` / \`remind\` / \`idea\` | Append to file, parse structured format |
| \`index rebuild\` | Scan all files, generate grouped table — mechanical |
| \`log append\` | Timestamp + append to file |
| \`wiki search\` | Text search across files, return matches |
| \`doctor\` / \`doctor lint\` | Check-based validation against known rules |
| \`backend check\` | Connectivity test, returns pass/fail |
| \`screenshot ingest\` | Copy file + create page — mechanical |
| \`update\` | Diff template files, apply changes |
| \`status\` | Read config, report values |

### Claude Code skills (intelligent)

| Skill | Why Claude Code |
|-------|----------------|
| \`/good-morning\` | Synthesizes priorities from multiple sources, makes judgment calls about focus |
| \`/wrap-up\` | Summarizes a day's work, identifies patterns, suggests tomorrow's focus |
| \`/write-a-prd\` | Creative — interviews user, explores codebase, designs architecture |
| \`/prd-to-issues\` | Judgment — decides how to slice work, what dependencies exist |
| \`/verify-prd\` | Analysis — cross-references branches, code, and issues |
| \`/commit\` | Reads diff, synthesizes intent into a message |
| \`/write-pr\` | Reads full branch diff, writes narrative description |
| \`/add-integration\` | Research — evaluates MCP servers, APIs, capabilities |

### Hybrid pattern (skill calls CLI)

Most skills are hybrid. \`/good-morning\` calls \`rubber-ducky page create daily\` (CLI) to ensure the daily page exists, then reads task pages and synthesizes a brief (AI). The skill orchestrates; the CLI does the mechanical parts.

## When adding new features

Ask these questions:

1. **Could a bash script do this?** If yes, it's a CLI command.
2. **Does it need to read content and make decisions?** If yes, it's a Claude Code skill (that may call CLI commands for the mechanical parts).
3. **Is it a new operation on an existing page type?** Probably CLI — add a subcommand.
4. **Is it a new workflow that combines multiple operations?** Probably a skill — it orchestrates CLI commands + AI synthesis.
5. **Is it something the user will want to customize or override?** Skill — the user can edit the \`.claude/commands/\` file.
`;
}

/**
 * Generate .claude/settings.json for a workspace.
 * Pre-approves safe operations so Claude Code doesn't prompt for every read
 * and CLI call. Write operations to external systems still require confirmation.
 */
export function generateClaudeSettings(backends?: BackendConfig[]): string {
  const allow: string[] = [
    // Reading files is always safe within the workspace
    "Read",
    "Glob",
    "Grep",

    // rubber-ducky CLI — all commands operate within the workspace directory
    "Bash(rubber-ducky:*)",

    // Directory listing for workspace navigation
    "Bash(ls:*)",
    "Bash(cat:*)",

    // Git read operations
    "Bash(git status:*)",
    "Bash(git log:*)",
    "Bash(git diff:*)",
    "Bash(git branch:*)",
  ];

  // Backend-specific read permissions
  const backendTypes = (backends ?? []).map((b) => b.type);

  if (backendTypes.includes("github")) {
    allow.push(
      "Bash(gh issue list:*)",
      "Bash(gh issue view:*)",
      "Bash(gh repo view:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
    );
  }

  // Hook: block reading .env files that may contain secrets.
  // PreToolUse hooks receive tool input as JSON on stdin.
  // Exit 2 with a reason on stdout to block the tool call.
  const envFileGuard = [
    "bash", "-c",
    // Read tool: check file_path for .env patterns
    // Bash tool: check command for cat/head/tail/less/more of .env files
    `INPUT=$(cat); ` +
    `FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4); ` +
    `COMMAND=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | cut -d'"' -f4); ` +
    `if echo "$FILE_PATH" | grep -qE '(^|/)\\.env(rc)?($|[._-])'; then ` +
      `echo "BLOCKED: Reading .env files is not allowed — they contain secrets. Use rubber-ducky backend check to verify connectivity."; exit 2; ` +
    `fi; ` +
    `if echo "$COMMAND" | grep -qE '(cat|head|tail|less|more|bat).*\\.env'; then ` +
      `echo "BLOCKED: Reading .env files is not allowed — they contain secrets. Use rubber-ducky backend check to verify connectivity."; exit 2; ` +
    `fi`,
  ].join(" ");

  const settings = {
    permissions: { allow },
    hooks: {
      PreToolUse: [
        {
          matcher: "Read|Bash",
          hooks: [
            {
              type: "command",
              command: envFileGuard,
            },
          ],
        },
      ],
    },
  };

  return JSON.stringify(settings, null, 2) + "\n";
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

/**
 * Generate a .env.example tailored to the configured backends.
 * Shows exactly which env vars the user needs to set — no more, no less.
 */
export function generateEnvExample(backends?: BackendConfig[]): string {
  const sections: string[] = [
    "# Rubber-Ducky environment variables",
    "# Copy this file to .env.local and fill in your values:",
    "#   cp .env.example .env.local",
    "# The rubber-ducky CLI picks up this file automatically.",
    "",
  ];

  const backendTypes = (backends ?? []).map((b) => b.type);

  if (backendTypes.includes("asana")) {
    sections.push(
      "# Asana — create a Personal Access Token at https://app.asana.com/0/my-apps",
      "export ASANA_ACCESS_TOKEN=",
      ""
    );
  }

  if (backendTypes.includes("jira")) {
    sections.push(
      "# Jira — create an API token at https://id.atlassian.com/manage-profile/security/api-tokens",
      "export JIRA_SERVER_URL=https://yourcompany.atlassian.net",
      "export JIRA_EMAIL=",
      "export JIRA_API_TOKEN=",
      ""
    );
  }

  if (backendTypes.includes("github")) {
    sections.push(
      "# GitHub — authenticate via: gh auth login",
      "# No env var needed — the gh CLI manages its own auth.",
      ""
    );
  }

  if (backendTypes.length === 0) {
    sections.push(
      "# No backends configured yet. Run `rubber-ducky init` to add integrations.",
      ""
    );
  }

  return sections.join("\n");
}

/**
 * Generate a .gitignore for rubber-ducky workspaces.
 * Protects credentials, ignores OS/editor junk, and keeps
 * the repo clean without blocking normal workspace files.
 */
export function generateGitignore(): string {
  return `# Credentials — never commit tokens or secrets
.env
.env.*
*.local

# OS files
.DS_Store
Thumbs.db
Desktop.ini

# Editor / IDE
*.swp
*.swo
*~
.idea/
.vscode/
*.code-workspace

# Node (if running rubber-ducky from source in the workspace)
node_modules/
dist/

# Obsidian — workspace-specific settings that shouldn't be shared
.obsidian/workspace.json
.obsidian/workspace-mobile.json

# Sandcastle worktrees and logs
.sandcastle/worktrees/
.sandcastle/logs/
.sandcastle/.env
`;
}
