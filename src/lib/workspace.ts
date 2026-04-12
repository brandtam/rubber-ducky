import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
  type BackendConfig,
  type VocabularyOptions,
} from "./templates.js";

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
  const templateOpts = { name, purpose, backends: opts.backends };

  const files: Array<{ name: string; content: string }> = [
    { name: "workspace.md", content: generateWorkspaceMd(templateOpts) },
    { name: "CLAUDE.md", content: generateClaudeMd(templateOpts) },
    { name: "UBIQUITOUS_LANGUAGE.md", content: generateUbiquitousLanguageMd(opts.vocabulary) },
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
