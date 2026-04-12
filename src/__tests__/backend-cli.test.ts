import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  ".bin",
  "tsx"
);

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("backend CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "rubber-ducky-backend-cli-test-")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("backend list --json", () => {
    it("lists configured github backend with capabilities", () => {
      const target = path.join(tmpDir, "ws-gh");
      const backends = JSON.stringify([
        { type: "github", mcp_server: "github" },
      ]);
      runCli(["--json", "init", target, "--backends-json", backends]);

      const output = runCli(["--json", "backend", "list"], target);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.backends).toHaveLength(1);
      expect(result.backends[0].name).toBe("github");
      expect(result.backends[0].type).toBe("github");
      expect(result.backends[0].implemented).toBe(true);
      expect(result.backends[0].capabilities).toContain("ingest");
      expect(result.backends[0].capabilities).toContain("push");
      expect(result.backends[0].capabilities).toContain("comment");
      expect(result.backends[0].capabilities).not.toContain("pull");
      expect(result.backends[0].capabilities).not.toContain("transition");
    });

    it("lists configured asana backend with capabilities", () => {
      const target = path.join(tmpDir, "ws-asana");
      const backends = JSON.stringify([
        { type: "asana", mcp_server: "asana" },
      ]);
      runCli(["--json", "init", target, "--backends-json", backends]);

      const output = runCli(["--json", "backend", "list"], target);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.backends).toHaveLength(1);
      expect(result.backends[0].name).toBe("asana");
      expect(result.backends[0].type).toBe("asana");
      expect(result.backends[0].implemented).toBe(true);
      expect(result.backends[0].capabilities).toContain("ingest");
      expect(result.backends[0].capabilities).toContain("pull");
      expect(result.backends[0].capabilities).toContain("push");
      expect(result.backends[0].capabilities).toContain("comment");
      expect(result.backends[0].capabilities).not.toContain("transition");
    });

    it("shows empty list when no backends configured", () => {
      const target = path.join(tmpDir, "ws-empty");
      runCli(["--json", "init", target]);

      const output = runCli(["--json", "backend", "list"], target);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.backends).toHaveLength(0);
    });

    it("marks unimplemented backends appropriately", () => {
      const target = path.join(tmpDir, "ws-jira");
      const backends = JSON.stringify([
        { type: "jira", mcp_server: "atlassian-remote" },
      ]);
      runCli(["--json", "init", target, "--backends-json", backends]);

      const output = runCli(["--json", "backend", "list"], target);
      const result = JSON.parse(output);

      expect(result.backends).toHaveLength(1);
      expect(result.backends[0].name).toBe("jira");
      expect(result.backends[0].implemented).toBe(false);
      expect(result.backends[0].capabilities).toEqual([]);
    });

    it("lists multiple backends with mixed implementation status", () => {
      const target = path.join(tmpDir, "ws-multi");
      const backends = JSON.stringify([
        { type: "github", mcp_server: "github" },
        { type: "jira", mcp_server: "atlassian-remote" },
      ]);
      runCli(["--json", "init", target, "--backends-json", backends]);

      const output = runCli(["--json", "backend", "list"], target);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.backends).toHaveLength(2);
      expect(result.backends[0].implemented).toBe(true);
      expect(result.backends[1].implemented).toBe(false);
    });

    it("errors when run outside a workspace", () => {
      try {
        runCli(["--json", "backend", "list"], tmpDir);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toMatch(/not inside/i);
      }
    });
  });

  describe("backend check --json", () => {
    it("errors when run outside a workspace", () => {
      try {
        runCli(["--json", "backend", "check", "github"], tmpDir);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toMatch(/not inside/i);
      }
    });

    it("errors for unconfigured backend", () => {
      const target = path.join(tmpDir, "ws-no-gh");
      runCli(["--json", "init", target]);

      try {
        runCli(["--json", "backend", "check", "github"], target);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toMatch(/not configured/i);
      }
    });

    it("errors when no backends configured and no name given", () => {
      const target = path.join(tmpDir, "ws-no-backends");
      runCli(["--json", "init", target]);

      try {
        runCli(["--json", "backend", "check"], target);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toMatch(/no backends configured/i);
      }
    });
  });

  describe("help", () => {
    it("backend command appears in main help", () => {
      const output = runCli(["--help"]);
      expect(output).toContain("backend");
    });

    it("backend list appears in backend help", () => {
      const output = runCli(["backend", "--help"]);
      expect(output).toContain("list");
      expect(output).toContain("check");
    });
  });
});
