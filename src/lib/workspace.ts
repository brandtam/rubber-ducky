import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
} from "./templates.js";
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
}

export interface WorkspaceResult {
  workspacePath: string;
  filesCreated: string[];
  dirsCreated: string[];
  filesAdopted?: string[];
  migrated?: boolean;
}

const DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "raw",
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

export async function migrateWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, purpose, targetDir } = opts;

  const scanResult = scanExistingContent(targetDir);
  const plan = buildMigrationPlan(scanResult);
  const result = executeMigration(plan, { name, purpose, targetDir });

  return {
    workspacePath: result.workspacePath,
    filesCreated: result.filesCreated,
    dirsCreated: result.dirsCreated,
    filesAdopted: result.filesAdopted,
    migrated: true,
  };
}
