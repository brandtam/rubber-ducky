import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateClaudeSettings,
  generateContextPageTemplates,
  generateGitignore,
  generateReferenceFiles,
  VAULT_SETTINGS_TEMPLATE,
} from "./templates.js";
import { SETTINGS_FILENAME } from "./settings.js";
import { summarizeArray, type ArrayEnvelope } from "./output.js";

// User-facing content dirs that start empty. Git doesn't track empty folders,
// so scaffolded workspaces drop a `.gitkeep` in each to keep them in the repo.
const GITKEEP_DIRS = new Set([
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "wiki/meetings",
  "wiki/spikes",
  "wiki/weekly",
  "wiki/repos",
  "raw",
]);

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

const DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "wiki/meetings",
  "wiki/spikes",
  "wiki/weekly",
  "wiki/repos",
  "raw",
  "references",
  ".rubber-ducky/transactions",
];

/**
 * Install reference files and Claude Code settings into a workspace
 * directory. Called by createWorkspace. Skills, agents, and examples are
 * plugin-resident — the CLI never copies them into vaults.
 */
interface InstalledFiles {
  refs: string[];
  settings: string;
}

function installWorkspaceFiles(targetDir: string): InstalledFiles {
  // Reference template files (frontmatter-templates, when-to-use-cli)
  const refs = generateReferenceFiles();
  for (const ref of refs) {
    const refPath = path.join(targetDir, ref.path);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    fs.writeFileSync(refPath, ref.content, "utf-8");
  }

  // Claude Code settings (permissions for CLI, git, etc.)
  const settingsPath = path.join(targetDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, generateClaudeSettings(), "utf-8");

  return {
    refs: refs.map((r) => r.path),
    settings: ".claude/settings.json",
  };
}

export async function createWorkspace(opts: WorkspaceOptions): Promise<WorkspaceResult> {
  const { name, targetDir } = opts;

  // Check if target exists and is non-empty
  if (fs.existsSync(targetDir)) {
    const entries = fs.readdirSync(targetDir);
    if (entries.length > 0) {
      throw new Error(
        `Directory "${targetDir}" already exists and is not empty. ` +
        `init creates a fresh workspace — choose an empty directory or remove existing content first.`
      );
    }
  }

  // Create workspace directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Create subdirectories. Git doesn't track empty folders, so drop a
  // `.gitkeep` in each user-facing content dir so it survives the first commit.
  for (const dir of DIRS) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
    if (GITKEEP_DIRS.has(dir)) {
      fs.writeFileSync(path.join(targetDir, dir, ".gitkeep"), "", "utf-8");
    }
  }

  const templateOpts = { name };

  // Integration-specific scaffolding is never generated at init time — that
  // lands when the user runs `/connect <integration>` from inside Claude.
  const coreFiles: Array<{ name: string; content: string }> = [
    { name: "workspace.md", content: generateWorkspaceMd(templateOpts) },
    { name: "CLAUDE.md", content: generateClaudeMd(templateOpts) },
    { name: ".gitignore", content: generateGitignore() },
    // Vault-level settings: confirm-policy, ingest controls, and any future
    // vault-level knob. Generated at init so users never see a "settings
    // missing" error and can immediately tune defaults. Inline comments in
    // the template explain each key.
    { name: SETTINGS_FILENAME, content: VAULT_SETTINGS_TEMPLATE },
  ];

  for (const file of coreFiles) {
    const filePath = path.join(targetDir, file.name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, "utf-8");
  }

  // Scaffold ongoing-context-capture pages. The `/ingest-writing` skill
  // appends to these throughout the vault's lifetime; pre-creating them
  // means the user (and the Agent) can see the schema from day one rather
  // than discovering it lazily on first paste.
  const contextPages = generateContextPageTemplates();
  for (const page of contextPages) {
    const pagePath = path.join(targetDir, page.relativePath);
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, page.content, "utf-8");
  }

  // Install references and settings.
  const installed = installWorkspaceFiles(targetDir);

  return {
    workspacePath: targetDir,
    filesCreated: [
      ...coreFiles.map((f) => f.name),
      ...contextPages.map((p) => p.relativePath),
      ...installed.refs,
      installed.settings,
    ],
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
    workspaceRoot,
  };
}
