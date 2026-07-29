import * as fs from "node:fs";
import * as path from "node:path";
import { applyAdopt, planAdopt, DIRS } from "./adopt.js";
import { parseFrontmatter } from "./frontmatter.js";
import { summarizeArray, type ArrayEnvelope } from "./output.js";

export interface WorkspaceOptions {
  name: string;
  targetDir: string;
}

export interface WorkspaceResult {
  workspacePath: string;
  filesCreated: string[];
  dirsCreated: string[];
}

/**
 * Public JSON contract for `rubber-ducky init`. The two array fields default
 * to a `{count, sample}` envelope and become full arrays under `--verbose`.
 * Mode is the discriminator — within either mode the field shape is stable.
 */
export interface WorkspaceJson {
  success: true;
  workspacePath: string;
  filesCreated: string[] | ArrayEnvelope<string>;
  dirsCreated: string[] | ArrayEnvelope<string>;
}

/**
 * Shape a `WorkspaceResult` for JSON output. Pure transformation — co-located
 * with `createWorkspace` so the source type and its on-the-wire contract
 * evolve together. CLI handler is glue: `formatOutput(workspaceResultToJson(...))`.
 */
export function workspaceResultToJson(
  result: WorkspaceResult,
  opts: { verbose?: boolean },
): WorkspaceJson {
  return {
    success: true,
    workspacePath: result.workspacePath,
    filesCreated: summarizeArray(result.filesCreated, opts),
    dirsCreated: summarizeArray(result.dirsCreated, opts),
  };
}

/**
 * Create a fresh workspace in an empty (or nonexistent) directory.
 *
 * `init` is sugar for `adopt --apply` on an empty directory — this function
 * delegates to the same plan/apply engine (`src/lib/adopt.ts`) so there is
 * exactly one code path that decides what a vault contains. The empty-dir
 * guard is init's own contract: adopting into a populated directory is
 * `rubber-ducky adopt`'s job, where the plan is previewed first.
 */
export async function createWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, targetDir } = opts;

  // Check if target exists and is non-empty
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `Directory "${targetDir}" already exists and is not empty. ` +
        `init creates a fresh workspace — use \`rubber-ducky adopt ${targetDir}\` to layer ` +
        `rubber-ducky into an existing directory non-destructively.`
      );
    }
  }

  const plan = planAdopt(targetDir, { name });
  const result = applyAdopt(plan);

  return {
    workspacePath: result.workspacePath,
    filesCreated: result.created,
    dirsCreated: [...DIRS],
  };
}

export interface WorkspaceConfig {
  name: string;
  /**
   * Optional. Silent `init` does not collect a purpose; only workspaces
   * created by older flows or hand-edited will have one. Consumers must
   * handle absence (don't render an empty `Purpose:` line, etc.).
   */
  purpose?: string;
  version: string;
  created: string;
  workspaceRoot: string;
}

/**
 * Walk up from startDir looking for a directory containing workspace.md.
 * Returns the absolute path of the workspace root, or null if none found.
 */
export function findWorkspaceRoot(startDir?: string): string | null {
  let current = path.resolve(startDir ?? process.cwd());

  while (true) {
    if (fs.existsSync(path.join(current, "workspace.md"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}

/**
 * Read and parse workspace.md frontmatter from a workspace root directory.
 * Throws if workspace.md is missing or has no valid YAML frontmatter.
 */
export function loadWorkspaceConfig(workspaceRoot: string): WorkspaceConfig {
  const wsFile = path.join(workspaceRoot, "workspace.md");

  if (!fs.existsSync(wsFile)) {
    throw new Error(`workspace.md not found in "${workspaceRoot}"`);
  }

  // Single parser for all frontmatter — a second regex here would drift
  // from the canonical one in frontmatter.ts (and did, historically).
  const content = fs.readFileSync(wsFile, "utf-8");
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    throw new Error(
      `Invalid workspace.md: no YAML frontmatter found in "${wsFile}"`
    );
  }

  const frontmatter = parsed.data as {
    name: string;
    purpose?: string;
    version: string;
    created: string;
  };

  return {
    name: frontmatter.name,
    purpose: frontmatter.purpose,
    version: frontmatter.version,
    created: frontmatter.created,
    workspaceRoot,
  };
}
