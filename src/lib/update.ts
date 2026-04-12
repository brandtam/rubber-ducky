import * as fs from "node:fs";
import * as path from "node:path";

export interface BundledTemplate {
  relativePath: string;
  content: string;
  description: string;
}

export type FileStatus = "unchanged" | "modified" | "new";

export interface FileComparison {
  relativePath: string;
  status: FileStatus;
  description: string;
  localContent: string | null;
  bundledContent: string;
  diff: string | null;
}

export interface UpdateScanResult {
  comparisons: FileComparison[];
  unchanged: FileComparison[];
  modified: FileComparison[];
  newFiles: FileComparison[];
}

export type UpdateAction = "keep" | "overwrite" | "skip";

export interface UpdateFileResult {
  relativePath: string;
  action: UpdateAction;
  applied: boolean;
}

/**
 * Returns all templates bundled with the current CLI version.
 * These are skill and agent files that ship with rubber-ducky.
 */
export function getBundledTemplates(): BundledTemplate[] {
  return [
    {
      relativePath: ".claude/commands/good-morning.md",
      content: `# Good Morning

Start the day with a prioritized brief.

## Behavior

1. Read \`workspace.md\` to understand workspace context
2. Check \`wiki/daily/\` for yesterday's page — note any carried-over items
3. Scan \`wiki/tasks/\` for tasks with status \`in-progress\`, \`to-do\`, or \`blocked\`
4. Check for any ASAP items or date-keyed reminders due today
5. Present a prioritized summary:
   - ASAP items (handle first)
   - In-progress tasks (continue)
   - Blocked tasks (check if unblocked)
   - To-do tasks (pick up next)
6. Create today's daily page if it doesn't exist: \`rubber-ducky page create daily\`

## Output

A concise morning brief with clear priorities and suggested focus order.
`,
      description: "Morning brief skill — prioritized daily summary",
    },
    {
      relativePath: ".claude/commands/wrap-up.md",
      content: `# Wrap Up

End-of-day summary and workspace update.

## Behavior

1. Read today's daily page from \`wiki/daily/\`
2. Scan \`wiki/tasks/\` for tasks touched today (check activity logs)
3. For each touched task:
   - Update status if changed
   - Append activity log entry with today's date
4. Update today's daily page:
   - Fill in "Completed today" section
   - Fill in "Carried over" section for incomplete tasks
   - Add any notes or blockers
5. Present a summary of the day

## Output

A concise end-of-day summary showing what was accomplished and what carries over.
`,
      description: "End-of-day wrap-up skill — daily summary and status update",
    },
    {
      relativePath: ".claude/commands/lint.md",
      content: `# Lint

Check workspace health and consistency.

## Behavior

1. Verify \`workspace.md\` exists and has valid frontmatter
2. Scan \`wiki/tasks/\` for:
   - Stale tasks (in-progress for >7 days with no activity)
   - Missing required frontmatter fields
   - Broken wikilinks
3. Scan \`wiki/daily/\` for:
   - Gaps in daily pages
   - Pages with empty sections
4. Check \`UBIQUITOUS_LANGUAGE.md\` for:
   - Terms used in task pages but not defined
5. Report findings grouped by severity (error, warning, info)

## Output

A structured report of workspace health issues.
`,
      description: "Workspace linter skill — health and consistency checks",
    },
    {
      relativePath: ".claude/commands/query.md",
      content: `# Query

Search your work history with a natural language question.

## Arguments

\`$ARGUMENTS\` — The question to answer (e.g., "when did we first discuss auth?", "what did I work on last week?")

## Behavior

Route the user's question to the **work-historian** agent for a read-only, citation-backed answer.

1. Parse \`$ARGUMENTS\` as the user's natural language query
2. Invoke the work-historian agent with the query
3. The agent will search across daily pages, task pages, project pages, activity logs, and the wiki log
4. Return the agent's synthesized answer with source citations

## Invocation

Use the Agent tool to invoke the work-historian agent:

\`\`\`
Agent({
  subagent_type: "work-historian",
  prompt: "$ARGUMENTS"
})
\`\`\`

If \`$ARGUMENTS\` is empty, ask the user what they want to know about their work history.
`,
      description: "Query skill — natural language work history search via work-historian agent",
    },
    {
      relativePath: ".claude/agents/work-historian.md",
      content: `# Work Historian

A read-only agent for querying work history across the workspace.

## Role

You are a work-historian agent. Your job is to answer questions about past work by searching daily pages, task pages, project pages, activity logs, and the wiki log. You are strictly read-only — do not create, edit, or delete any files.

## Constraints

- **Read-only access**: Never modify, write, edit, create, or delete files. Only read and search.
- **Citation required**: Every claim must reference a specific source page and date.
- **Workspace scope**: Only search within the \`wiki/\` directory of the current workspace.

## Tools Available

Use these tools to find information efficiently:

1. **\`rubber-ducky wiki search <query> [--type <type>] [--from <date>] [--to <date>]\`** (via Bash)
   - Primary search tool. Searches across all wiki pages for keyword matches.
   - Use \`--type daily\` to search only daily pages, \`--type task\` for tasks, \`--type project\` for projects.
   - Use \`--from\` and \`--to\` (YYYY-MM-DD) to filter daily pages by date range.
   - Always pass \`--json\` for structured results.

2. **\`rubber-ducky frontmatter get <file> [field]\`** (via Bash)
   - Extract structured metadata from any wiki page (status, dates, tags, etc.).
   - Use to get specific fields like \`status\`, \`created\`, \`closed\`, \`tasks_touched\`.

3. **Read tool**
   - Read full file contents when you need the complete body of a page.
   - Read \`wiki/daily/YYYY-MM-DD.md\` for daily pages.
   - Read \`wiki/tasks/<slug>.md\` for task pages.
   - Read \`wiki/projects/<slug>.md\` for project pages.
   - Read \`wiki/log.md\` for the activity log.
   - Read \`wiki/index.md\` for a summary of all pages.

4. **Grep tool**
   - Search for specific patterns across files when you need regex matching.

## Search Strategy

For **"when did we first discuss X?"** questions:
1. Run \`rubber-ducky wiki search "<X>" --json\` to find all mentions
2. For each match, check the date — daily page dates are in the filename (YYYY-MM-DD.md), task/project dates are in frontmatter (\`created\` field)
3. Sort chronologically and report the earliest mention
4. Read the relevant page section for context

For **"what did I work on last week?"** questions:
1. Calculate the date range for last week
2. Run \`rubber-ducky wiki search "" --type daily --from <start> --to <end> --json\` or read each daily page directly
3. For each daily page, read the Work log, Completed today, and Focus sections
4. Cross-reference \`tasks_touched\` frontmatter to identify task pages
5. Synthesize a summary organized by day or by task

For **"show me all tasks related to X"** questions:
1. Run \`rubber-ducky wiki search "<X>" --type task --json\`
2. For each matching task, extract key frontmatter (status, priority, created, due)
3. Present as a structured list

For **"how many tasks did I close in <period>?"** questions:
1. Read \`wiki/index.md\` to get a list of all tasks
2. For tasks with status \`done\`, read their frontmatter \`closed\` date
3. Filter by the requested period
4. Report count with list of closed tasks

## Response Format

Always structure your response as:

1. **Answer**: A clear, concise answer to the question
2. **Sources**: A list of source pages that support the answer, formatted as:
   - \`wiki/daily/YYYY-MM-DD.md\` — what was found there
   - \`wiki/tasks/slug.md\` — what was found there
3. **Additional context** (if relevant): Related information the user might find useful

## Examples

**Q: "When did we first discuss the auth rewrite?"**
> The auth rewrite was first discussed on 2024-03-12.
>
> Sources:
> - \`wiki/daily/2024-03-12.md\` — Work log entry: "Discussed auth rewrite approach with team"
> - \`wiki/tasks/auth-rewrite.md\` — Created on 2024-03-12, status: in-progress

**Q: "What did I work on last week?"**
> Last week (2024-03-11 to 2024-03-15) you worked on:
>
> - **Monday 2024-03-11**: Focused on API migration, closed 2 tasks
> - **Tuesday 2024-03-12**: Started auth rewrite discussion, bug triage
> - ...
>
> Sources:
> - \`wiki/daily/2024-03-11.md\` — Work log, Completed today sections
> - \`wiki/daily/2024-03-12.md\` — Work log, Focus sections
`,
      description: "Work historian agent — read-only historical queries with citation support",
    },
  ];
}

