import * as fs from "node:fs";
import * as path from "node:path";
import { loadWorkspaceConfig } from "./workspace.js";
import { parseFrontmatter } from "./frontmatter.js";

const WISHLIST_PREFIX = "wishlist:";

export interface DoctorCheck {
  name: string;
  pass: boolean;
  message: string;
}

export interface DoctorResult {
  healthy: boolean;
  checks: DoctorCheck[];
  passed: number;
  total: number;
}

const REQUIRED_DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "raw",
];

/**
 * Run all doctor checks against a workspace root directory.
 * Returns a structured result with pass/fail per check.
 */
export async function runDoctor(workspaceRoot: string): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  checks.push(checkWorkspaceConfig(workspaceRoot));
  checks.push(checkDirectoryStructure(workspaceRoot));
  checks.push(checkWishlist(workspaceRoot));

  const passed = checks.filter((c) => c.pass).length;

  return {
    healthy: checks.every((c) => c.pass),
    checks,
    passed,
    total: checks.length,
  };
}

function checkWorkspaceConfig(workspaceRoot: string): DoctorCheck {
  const wsFile = path.join(workspaceRoot, "workspace.md");

  if (!fs.existsSync(wsFile)) {
    return {
      name: "workspace-config",
      pass: false,
      message: "workspace.md not found",
    };
  }

  try {
    const config = loadWorkspaceConfig(workspaceRoot);
    if (!config.name) {
      return {
        name: "workspace-config",
        pass: false,
        message: "workspace.md is missing required field (name)",
      };
    }
    return {
      name: "workspace-config",
      pass: true,
      message: "workspace.md is valid",
    };
  } catch (error) {
    return {
      name: "workspace-config",
      pass: false,
      message: error instanceof Error ? error.message : "Invalid workspace.md",
    };
  }
}

function checkDirectoryStructure(workspaceRoot: string): DoctorCheck {
  const missing: string[] = [];

  for (const dir of REQUIRED_DIRS) {
    if (!fs.existsSync(path.join(workspaceRoot, dir))) {
      missing.push(dir);
    }
  }

  if (missing.length > 0) {
    return {
      name: "directory-structure",
      pass: false,
      message: `Missing directories: ${missing.join(", ")}`,
    };
  }

  return {
    name: "directory-structure",
    pass: true,
    message: "All required directories present",
  };
}

function checkWishlist(workspaceRoot: string): DoctorCheck {
  const projectsDir = path.join(workspaceRoot, "wiki/projects");
  if (!fs.existsSync(projectsDir)) {
    return {
      name: "wishlist",
      pass: true,
      message: "No projects directory — nothing to scan for data-source wishlists",
    };
  }

  const items: Array<{ project: string; wish: string }> = [];
  for (const entry of fs.readdirSync(projectsDir)) {
    if (!entry.endsWith(".md")) continue;
    const filePath = path.join(projectsDir, entry);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const dataSources = parsed.data.data_sources;
    if (!Array.isArray(dataSources)) continue;

    for (const source of dataSources) {
      if (typeof source !== "string") continue;
      if (!source.startsWith(WISHLIST_PREFIX)) continue;
      const suffix = source.slice(WISHLIST_PREFIX.length);
      items.push({
        project: entry.replace(/\.md$/, ""),
        wish: suffix.length > 0 ? suffix : "unspecified",
      });
    }
  }

  if (items.length === 0) {
    return {
      name: "wishlist",
      pass: true,
      message: "No open data-source wishlists",
    };
  }

  const lines = items.map((i) => `  ${i.project} → ${i.wish}`).join("\n");
  return {
    name: "wishlist",
    pass: true,
    message: `${items.length} open data-source wishlist${items.length === 1 ? "" : "s"}:\n${lines}`,
  };
}
