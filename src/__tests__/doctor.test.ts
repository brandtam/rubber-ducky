import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runDoctor, type DoctorCheck, type DoctorResult } from "../lib/doctor.js";

function createWorkspace(tmpDir: string, opts?: {
  backends?: Array<{ type: string; mcp_server: string }>;
  skipDirs?: string[];
  skipFiles?: string[];
}): string {
  const backends = opts?.backends ?? [];
  const skipDirs = opts?.skipDirs ?? [];
  const skipFiles = opts?.skipFiles ?? [];

  // Create directory structure
  const dirs = ["wiki/daily", "wiki/tasks", "wiki/projects", "raw"];
  for (const dir of dirs) {
    if (!skipDirs.includes(dir)) {
      fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
    }
  }

  // Create workspace.md
  if (!skipFiles.includes("workspace.md")) {
    const backendsYaml = backends.length > 0
      ? `backends:\n${backends.map(b => `  - type: ${b.type}\n    mcp_server: ${b.mcp_server}`).join("\n")}`
      : "backends: []";

    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      `---\nname: test-workspace\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\n${backendsYaml}\n---\n\n# Test\n`,
      "utf-8"
    );
  }

  // Create CLAUDE.md
  if (!skipFiles.includes("CLAUDE.md")) {
    fs.writeFileSync(
      path.join(tmpDir, "CLAUDE.md"),
      "# Test\n",
      "utf-8"
    );
  }

  // Create UBIQUITOUS_LANGUAGE.md
  if (!skipFiles.includes("UBIQUITOUS_LANGUAGE.md")) {
    fs.writeFileSync(
      path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"),
      "# Ubiquitous Language\n",
      "utf-8"
    );
  }

  // Create skill/agent files (one stub per bundled template)
  if (!skipFiles.includes("skills")) {
    fs.mkdirSync(path.join(tmpDir, ".claude", "commands"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/good-morning.md"), "# Good Morning\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/wrap-up.md"), "# Wrap Up\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/lint.md"), "# Lint\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/query.md"), "# Query\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/push.md"), "# Push\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/comment.md"), "# Comment\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/transition.md"), "# Transition\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/pull-active.md"), "# Pull Active\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/reconcile.md"), "# Reconcile\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/start.md"), "# Start\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/close.md"), "# Close\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/asap-process.md"), "# ASAP Process\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/ubiquitous-language.md"), "# Ubiquitous Language\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/grill-me.md"), "# Grill Me\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/link.md"), "# Link\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/configure-status-mapping.md"), "# Configure Status Mapping\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/commands/triage.md"), "# Triage\n", "utf-8");
  }

  if (!skipFiles.includes("agents")) {
    fs.mkdirSync(path.join(tmpDir, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".claude/agents/work-historian.md"), "# Work Historian\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/agents/linter.md"), "# Linter\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/agents/ticket-writer.md"), "# Ticket Writer\n", "utf-8");
    fs.writeFileSync(path.join(tmpDir, ".claude/agents/research-partner.md"), "# Research Partner\n", "utf-8");
  }

  return tmpDir;
}

describe("Doctor module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-doctor-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("runDoctor", () => {
    it("returns all-pass for a healthy workspace", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      expect(result.healthy).toBe(true);
      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.checks.every((c: DoctorCheck) => c.pass)).toBe(true);
    });

    it("checks workspace.md exists and is valid", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "workspace-config");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
    });

    it("fails workspace-config check when workspace.md is missing", async () => {
      createWorkspace(tmpDir, { skipFiles: ["workspace.md"] });
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "workspace-config");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
      expect(check!.message).toMatch(/workspace\.md/i);
    });

    it("fails workspace-config check when workspace.md has invalid frontmatter", async () => {
      createWorkspace(tmpDir);
      // Overwrite with invalid content
      fs.writeFileSync(path.join(tmpDir, "workspace.md"), "no frontmatter here\n", "utf-8");
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "workspace-config");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
    });

    it("checks directory structure", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "directory-structure");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
    });

    it("fails directory-structure check when wiki dirs are missing", async () => {
      createWorkspace(tmpDir, { skipDirs: ["wiki/tasks"] });
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "directory-structure");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
      expect(check!.message).toMatch(/wiki\/tasks/);
    });

    it("checks skill files are present", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "skill-files");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
    });

    it("fails skill-files check when skills are missing", async () => {
      createWorkspace(tmpDir, { skipFiles: ["skills"] });
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "skill-files");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
    });

    it("checks agent files are present", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "agent-files");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
    });

    it("fails agent-files check when agents are missing", async () => {
      createWorkspace(tmpDir, { skipFiles: ["agents"] });
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "agent-files");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
    });

    it("checks backend connectivity with mock exec", async () => {
      createWorkspace(tmpDir, {
        backends: [{ type: "github", mcp_server: "github" }],
      });
      const result = await runDoctor(tmpDir, {
        backendExec: () => "Logged in to github.com account testuser",
      });

      const check = result.checks.find((c: DoctorCheck) => c.name === "backend-connectivity");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
    });

    it("fails backend-connectivity check when backend auth fails", async () => {
      createWorkspace(tmpDir, {
        backends: [{ type: "github", mcp_server: "github" }],
      });
      const result = await runDoctor(tmpDir, {
        backendExec: () => { throw new Error("not authenticated"); },
      });

      const check = result.checks.find((c: DoctorCheck) => c.name === "backend-connectivity");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(false);
    });

    it("skips backend-connectivity check when no backends configured", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      const check = result.checks.find((c: DoctorCheck) => c.name === "backend-connectivity");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
      expect(check!.message).toMatch(/no backends/i);
    });

    it("reports overall healthy=false when any check fails", async () => {
      createWorkspace(tmpDir, { skipDirs: ["wiki/tasks"] });
      const result = await runDoctor(tmpDir);

      expect(result.healthy).toBe(false);
      expect(result.passed).toBeLessThan(result.total);
    });

    it("includes passed/total counts", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);

      expect(result.passed).toBe(result.total);
      expect(result.total).toBeGreaterThan(0);
    });
  });
});
