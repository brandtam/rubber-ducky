import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
} from "./templates.js";

export interface WorkspaceOptions {
  name: string;
  purpose: string;
  targetDir: string;
}

export interface WorkspaceResult {
  workspacePath: string;
  filesCreated: string[];
  dirsCreated: string[];
}

const DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "raw",
  ".obsidian",
];

export async function createWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, purpose, targetDir } = opts;

  // Check if target exists and is non-empty
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `Directory "${targetDir}" already exists and is not empty. ` +
        `Choose a different location or remove existing files.`
      );
    }
  }

  // Create workspace directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Create subdirectories
  for (const dir of DIRS) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }

  // Generate and write files
  const templateOpts = { name, purpose };

  const files: Array<{ name: string; content: string }> = [
    { name: "workspace.md", content: generateWorkspaceMd(templateOpts) },
    { name: "CLAUDE.md", content: generateClaudeMd(templateOpts) },
    { name: "UBIQUITOUS_LANGUAGE.md", content: generateUbiquitousLanguageMd() },
  ];

  for (const file of files) {
    fs.writeFileSync(path.join(targetDir, file.name), file.content, "utf-8");
  }

  return {
    workspacePath: targetDir,
    filesCreated: files.map((f) => f.name),
    dirsCreated: DIRS.filter((d) => d !== ".obsidian"),
  };
}

export interface WorkspaceConfig {
  name: string;
  purpose: string;
  version: string;
  created: string;
  backends: string[];
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

  const content = fs.readFileSync(wsFile, "utf-8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    throw new Error(
      `Invalid workspace.md: no YAML frontmatter found in "${wsFile}"`
    );
  }

  const frontmatter = parseYaml(match[1]);

  return {
    name: frontmatter.name,
    purpose: frontmatter.purpose,
    version: frontmatter.version,
    created: frontmatter.created,
    backends: frontmatter.backends ?? [],
    workspaceRoot,
  };
}