/**
 * Scan a workspace and compare local files against bundled templates.
 */
export function scanWorkspace(workspacePath: string): UpdateScanResult {
  const templates = getBundledTemplates();
  const comparisons: FileComparison[] = [];

  for (const template of templates) {
    const fullPath = path.join(workspacePath, template.relativePath);
    let localContent: string | null = null;
    let status: FileStatus;
    let diff: string | null = null;

    if (fs.existsSync(fullPath)) {
      localContent = fs.readFileSync(fullPath, "utf-8");
      if (localContent === template.content) {
        status = "unchanged";
      } else {
        status = "modified";
        diff = generateDiff(localContent, template.content);
      }
    } else {
      status = "new";
    }

    comparisons.push({
      relativePath: template.relativePath,
      status,
      description: template.description,
      localContent,
      bundledContent: template.content,
      diff,
    });
  }

  return {
    comparisons,
    unchanged: comparisons.filter((c) => c.status === "unchanged"),
    modified: comparisons.filter((c) => c.status === "modified"),
    newFiles: comparisons.filter((c) => c.status === "new"),
  };
}

/**
 * Generate a unified-style diff between two strings using LCS.
 * Returns empty string if content is identical.
 */
export function generateDiff(localContent: string, bundledContent: string): string {
  if (localContent === bundledContent) return "";

  const localLines = localContent.split("\n");
  const bundledLines = bundledContent.split("\n");

  // Build LCS table
  const m = localLines.length;
  const n = bundledLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (localLines[i - 1] === bundledLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff operations
  const ops: Array<{ type: "+" | "-" | " "; line: string }> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && localLines[i - 1] === bundledLines[j - 1]) {
      ops.unshift({ type: " ", line: localLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "+", line: bundledLines[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "-", line: localLines[i - 1] });
      i--;
    }
  }

  return ops.map((op) => `${op.type}${op.line}`).join("\n");
}

/**
 * Apply an update action to a single file.
 */
export function applyFileUpdate(
  workspacePath: string,
  relativePath: string,
  bundledContent: string,
  action: UpdateAction
): UpdateFileResult {
  if (action === "keep" || action === "skip") {
    return { relativePath, action, applied: false };
  }

  const fullPath = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bundledContent, "utf-8");

  return { relativePath, action, applied: true };
}
