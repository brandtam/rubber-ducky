import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runDoctor, type DoctorCheck, type DoctorResult } from "../lib/doctor.js";

function createWorkspace(tmpDir: string, opts?: {
  skipDirs?: string[];
  skipFiles?: string[];
}): string {
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
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      `---\nname: test-workspace\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\n---\n\n# Test\n`,
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

  describe("wishlist check", () => {
    it("passes with a 'no projects' message when projects directory is missing", async () => {
      createWorkspace(tmpDir, { skipDirs: ["wiki/projects"] });
      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check).toBeDefined();
      expect(check!.pass).toBe(true);
      expect(check!.message).toMatch(/no projects directory/i);
    });

    it("passes when no projects have data_sources", async () => {
      createWorkspace(tmpDir);
      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check!.pass).toBe(true);
      expect(check!.message).toMatch(/no open data-source wishlists/i);
    });

    it("reports wishlist entries from project pages", async () => {
      createWorkspace(tmpDir);
      const projectsDir = path.join(tmpDir, "wiki/projects");
      fs.writeFileSync(
        path.join(projectsDir, "housing-search.md"),
        `---
title: Housing Search
type: project
created: "2026-05-09"
data_sources:
  - sniff:https://www.redfin.com
  - wishlist:mls
---

## Description
`,
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projectsDir, "personal-finances.md"),
        `---
title: Personal Finances
type: project
created: "2026-05-09"
data_sources:
  - mercury
---
`,
        "utf-8",
      );

      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check!.pass).toBe(true);
      expect(check!.message).toContain("housing-search");
      expect(check!.message).toContain("mls");
      expect(check!.message).not.toContain("personal-finances →");
    });

    it("treats bare 'wishlist:' (no suffix) as unspecified", async () => {
      createWorkspace(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "wiki/projects/x.md"),
        `---
title: X
type: project
created: "2026-05-09"
data_sources:
  - "wishlist:"
---
`,
        "utf-8",
      );

      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check!.message).toContain("unspecified");
    });

    it("ignores malformed data_sources (scalar instead of array)", async () => {
      createWorkspace(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "wiki/projects/x.md"),
        `---
title: X
type: project
created: "2026-05-09"
data_sources: not-an-array
---
`,
        "utf-8",
      );

      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check!.pass).toBe(true);
      expect(check!.message).toMatch(/no open data-source wishlists/i);
    });

    it("lists multiple wishlists across multiple projects", async () => {
      createWorkspace(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "wiki/projects/a.md"),
        `---
title: A
type: project
created: "2026-05-09"
data_sources:
  - wishlist:mls
  - wishlist:vanguard-api
---
`,
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "wiki/projects/b.md"),
        `---
title: B
type: project
created: "2026-05-09"
data_sources:
  - wishlist:patreon
---
`,
        "utf-8",
      );

      const result = await runDoctor(tmpDir);
      const check = result.checks.find((c) => c.name === "wishlist");
      expect(check!.message).toContain("3 open");
      expect(check!.message).toContain("mls");
      expect(check!.message).toContain("vanguard-api");
      expect(check!.message).toContain("patreon");
    });
  });
});
