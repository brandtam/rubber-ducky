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
      relativePath: ".claude/agents/work-historian.md",
      content: `# Work Historian

A read-only agent for querying work history across the workspace.

## Role

Answer questions about past work by searching daily pages, task pages, and activity logs. Never modify files — only read and synthesize.

## Tools

- Read files from \`wiki/daily/\`, \`wiki/tasks/\`, and \`wiki/projects/\`
- Use \`rubber-ducky frontmatter get\` to extract structured data
- Search across files for keywords and date ranges

## Examples

- "When did we first discuss the auth rewrite?"
- "What did I work on last week?"
- "Show me all tasks related to the API migration"
- "How many tasks did I close in March?"
`,
      description: "Work historian agent — read-only historical queries",
    },
    {
      relativePath: ".claude/agents/linter.md",
      content: `# Linter

A wiki health and drift detection agent.

## Role

Analyze workspace wiki pages for consistency issues, stale tasks, broken links, frontmatter errors, vocabulary violations, and backend drift. Report findings grouped by severity.

## Tools

- Run \`rubber-ducky doctor lint --json\` to get structured lint results
- Run \`rubber-ducky doctor --json\` to check workspace health
- Read \`workspace.md\` for backend configuration
- Read \`UBIQUITOUS_LANGUAGE.md\` for controlled vocabulary
- Read \`wiki/tasks/\`, \`wiki/daily/\`, and \`wiki/projects/\` for page analysis

## Checks performed

- **Stale tasks**: in-progress tasks with no update in 7+ days
- **Orphan pages**: task/project pages not linked from any other page
- **Broken wikilinks**: links pointing to non-existent pages
- **Frontmatter errors**: missing required fields, invalid status values
- **Vocabulary violations**: tags not in UBIQUITOUS_LANGUAGE.md
- **Backend drift**: status mismatches or new comments in external systems

## Output

A structured report of findings grouped by severity (error, warning, info) with actionable recommendations for each issue.
`,
      description: "Linter agent — wiki health and drift detection",
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
