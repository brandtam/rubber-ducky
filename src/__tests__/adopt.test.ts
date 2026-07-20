import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyAdopt,
  planAdopt,
  sha256,
  MANIFEST_RELPATH,
  type AdoptPlan,
} from "../lib/adopt.js";

const FIXTURES = path.join(import.meta.dir, "fixtures");

/** Recursively snapshot every file in a directory as rel-path → sha256. */
function snapshotVault(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
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

function copyFixture(name: string, dest: string): void {
  fs.cpSync(path.join(FIXTURES, name), dest, { recursive: true });
}

function readManifest(root: string): { files: Record<string, { hash: string; mode: string }> } {
  return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_RELPATH), "utf-8"));
}

function actionsByKind(plan: AdoptPlan, kind: string): string[] {
  return plan.actions.filter((a) => a.action === kind).map((a) => a.path);
}

/** Build a small, non-rubber-ducky Obsidian vault with user content. */
function buildObsidianVault(root: string): void {
  fs.mkdirSync(path.join(root, ".obsidian"), { recursive: true });
  fs.mkdirSync(path.join(root, "notes", "nested"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".obsidian", "app.json"),
    `{\n  "livePreview": true\n}\n`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, ".obsidian", "community-plugins.json"),
    `[\n  "dataview",\n  "calendar"\n]\n`, // user-customized — NOT the v2 bytes
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "notes", "café-ideas.md"),
    "# Café ideas ☕\n\nnaïve, résumé, 日本語 — user bytes must survive.\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "notes", "nested", "deep.md"),
    "deep note\r\nwith CRLF line endings\r\n",
    "utf-8",
  );
  // A binary file to prove adopt never touches non-markdown either.
  fs.writeFileSync(path.join(root, "notes", "blob.bin"), Buffer.from([0, 1, 2, 255, 254]));
}

