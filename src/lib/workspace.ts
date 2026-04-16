import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateClaudeSettings,
  generateUbiquitousLanguageMd,
  generateStatusMappingMd,
  generateGitignore,
  generateEnvExample,
  generateBackendSkills,
  generateReferenceFiles,
  type BackendConfig,
  type VocabularyOptions,
  type IngestScope,
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
  ingest_scope?: IngestScope;
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
  ".rubber-ducky/transactions",
];

export interface ExistingContentInfo {
  scanResult: ScanResult;
  migrationPlan: MigrationPlan;
}

/**
 * Install bundled skills, backend-specific skills, reference files, and
 * Claude Code settings into a workspace directory. Called by both
 * createWorkspace and migrateWorkspace so the installation logic lives
 * in one place.
 */
interface InstalledFiles {
  bundled: string[];
  skills: string[];
  refs: string[];
  settings: string;
}

function installWorkspaceFiles(targetDir: string, backends?: BackendConfig[]): InstalledFiles {
  // Bundled skills and agents (good-morning, wrap-up, grill-me, etc.)
  const bundled = getBundledTemplates();
  for (const template of bundled) {
    const templatePath = path.join(targetDir, template.relativePath);
    fs.mkdirSync(path.dirname(templatePath), { recursive: true });
    fs.writeFileSync(templatePath, template.content, "utf-8");
  }

  // Backend-specific skill files (ingest-github, ingest-asana, ingest-jira)
  const skills = generateBackendSkills(backends);
  for (const skill of skills) {
    const skillPath = path.join(targetDir, skill.path);
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, skill.content, "utf-8");
  }

  // Reference template files (frontmatter-templates, ticket templates, etc.)
  const refs = generateReferenceFiles(backends);
  for (const ref of refs) {
    const refPath = path.join(targetDir, ref.path);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, ref.content, "utf-8");
  }

  // Claude Code settings (permissions for CLI, git, gh, etc.)
  const settingsPath = path.join(targetDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, generateClaudeSettings(backends), "utf-8");

  return {
    bundled: bundled.map((t) => t.relativePath),
    skills: skills.map((s) => s.path),
    refs: refs.map((r) => r.path),
    settings: ".claude/settings.json",
  };
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

  // Generate and write core config files
  const templateOpts = { name, purpose, backends: opts.backends, ingest_scope: opts.ingest_scope };

  const coreFiles: Array<{ name: string; content: string }> = [
    { name: "workspace.md", content: generateWorkspaceMd(templateOpts) },
    { name: "CLAUDE.md", content: generateClaudeMd(templateOpts) },
    { name: "UBIQUITOUS_LANGUAGE.md", content: generateUbiquitousLanguageMd(opts.vocabulary) },
    { name: "wiki/status-mapping.md", content: generateStatusMappingMd(opts.backends) },
    { name: ".gitignore", content: generateGitignore() },
    { name: ".env.example", content: generateEnvExample(opts.backends) },
  ];

  for (const file of coreFiles) {
    const filePath = path.join(targetDir, file.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, "utf-8");
  }

  // Install bundled skills, backend skills, references, and settings
  const installed = installWorkspaceFiles(targetDir, opts.backends);

  return {
    workspacePath: targetDir,
    filesCreated: [
      ...coreFiles.map((f) => f.name),
      ...installed.bundled,
      ...installed.skills,
      ...installed.refs,
      installed.settings,
    ],
    dirsCreated: DIRS.filter((d) => d !== ".obsidian"),
  };
}

export async function migrateWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, purpose, targetDir } = opts;

  // Back up existing CLAUDE.md before migration overwrites it.
  // Only create a backup if one doesn't already exist — if the user re-runs
  // migration before merging, we preserve the original rather than overwriting
  // the backup with the bundled version from the first migration.
  const claudeMdPath = path.join(targetDir, "CLAUDE.md");
  const backupPath = path.join(targetDir, "CLAUDE.md.backup");
  let claudeMdBackedUp: boolean | undefined;
  if (fs.existsSync(claudeMdPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(claudeMdPath, backupPath);
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

  // Write .gitignore if missing (don't overwrite existing)
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, generateGitignore(), "utf-8");
    result.filesCreated.push(".gitignore");
  }

  // Write .env.example if missing
  const envExamplePath = path.join(targetDir, ".env.example");
  if (!fs.existsSync(envExamplePath)) {
    fs.writeFileSync(envExamplePath, generateEnvExample(opts.backends), "utf-8");
    result.filesCreated.push(".env.example");
  }

  // Write wiki/status-mapping.md if missing
  const statusMappingPath = path.join(targetDir, "wiki", "status-mapping.md");
  if (!fs.existsSync(statusMappingPath)) {
    fs.mkdirSync(path.dirname(statusMappingPath), { recursive: true });
    fs.writeFileSync(statusMappingPath, generateStatusMappingMd(opts.backends), "utf-8");
    result.filesCreated.push("wiki/status-mapping.md");
  }

  // Install bundled skills, backend skills, references, and settings
  const installed = installWorkspaceFiles(targetDir, opts.backends);

  return {
    workspacePath: result.workspacePath,
    filesCreated: [...result.filesCreated, ...installed.bundled, ...installed.skills, ...installed.refs, installed.settings],
    dirsCreated: result.dirsCreated,
    filesAdopted: result.filesAdopted,
    migrated: true,
    claudeMdBackedUp,
  };
}

export type { IngestScope } from "./templates.js";

export interface WorkspaceConfig {
  name: string;
  purpose: string;
  version: string;
  created: string;
  backends: BackendConfig[];
  workspaceRoot: string;
  ingest_scope?: IngestScope;
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
    ingest_scope: frontmatter.ingest_scope,
  };
}

/**
 * Update specific fields on a backend entry in workspace.md.
 * Merges `fields` into the first backend matching `backendType`,
 * preserving existing fields and the markdown body.
 */
export function updateWorkspaceBackend(
  workspaceRoot: string,
  backendType: string,
  fields: Record<string, unknown>,
): void {
  const wsFile = path.join(workspaceRoot, "workspace.md");
  const content = fs.readFileSync(wsFile, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    throw new Error(`Invalid workspace.md: no YAML frontmatter found`);
  }

  const body = content.slice(fmMatch[0].length);
  const frontmatter = parseYaml(fmMatch[1]);
  const backends: Record<string, unknown>[] = frontmatter.backends ?? [];

  const idx = backends.findIndex(
    (b) => b.type === backendType
  );
  if (idx === -1) {
    throw new Error(`No ${backendType} backend found in workspace.md`);
  }

  backends[idx] = { ...backends[idx], ...fields };
  frontmatter.backends = backends;

  const newFrontmatter = yamlStringify(frontmatter).trimEnd();
  fs.writeFileSync(wsFile, `---\n${newFrontmatter}\n---${body}`, "utf-8");
}
