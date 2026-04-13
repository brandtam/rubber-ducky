import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateClaudeSettings,
  generateUbiquitousLanguageMd,
  generateBackendSkills,
  generateReferenceFiles,
  type BackendConfig,
  type VocabularyOptions,
} from "./templates.js";
import { getBundledTemplates } from "./update.js";
import {
  scanExistingContent,
  buildMigrationPlan,
  executeMigration,
  type ScanResult,
  type MigrationPlan,
} from "./migration.js";

export interface WorkspaceOptions {
  name: string;
  purpose: string;
  targetDir: string;
  backends?: BackendConfig[];
  vocabulary?: VocabularyOptions;
}

export interface WorkspaceResult {
  workspacePath: string;
  filesCreated: string[];
  dirsCreated: string[];
  filesAdopted?: string[];
  migrated?: boolean;
  claudeMdBackedUp?: boolean;
}

const DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "raw",
  "references",
  ".obsidian",
];

export interface ExistingContentInfo {
  scanResult: ScanResult;
  migrationPlan: MigrationPlan;
}

export function detectExistingContent(targetDir: string): ExistingContentInfo | null {
  if (!fs.existsSync(targetDir)) return null;
  const entries = fs.readdirSync(targetDir);
  if (entries.length === 0) return null;

  const scanResult = scanExistingContent(targetDir);
  const migrationPlan = buildMigrationPlan(scanResult);
  return { scanResult, migrationPlan };
}

export async function createWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, purpose, targetDir } = opts;

  // Check if target exists and is non-empty
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `Directory "${targetDir}" already exists and is not empty. ` +
        `Use migration to adopt existing content.`
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
  const templateOpts = { name, purpose, backends: opts.backends };

  const files: Array<{ name: string; content: string }> = [
    { name: "workspace.md", content: generateWorkspaceMd(templateOpts) },
    { name: "CLAUDE.md", content: generateClaudeMd(templateOpts) },
    { name: "UBIQUITOUS_LANGUAGE.md", content: generateUbiquitousLanguageMd(opts.vocabulary) },
    { name: ".claude/settings.json", content: generateClaudeSettings(opts.backends) },
  ];

  for (const file of files) {
    const filePath = path.join(targetDir, file.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, "utf-8");
  }

  // Install bundled skills and agents (good-morning, wrap-up, commit, etc.)
  const bundled = getBundledTemplates();
  for (const template of bundled) {
    const templatePath = path.join(targetDir, template.relativePath);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, template.content, "utf-8");
  }

  // Generate backend-specific skill files (ingest-github, ingest-asana, etc.)
  const skills = generateBackendSkills(opts.backends);
  for (const skill of skills) {
    const skillPath = path.join(targetDir, skill.path);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, skill.content, "utf-8");
  }

  // Generate reference template files
  const refs = generateReferenceFiles(opts.backends);
  for (const ref of refs) {
    const refPath = path.join(targetDir, ref.path);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, ref.content, "utf-8");
  }

  return {
    workspacePath: targetDir,
    filesCreated: [
      ...files.map((f) => f.name),
      ...bundled.map((t) => t.relativePath),
      ...skills.map((s) => s.path),
      ...refs.map((r) => r.path),
    ],
    dirsCreated: DIRS.filter((d) => d !== ".obsidian"),
  };
}

export async function migrateWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, purpose, targetDir } = opts;

  // Back up existing CLAUDE.md before migration overwrites it
  const claudeMdPath = path.join(targetDir, "CLAUDE.md");
  let claudeMdBackedUp: boolean | undefined;
  if (fs.existsSync(claudeMdPath)) {
    fs.copyFileSync(claudeMdPath, path.join(targetDir, "CLAUDE.md.backup"));
    claudeMdBackedUp = true;
  }

  const scanResult = scanExistingContent(targetDir);
  const plan = buildMigrationPlan(scanResult);
  const result = executeMigration(plan, { name, purpose, targetDir });

  // Always write the bundled CLAUDE.md (executeMigration skips it if one existed)
  if (!result.filesCreated.includes("CLAUDE.md")) {
    const templateOpts = { name, purpose, backends: opts.backends };
    fs.writeFileSync(claudeMdPath, generateClaudeMd(templateOpts), "utf-8");
    result.filesCreated.push("CLAUDE.md");
  }

  // Install bundled skills and agents (same as createWorkspace)
  const bundled = getBundledTemplates();
  for (const template of bundled) {
    const templatePath = path.join(targetDir, template.relativePath);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, template.content, "utf-8");
  }

  // Generate reference files (same as createWorkspace)
  const refs = generateReferenceFiles(opts.backends);
  for (const ref of refs) {
    const refPath = path.join(targetDir, ref.path);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, ref.content, "utf-8");
  }

  // Generate Claude Code settings
  const settingsPath = path.join(targetDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, generateClaudeSettings(opts.backends), "utf-8");

  return {
    workspacePath: result.workspacePath,
    filesCreated: [...result.filesCreated, ...bundled.map((t) => t.relativePath), ...refs.map((r) => r.path), ".claude/settings.json"],
    dirsCreated: result.dirsCreated,
    filesAdopted: result.filesAdopted,
    migrated: true,
    claudeMdBackedUp,
  };
}

export interface WorkspaceConfig {
  name: string;
  purpose: string;
  version: string;
  created: string;
  cli_mode: boolean;
  backends: BackendConfig[];
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
    cli_mode: frontmatter.cli_mode ?? true,
    backends: frontmatter.backends ?? [],
    workspaceRoot,
  };
}
