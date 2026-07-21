import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliFail } from "./harness.js";

const FIXTURES = path.join(import.meta.dir, "fixtures");

function snapshotVault(root: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(root)) return out;
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile()) {
        out.set(
          child,
          crypto.createHash("sha256").update(fs.readFileSync(path.join(root, child))).digest("hex"),
        );
      }
    }
  }
  return out;
}

describe("adopt CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-adopt-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("dry-run (default)", () => {
    it("prints a complete plan as JSON when piped and writes nothing", () => {
      const target = path.join(tmpDir, "dry");
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "note.md"), "user note\n", "utf-8");
      const before = snapshotVault(target);

      const output = runCli(["--json", "--verbose", "adopt", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.mode).toBe("plan");
      expect(result.summary.create).toBeGreaterThan(0);
      const actionPaths = result.actions.map((a: { path: string }) => a.path);
      expect(actionPaths).toContain("AGENTS.md");
      expect(actionPaths).toContain("CLAUDE.md");
      expect(actionPaths).toContain("wiki/tasks.base");
      expect(actionPaths).toContain("wiki/projects.base");

      // Nothing on disk changed — no files, no manifest, no directories.
      expect(snapshotVault(target)).toEqual(before);
      expect(fs.existsSync(path.join(target, ".rubber-ducky"))).toBe(false);
      expect(fs.existsSync(path.join(target, "wiki"))).toBe(false);
    });

    it("summarizes actions as {count, sample} by default and full array with --verbose", () => {
      const target = path.join(tmpDir, "envelope");
      const dflt = JSON.parse(runCli(["--json", "adopt", target]));
      expect(dflt.actions.count).toBeGreaterThan(0);
      expect(Array.isArray(dflt.actions.sample)).toBe(true);

      const verbose = JSON.parse(runCli(["--json", "--verbose", "adopt", target]));
      expect(Array.isArray(verbose.actions)).toBe(true);
      expect(verbose.actions.length).toBe(dflt.actions.count);
    });

    it("exits 0 even when the plan contains conflicts", () => {
      const target = path.join(tmpDir, "v2-dry");
      fs.cpSync(path.join(FIXTURES, "v2-vault"), target, { recursive: true });

      const result = runCliFail(["--json", "adopt", target]);
      expect(result.status).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.summary.conflict).toBe(1);
      expect(json.conflicts[0].path).toBe(".claude/skills/grill-me/SKILL.md");
    });
  });

  describe("--apply on an empty directory", () => {
    it("creates a working vault and an immediate re-run is a no-op", () => {
      const target = path.join(tmpDir, "fresh");

      const applied = JSON.parse(runCli(["--json", "adopt", target, "--apply"]));
      expect(applied.success).toBe(true);
      expect(applied.mode).toBe("apply");
      expect(applied.summary.create).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(target, "workspace.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, "wiki/tasks.base"))).toBe(true);

      const before = snapshotVault(target);
      const rerun = JSON.parse(runCli(["--json", "adopt", target, "--apply"]));
      expect(rerun.summary.create).toBe(0);
      expect(rerun.summary.refresh).toBe(0);
      expect(rerun.summary.remove).toBe(0);
      expect(rerun.summary.conflict).toBe(0);
      expect(snapshotVault(target)).toEqual(before);
    });

    it("the adopted vault is a functioning workspace (doctor passes structure checks)", () => {
      const target = path.join(tmpDir, "working");
      runCli(["--json", "adopt", target, "--apply"]);

      const status = JSON.parse(runCli(["--json", "status"], target));
      expect(status.success).toBe(true);

      const doctor = runCliFail(["--json", "doctor"], target);
      expect(doctor.status).toBe(0);
    });
  });

  describe("--apply on a populated Obsidian vault", () => {
    it("leaves every pre-existing note byte-identical", () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(path.join(target, "notes"), { recursive: true });
      fs.mkdirSync(path.join(target, ".obsidian"), { recursive: true });
      fs.writeFileSync(path.join(target, ".obsidian/app.json"), "{}\n", "utf-8");
      fs.writeFileSync(
        path.join(target, "notes/idea.md"),
        "# My idea 😀\n\nprecious user bytes\n",
        "utf-8",
      );
      const before = snapshotVault(target);

      const applied = JSON.parse(runCli(["--json", "adopt", target, "--apply"]));
      expect(applied.success).toBe(true);

      const after = snapshotVault(target);
      for (const [rel, hash] of before) {
        expect(after.get(rel)).toBe(hash);
      }
    });
  });

  describe("--apply on a v2 vault", () => {
    let target: string;

    beforeEach(() => {
      target = path.join(tmpDir, "v2");
      fs.cpSync(path.join(FIXTURES, "v2-vault"), target, { recursive: true });
    });

    it("removes v2-shipped managed files including copied skills", () => {
      const result = runCliFail(["--json", "--verbose", "adopt", target, "--apply"]);
      const json = JSON.parse(result.stdout);

      expect(json.removed).toContain(".claude/skills/good-morning/SKILL.md");
      expect(json.removed).toContain(".claude/skills/wrap-up/SKILL.md");
      expect(json.removed).toContain(".claude/agents/linter.md");
      expect(json.removed).toContain(".obsidian/community-plugins.json");
      expect(fs.existsSync(path.join(target, ".claude/skills/good-morning"))).toBe(false);

      // v2 CLAUDE.md was claimed and replaced by the shim; AGENTS.md now
      // carries the canonical instructions.
      expect(fs.readFileSync(path.join(target, "CLAUDE.md"), "utf-8")).toContain("@AGENTS.md");
      expect(fs.existsSync(path.join(target, "AGENTS.md"))).toBe(true);
    });

    it("reports the hand-modified skill as a conflict with exit code 7, leaving it untouched", () => {
      const modified = path.join(target, ".claude/skills/grill-me/SKILL.md");
      const beforeBytes = fs.readFileSync(modified);

      const result = runCliFail(["--json", "adopt", target, "--apply"]);
      expect(result.status).toBe(7);
      const json = JSON.parse(result.stdout);
      expect(json.conflicts.map((c: { path: string }) => c.path)).toContain(
        ".claude/skills/grill-me/SKILL.md",
      );
      expect(fs.readFileSync(modified)).toEqual(beforeBytes);
    });

    it("--force resolves the conflict and the following run is a clean no-op", () => {
      const result = runCliFail(["--json", "adopt", target, "--apply", "--force"]);
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(target, ".claude/skills/grill-me"))).toBe(false);

      const before = snapshotVault(target);
      const rerun = JSON.parse(runCli(["--json", "adopt", target, "--apply"]));
      expect(rerun.summary.create).toBe(0);
      expect(rerun.summary.refresh).toBe(0);
      expect(rerun.summary.remove).toBe(0);
      expect(rerun.summary.conflict).toBe(0);
      expect(snapshotVault(target)).toEqual(before);
    });

    it("never touches user notes or user-authored skills", () => {
      const before = snapshotVault(target);
      runCliFail(["--json", "adopt", target, "--apply", "--force"]);
      const after = snapshotVault(target);

      for (const rel of [
        "wiki/daily/2026-01-05.md",
        "wiki/tasks/fix-login-bug.md",
        "wiki/notes/scratch.md",
        ".claude/skills/my-own-skill/SKILL.md",
        "workspace.md",
        "settings.json",
      ]) {
        expect(after.get(rel)).toBe(before.get(rel));
      }
    });
  });

  describe("conflict on a locally edited managed file", () => {
    it("exits 7 without --force and overwrites with --force", () => {
      const target = path.join(tmpDir, "edited");
      runCli(["--json", "adopt", target, "--apply"]);

      const agentsPath = path.join(target, "AGENTS.md");
      const edited = fs.readFileSync(agentsPath, "utf-8") + "\n## Local edits\n";
      fs.writeFileSync(agentsPath, edited, "utf-8");

      const conflicted = runCliFail(["--json", "adopt", target, "--apply"]);
      expect(conflicted.status).toBe(7);
      expect(fs.readFileSync(agentsPath, "utf-8")).toBe(edited);

      const forced = runCliFail(["--json", "adopt", target, "--apply", "--force"]);
      expect(forced.status).toBe(0);
      expect(fs.readFileSync(agentsPath, "utf-8")).not.toContain("## Local edits");
    });
  });

  describe("init delegates to adopt", () => {
    it("init on an empty target produces the same file set as adopt --apply", () => {
      const initTarget = path.join(tmpDir, "via-init");
      const adoptTarget = path.join(tmpDir, "via-adopt");

      runCli(["--json", "init", initTarget]);
      runCli(["--json", "adopt", adoptTarget, "--apply"]);

      const initFiles = [...snapshotVault(initTarget).keys()].sort();
      const adoptFiles = [...snapshotVault(adoptTarget).keys()].sort();
      expect(initFiles).toEqual(adoptFiles);
    });

    it("init reports AGENTS.md, the CLAUDE.md shim, and Bases views among created files", () => {
      const target = path.join(tmpDir, "init-files");
      const result = JSON.parse(runCli(["--json", "--verbose", "init", target]));

      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("AGENTS.md");
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain("wiki/tasks.base");
      expect(result.filesCreated).toContain("wiki/projects.base");
    });

    it("init on a non-empty directory refuses with exit 7 and points at adopt", () => {
      const target = path.join(tmpDir, "occupied");
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, "existing.md"), "hello\n", "utf-8");

      const result = runCliFail(["--json", "init", target]);
      expect(result.status).toBe(7);
      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error).toContain("adopt");
    });
  });
});
