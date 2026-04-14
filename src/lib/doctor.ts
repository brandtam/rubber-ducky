import * as fs from "node:fs";
import * as path from "node:path";
import { loadWorkspaceConfig } from "./workspace.js";
import { checkConnectivity } from "./backend.js";
import { getBundledTemplates } from "./update.js";

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

export interface DoctorOptions {
  backendExec?: (args: string[]) => string;
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
export async function runDoctor(
  workspaceRoot: string,
  options?: DoctorOptions
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  checks.push(checkWorkspaceConfig(workspaceRoot));
  checks.push(checkDirectoryStructure(workspaceRoot));
  checks.push(checkSkillFiles(workspaceRoot));
  checks.push(checkAgentFiles(workspaceRoot));
  checks.push(await checkBackendConnectivity(workspaceRoot, options));

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
    if (!config.name || !config.purpose) {
      return {
        name: "workspace-config",
        pass: false,
        message: "workspace.md is missing required fields (name, purpose)",
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

function checkSkillFiles(workspaceRoot: string): DoctorCheck {
  const templates = getBundledTemplates();
  const skills = templates.filter((t) =>
    t.relativePath.startsWith(".claude/commands/")
  );

  const missing: string[] = [];
  for (const skill of skills) {
    if (!fs.existsSync(path.join(workspaceRoot, skill.relativePath))) {
      missing.push(skill.relativePath);
    }
  }

  if (missing.length > 0) {
    return {
      name: "skill-files",
      pass: false,
      message: `Missing skill files: ${missing.join(", ")}`,
    };
  }

  return {
    name: "skill-files",
    pass: true,
    message: `All ${skills.length} skill files present`,
  };
}

function checkAgentFiles(workspaceRoot: string): DoctorCheck {
  const templates = getBundledTemplates();
  const agents = templates.filter((t) =>
    t.relativePath.startsWith(".claude/agents/")
  );

  const missing: string[] = [];
  for (const agent of agents) {
    if (!fs.existsSync(path.join(workspaceRoot, agent.relativePath))) {
      missing.push(agent.relativePath);
    }
  }

  if (missing.length > 0) {
    return {
      name: "agent-files",
      pass: false,
      message: `Missing agent files: ${missing.join(", ")}`,
    };
  }

  return {
    name: "agent-files",
    pass: true,
    message: `All ${agents.length} agent files present`,
  };
}

async function checkBackendConnectivity(
  workspaceRoot: string,
  options?: DoctorOptions
): Promise<DoctorCheck> {
  let config;
  try {
    config = loadWorkspaceConfig(workspaceRoot);
  } catch {
    return {
      name: "backend-connectivity",
      pass: false,
      message: "Cannot check backends: workspace.md is invalid",
    };
  }

  if (config.backends.length === 0) {
    return {
      name: "backend-connectivity",
      pass: true,
      message: "No backends configured — skipping connectivity check",
    };
  }

  const failures: string[] = [];
  for (const bc of config.backends) {
    const result = await checkConnectivity(bc, options?.backendExec ? { exec: options.backendExec } : undefined);
    if (!result.authenticated) {
      failures.push(`${bc.type}: ${result.error ?? "not authenticated"}`);
    }
  }

  if (failures.length > 0) {
    return {
      name: "backend-connectivity",
      pass: false,
      message: `Backend connectivity failures: ${failures.join("; ")}`,
    };
  }

  return {
    name: "backend-connectivity",
    pass: true,
    message: `All ${config.backends.length} backends connected`,
  };
}
