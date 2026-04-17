import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
} from "./templates.js";

export interface ExistingFile {
  relativePath: string;
  hasFrontmatter: boolean;
  frontmatter?: Record<string, unknown>;
}

export interface DirectoryStructure {
  hasDaily: boolean;
  hasTasks: boolean;
  hasProjects: boolean;
  hasRaw: boolean;
  hasObsidian: boolean;
}

export interface ScanResult {
  files: ExistingFile[];
  directories: DirectoryStructure;
  totalMdFiles: number;
  filesWithFrontmatter: number;
}

const IGNORED_DIRS = new Set([".obsidian", ".git", "node_modules", ".claude"]);

// User-facing content dirs that start empty. Git doesn't track empty folders,
// so scaffolded workspaces drop a `.gitkeep` in each to keep them in the repo.
export const GITKEEP_DIRS = new Set(["wiki/daily", "wiki/tasks", "wiki/projects", "raw"]);

function collectMdFiles(dir: string, baseDir: string): ExistingFile[] {
  const files: ExistingFile[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...collectMdFiles(path.join(dir, entry.name), baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      const content = fs.readFileSync(fullPath, "utf-8");
      const parsed = parseFrontmatter(content);

      files.push({
        relativePath,
        hasFrontmatter: parsed.hasFrontmatter,
        frontmatter: parsed.frontmatter,
      });
    }
  }

  return files;
}

function parseFrontmatter(content: string): {
  hasFrontmatter: boolean;
  frontmatter?: Record<string, unknown>;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { hasFrontmatter: false };

  try {
    const frontmatter = parseYaml(match[1]);
    if (typeof frontmatter === "object" && frontmatter !== null) {
      return { hasFrontmatter: true, frontmatter: frontmatter as Record<string, unknown> };
    }
    return { hasFrontmatter: false };
  } catch {
    return { hasFrontmatter: false };
  }
}

function detectDirectories(dir: string): DirectoryStructure {
  const dirExists = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

  return {
    hasDaily: dirExists(path.join(dir, "daily")) || dirExists(path.join(dir, "wiki", "daily")),
    hasTasks: dirExists(path.join(dir, "tasks")) || dirExists(path.join(dir, "wiki", "tasks")),
    hasProjects: dirExists(path.join(dir, "projects")) || dirExists(path.join(dir, "wiki", "projects")),
    hasRaw: dirExists(path.join(dir, "raw")),
    hasObsidian: dirExists(path.join(dir, ".obsidian")),
  };
}

export function scanExistingContent(dir: string): ScanResult {
  const files = collectMdFiles(dir, dir);
  const directories = detectDirectories(dir);

  return {
    files,
    directories,
    totalMdFiles: files.length,
    filesWithFrontmatter: files.filter((f) => f.hasFrontmatter).length,
  };
}

export interface MigrationPlan {
  dirsToCreate: string[];
  filesToAddFrontmatter: string[];
  filesToUpdateFrontmatter: string[];
  templateFilesToCreate: string[];
  adoptedFiles: string[];
}

export interface MigrationResult {
  workspacePath: string;
  filesCreated: string[];
  dirsCreated: string[];
  filesAdopted: string[];
}

const TEMPLATE_FILES = ["workspace.md", "CLAUDE.md", "UBIQUITOUS_LANGUAGE.md"];

export function buildMigrationPlan(scan: ScanResult): MigrationPlan {
  const dirsToCreate: string[] = [];
  if (!scan.directories.hasDaily) dirsToCreate.push("wiki/daily");
  if (!scan.directories.hasTasks) dirsToCreate.push("wiki/tasks");
  if (!scan.directories.hasProjects) dirsToCreate.push("wiki/projects");
  if (!scan.directories.hasRaw) dirsToCreate.push("raw");
  if (!scan.directories.hasObsidian) dirsToCreate.push(".obsidian");

  const existingPaths = new Set(scan.files.map((f) => f.relativePath));

  const filesToAddFrontmatter: string[] = [];
  const filesToUpdateFrontmatter: string[] = [];
  const adoptedFiles: string[] = [];

  for (const file of scan.files) {
    // Skip template files from adoption processing — they get special treatment
    if (TEMPLATE_FILES.includes(file.relativePath)) continue;

    adoptedFiles.push(file.relativePath);
    if (file.hasFrontmatter) {
      filesToUpdateFrontmatter.push(file.relativePath);
    } else {
      filesToAddFrontmatter.push(file.relativePath);
    }
  }

  const templateFilesToCreate = TEMPLATE_FILES.filter(
    (f) => !existingPaths.has(f)
  );

  return {
    dirsToCreate,
    filesToAddFrontmatter,
    filesToUpdateFrontmatter,
    templateFilesToCreate,
    adoptedFiles,
  };
}

interface MigrationOptions {
  name: string;
  purpose: string;
  targetDir: string;
}

export function executeMigration(
  plan: MigrationPlan,
  opts: MigrationOptions
): MigrationResult {
  const { name, purpose, targetDir } = opts;
  const filesCreated: string[] = [];

  // Create missing directories. For user-facing content dirs that start empty,
  // also drop a `.gitkeep` so git tracks the folder in the initial commit.
  for (const dir of plan.dirsToCreate) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
    if (GITKEEP_DIRS.has(dir)) {
      fs.writeFileSync(path.join(targetDir, dir, ".gitkeep"), "", "utf-8");
    }
  }

  // Create template files
  const templateOpts = { name, purpose };
  const templateGenerators: Record<string, () => string> = {
    "workspace.md": () => generateWorkspaceMd(templateOpts),
    "CLAUDE.md": () => generateClaudeMd(templateOpts),
    "UBIQUITOUS_LANGUAGE.md": () => generateUbiquitousLanguageMd(),
  };

  for (const templateFile of plan.templateFilesToCreate) {
    const generator = templateGenerators[templateFile];
    if (generator) {
      fs.writeFileSync(path.join(targetDir, templateFile), generator(), "utf-8");
      filesCreated.push(templateFile);
    }
  }

  // Add frontmatter to files that don't have it
  for (const relativePath of plan.filesToAddFrontmatter) {
    const fullPath = path.join(targetDir, relativePath);
    const content = fs.readFileSync(fullPath, "utf-8");
    const titleFromFilename = path.basename(relativePath, ".md");
    const frontmatter = {
      title: titleFromFilename,
    };
    const newContent = `---\n${yamlStringify(frontmatter).trimEnd()}\n---\n\n${content}`;
    fs.writeFileSync(fullPath, newContent, "utf-8");
  }

  // Files with existing well-formed frontmatter are preserved untouched

  // Generate index of content present during migration
  const allAdopted = [...plan.filesToAddFrontmatter, ...plan.filesToUpdateFrontmatter];
  if (allAdopted.length > 0) {
    const indexLines = ["# Migrated Content Index", "", "Files present during migration:", ""];
    for (const relativePath of allAdopted.sort()) {
      indexLines.push(`- [[${relativePath}]]`);
    }
    indexLines.push("");
    const indexPath = path.join(targetDir, "wiki", "index.md");
    fs.mkdirSync(path.join(targetDir, "wiki"), { recursive: true });
    fs.writeFileSync(indexPath, indexLines.join("\n"), "utf-8");
    filesCreated.push("wiki/index.md");
  }

  return {
    workspacePath: targetDir,
    filesCreated,
    dirsCreated: plan.dirsToCreate.filter((d) => d !== ".obsidian"),
    filesAdopted: allAdopted,
  };
}