describe("adopt engine", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-adopt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("empty directory", () => {
    it("plans only creates — no refresh, remove, or conflict", () => {
      const target = path.join(tmpDir, "fresh");
      const plan = planAdopt(target);

      expect(plan.actions.every((a) => a.action === "create")).toBe(true);
      expect(actionsByKind(plan, "conflict")).toHaveLength(0);
    });

    it("apply yields a working vault: workspace.md, AGENTS.md, shim, settings, references, Bases views", () => {
      const target = path.join(tmpDir, "fresh");
      applyAdopt(planAdopt(target));

      for (const rel of [
        "workspace.md",
        "AGENTS.md",
        "CLAUDE.md",
        "settings.json",
        ".gitignore",
        ".claude/settings.json",
        "references/frontmatter-templates.md",
        "references/when-to-use-cli.md",
        "wiki/tasks.base",
        "wiki/projects.base",
        "wiki/voice.md",
        "wiki/daily/.gitkeep",
      ]) {
        expect(fs.existsSync(path.join(target, rel))).toBe(true);
      }

      const shim = fs.readFileSync(path.join(target, "CLAUDE.md"), "utf-8");
      expect(shim).toContain("@AGENTS.md");
      expect(shim.trimEnd().split("\n")).toHaveLength(2);

      // Vault name derives from the directory basename.
      const ws = fs.readFileSync(path.join(target, "workspace.md"), "utf-8");
      expect(ws).toContain("name: fresh");
    });

    it("Bases views are valid YAML with table views over tasks and projects", async () => {
      const target = path.join(tmpDir, "bases");
      applyAdopt(planAdopt(target));

      const { parse } = await import("yaml");
      const tasks = parse(fs.readFileSync(path.join(target, "wiki/tasks.base"), "utf-8"));
      expect(tasks.filters.and).toContain('file.inFolder("wiki/tasks")');
      expect(tasks.views.length).toBeGreaterThan(0);
      expect(tasks.views[0].type).toBe("table");

      const projects = parse(fs.readFileSync(path.join(target, "wiki/projects.base"), "utf-8"));
      expect(projects.filters.and).toContain('file.inFolder("wiki/projects")');
      expect(projects.views[0].type).toBe("table");
    });

    it("records every written file in the manifest, content-hashed", () => {
      const target = path.join(tmpDir, "manifested");
      const result = applyAdopt(planAdopt(target));

      const manifest = readManifest(target);
      for (const rel of result.created) {
        expect(manifest.files[rel]).toBeDefined();
        expect(manifest.files[rel].hash).toBe(
          sha256(fs.readFileSync(path.join(target, rel), "utf-8")),
        );
      }
    });

    it("is idempotent: an immediate second apply changes no bytes", () => {
      const target = path.join(tmpDir, "idempotent");
      applyAdopt(planAdopt(target));
      const before = snapshotVault(target);

      const plan2 = planAdopt(target);
      const result2 = applyAdopt(plan2);

      expect(plan2.actions.every((a) => a.action === "keep")).toBe(true);
      expect(result2.created).toHaveLength(0);
      expect(result2.refreshed).toHaveLength(0);
      expect(result2.removed).toHaveLength(0);
      expect(snapshotVault(target)).toEqual(before);
    });
  });

  describe("populated Obsidian vault", () => {
    it("leaves every pre-existing file byte-identical", () => {
      const target = path.join(tmpDir, "vault");
      buildObsidianVault(target);
      const before = snapshotVault(target);

      applyAdopt(planAdopt(target));

      const after = snapshotVault(target);
      for (const [rel, hash] of before) {
        expect(after.get(rel)).toBe(hash);
      }
    });

    it("plans no removals or conflicts for user-owned Obsidian config", () => {
      const target = path.join(tmpDir, "vault2");
      buildObsidianVault(target);
      const plan = planAdopt(target);

      // The user's customized community-plugins.json does not match v2's
      // shipped bytes, so the Dataview sweep must leave it alone.
      expect(actionsByKind(plan, "remove")).toHaveLength(0);
      expect(actionsByKind(plan, "conflict")).toHaveLength(0);
    });

    it("every file adopt writes is tracked in the manifest — nothing else changes", () => {
      const target = path.join(tmpDir, "vault3");
      buildObsidianVault(target);
      const before = snapshotVault(target);

      applyAdopt(planAdopt(target));

      const manifest = readManifest(target);
      const after = snapshotVault(target);
      for (const [rel, hash] of after) {
        if (before.get(rel) === hash) continue; // untouched
        if (rel === MANIFEST_RELPATH) continue; // the manifest itself
        expect(manifest.files[rel]).toBeDefined();
      }
    });
  });

  describe("v2 vault", () => {
    let target: string;

    beforeEach(() => {
      target = path.join(tmpDir, "v2");
      copyFixture("v2-vault", target);
    });

    it("plans removal of v2-shipped skills, agents, examples, and Dataview config", () => {
      const plan = planAdopt(target);
      const removals = actionsByKind(plan, "remove");

      expect(removals).toContain(".claude/skills/good-morning/SKILL.md");
      expect(removals).toContain(".claude/skills/wrap-up/SKILL.md");
      expect(removals).toContain(".claude/skills/onboard/SKILL.md");
      expect(removals).toContain(".claude/agents/linter.md");
      expect(removals).toContain("examples/personal-finances.md");
      expect(removals).toContain(".obsidian/community-plugins.json");
      expect(removals).toContain(".obsidian/plugins/dataview/data.json");
    });

    it("claims the v2 CLAUDE.md (byte-matched) and refreshes it to the shim", () => {
      const plan = planAdopt(target);
      const claudeAction = plan.actions.find((a) => a.path === "CLAUDE.md");
      expect(claudeAction?.action).toBe("refresh");
      expect(claudeAction?.reason).toContain("v2");

      applyAdopt(plan, { force: true });
      const shim = fs.readFileSync(path.join(target, "CLAUDE.md"), "utf-8");
      expect(shim).toContain("@AGENTS.md");
      expect(fs.existsSync(path.join(target, "AGENTS.md"))).toBe(true);
    });

    it("flags a hand-modified v2 skill copy as a conflict, not a removal", () => {
      const plan = planAdopt(target);
      const conflict = plan.actions.find(
        (a) => a.path === ".claude/skills/grill-me/SKILL.md",
      );
      expect(conflict?.action).toBe("conflict");

      // Without force, the file survives apply untouched.
      const before = fs.readFileSync(path.join(target, ".claude/skills/grill-me/SKILL.md"));
      const result = applyAdopt(plan);
      expect(result.conflicts.map((c) => c.path)).toContain(
        ".claude/skills/grill-me/SKILL.md",
      );
      expect(fs.readFileSync(path.join(target, ".claude/skills/grill-me/SKILL.md"))).toEqual(
        before,
      );

      // With force, it is removed so it cannot shadow the plugin skill.
      applyAdopt(planAdopt(target), { force: true });
      expect(fs.existsSync(path.join(target, ".claude/skills/grill-me"))).toBe(false);
    });

    it("preserves user-authored skills and user notes byte-for-byte", () => {
      const before = snapshotVault(target);
      applyAdopt(planAdopt(target), { force: true });
      const after = snapshotVault(target);

      for (const rel of [
        ".claude/skills/my-own-skill/SKILL.md",
        "wiki/daily/2026-01-05.md",
        "wiki/tasks/fix-login-bug.md",
        "wiki/notes/scratch.md",
        "workspace.md",
        "settings.json",
      ]) {
        expect(after.get(rel)).toBe(before.get(rel));
      }
    });

    it("prunes directories emptied by removals", () => {
      applyAdopt(planAdopt(target), { force: true });

      expect(fs.existsSync(path.join(target, ".claude/skills/good-morning"))).toBe(false);
      expect(fs.existsSync(path.join(target, ".claude/agents"))).toBe(false);
      expect(fs.existsSync(path.join(target, "examples"))).toBe(false);
      // But dirs still holding user content survive.
      expect(fs.existsSync(path.join(target, ".claude/skills/my-own-skill"))).toBe(true);
    });

    it("is idempotent after the forced migration", () => {
      applyAdopt(planAdopt(target), { force: true });
      const before = snapshotVault(target);

      const plan2 = planAdopt(target);
      expect(plan2.actions.every((a) => a.action === "keep")).toBe(true);
      applyAdopt(plan2);
      expect(snapshotVault(target)).toEqual(before);
    });
  });

  describe("managed-file conflict handling", () => {
    let target: string;

    beforeEach(() => {
      target = path.join(tmpDir, "conflicts");
      applyAdopt(planAdopt(target));
    });

    it("a locally edited managed file becomes a conflict, never a silent overwrite", () => {
      const agentsPath = path.join(target, "AGENTS.md");
      const edited = fs.readFileSync(agentsPath, "utf-8") + "\n## My own section\n";
      fs.writeFileSync(agentsPath, edited, "utf-8");

      const plan = planAdopt(target);
      const action = plan.actions.find((a) => a.path === "AGENTS.md");
      expect(action?.action).toBe("conflict");

      const result = applyAdopt(plan);
      expect(result.conflicts.map((c) => c.path)).toContain("AGENTS.md");
      expect(fs.readFileSync(agentsPath, "utf-8")).toBe(edited);
    });

    it("--force overwrites a conflicted managed file with the current template", () => {
      const agentsPath = path.join(target, "AGENTS.md");
      fs.writeFileSync(agentsPath, "totally rewritten\n", "utf-8");

      applyAdopt(planAdopt(target), { force: true });
      expect(fs.readFileSync(agentsPath, "utf-8")).toContain("You are the primary interface");
    });

    it("an interactive resolver decides per conflict", () => {
      const agentsPath = path.join(target, "AGENTS.md");
      fs.writeFileSync(agentsPath, "rewritten\n", "utf-8");
      const shimPath = path.join(target, "CLAUDE.md");
      fs.writeFileSync(shimPath, "also rewritten\n", "utf-8");

      applyAdopt(planAdopt(target), {
        resolve: (a) => a.path === "AGENTS.md", // yes to AGENTS.md, no to CLAUDE.md
      });

      expect(fs.readFileSync(agentsPath, "utf-8")).toContain("You are the primary interface");
      expect(fs.readFileSync(shimPath, "utf-8")).toBe("also rewritten\n");
    });

    it("a manifest-matching outdated file refreshes without conflict", () => {
      // Simulate a vault written by an older CLI: AGENTS.md has old content
      // and the manifest hash matches that old content exactly.
      const agentsPath = path.join(target, "AGENTS.md");
      const oldContent = "# old template version\n";
      fs.writeFileSync(agentsPath, oldContent, "utf-8");
      const manifestPath = path.join(target, MANIFEST_RELPATH);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest.files["AGENTS.md"].hash = sha256(oldContent);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

      const plan = planAdopt(target);
      const action = plan.actions.find((a) => a.path === "AGENTS.md");
      expect(action?.action).toBe("refresh");

      applyAdopt(plan);
      expect(fs.readFileSync(agentsPath, "utf-8")).toContain("You are the primary interface");
    });
  });

  describe("seed files", () => {
    it("user edits to seed files are preserved forever", () => {
      const target = path.join(tmpDir, "seeds");
      applyAdopt(planAdopt(target));

      const wsPath = path.join(target, "workspace.md");
      const customized = "---\nname: my-renamed-vault\nversion: 0.1.0\n---\n\n# Mine now\n";
      fs.writeFileSync(wsPath, customized, "utf-8");
      const voicePath = path.join(target, "wiki/voice.md");
      fs.appendFileSync(voicePath, "\n### Sample — 2026-07-20\n\nuser sample\n", "utf-8");
      const voiceBytes = fs.readFileSync(voicePath, "utf-8");

      const plan = planAdopt(target);
      expect(plan.actions.find((a) => a.path === "workspace.md")?.action).toBe("keep");
      expect(plan.actions.find((a) => a.path === "wiki/voice.md")?.action).toBe("keep");

      applyAdopt(plan);
      expect(fs.readFileSync(wsPath, "utf-8")).toBe(customized);
      expect(fs.readFileSync(voicePath, "utf-8")).toBe(voiceBytes);
    });
  });
});
