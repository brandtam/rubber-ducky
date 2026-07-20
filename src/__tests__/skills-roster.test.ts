import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../lib/frontmatter.js";

/**
 * Structural checks for the plugin-resident skill and agent roster (issue #8).
 * Skills and agents are markdown consumed by Claude Code, so behavior can't be
 * unit-tested — but the roster shape, frontmatter contract, token discipline,
 * and no-legacy-verb guarantee are all file-state assertions.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");

const SKILL_ROSTER = [
  "good-morning",
  "wrap-up",
  "capture",
  "start",
  "close",
  "meeting-note",
  "start-project",
  "onboard",
  "help",
];

const AGENT_ROSTER = ["work-historian", "linter", "ticket-writer", "research-partner"];

/**
 * CLI verbs that existed in v2 but were left behind in the v3 transplant
 * (issue #2). No skill or agent may invoke them. `ingest` is only legacy as a
 * TOP-LEVEL verb — `screenshot ingest` is a live v3 subcommand — so matching
 * anchors on the first verb after `rubber-ducky` (skipping global flags).
 */
const LEGACY_VERBS = [
  "ingest",
  "writeback",
  "push",
  "comment",
  "transition",
  "link",
  "pp",
  "triage-candidates",
  "update",
  "migrate",
  "workspace",
  "confirm",
  "pull",
  "backend",
  "reconcile",
];

const LEGACY_INVOCATION = new RegExp(
  String.raw`rubber-ducky(?:\s+--?[\w-]+(?:=\S+)?)*\s+(?:${LEGACY_VERBS.join("|")})\b`
);

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...markdownFilesUnder(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

describe("skill roster", () => {
  it("contains exactly the nine consolidated skills", () => {
    const dirs = fs
      .readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual([...SKILL_ROSTER].sort());
  });

  for (const skill of SKILL_ROSTER) {
    describe(skill, () => {
      const skillPath = path.join(SKILLS_DIR, skill, "SKILL.md");

      it("has a SKILL.md with parseable frontmatter", () => {
        expect(fs.existsSync(skillPath)).toBe(true);
        const parsed = parseFrontmatter(fs.readFileSync(skillPath, "utf-8"));
        expect(parsed).not.toBeNull();
      });

      it("declares a name matching its directory", () => {
        const parsed = parseFrontmatter(fs.readFileSync(skillPath, "utf-8"))!;
        expect(parsed.data.name).toBe(skill);
      });

      it("has a non-empty single-line description", () => {
        const parsed = parseFrontmatter(fs.readFileSync(skillPath, "utf-8"))!;
        const description = parsed.data.description;
        expect(typeof description).toBe("string");
        expect((description as string).trim().length).toBeGreaterThan(0);
        expect(description as string).not.toContain("\n");
      });
    });
  }
});

describe("agent roster", () => {
  it("contains exactly the four re-platformed agents", () => {
    const files = fs
      .readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(files).toEqual([...AGENT_ROSTER].sort());
  });

  for (const agent of AGENT_ROSTER) {
    describe(agent, () => {
      const agentPath = path.join(AGENTS_DIR, `${agent}.md`);

      it("has parseable frontmatter with matching name and a single-line description", () => {
        const parsed = parseFrontmatter(fs.readFileSync(agentPath, "utf-8"));
        expect(parsed).not.toBeNull();
        expect(parsed!.data.name).toBe(agent);
        const description = parsed!.data.description;
        expect(typeof description).toBe("string");
        expect((description as string).trim().length).toBeGreaterThan(0);
        expect(description as string).not.toContain("\n");
      });

      it("declares an explicit tool allowlist", () => {
        const parsed = parseFrontmatter(fs.readFileSync(agentPath, "utf-8"))!;
        expect(typeof parsed.data.tools).toBe("string");
        expect((parsed.data.tools as string).length).toBeGreaterThan(0);
      });
    });
  }
});

describe("obsidian & memory pairings (issue #10)", () => {
  const onboard = fs.readFileSync(path.join(SKILLS_DIR, "onboard", "SKILL.md"), "utf-8");
  const help = fs.readFileSync(path.join(SKILLS_DIR, "help", "SKILL.md"), "utf-8");

  it("onboard offers the official Obsidian skills install", () => {
    expect(onboard).toContain("kepano/obsidian-skills");
    expect(onboard).toContain("obsidian@obsidian-skills");
  });

  it("onboard offers the auto-memory redirect into the vault, local-scope only", () => {
    expect(onboard).toContain("autoMemoryDirectory");
    expect(onboard).toContain("settings.local.json");
    // The vault's .claude/settings.json is adopt-managed; the skill must
    // steer the machine-specific absolute path away from it.
    expect(onboard).toContain("adopt-managed");
  });

  it("help documents the show-me-that-note flow and both pairings", () => {
    expect(help.toLowerCase()).toContain("show me that note");
    expect(help).toContain("kepano/obsidian-skills");
    expect(help).toContain("autoMemoryDirectory");
  });
});

describe("no legacy CLI verbs", () => {
  const files = [...markdownFilesUnder(SKILLS_DIR), ...markdownFilesUnder(AGENTS_DIR)];

  it("scans a non-empty file set", () => {
    expect(files.length).toBeGreaterThanOrEqual(SKILL_ROSTER.length + AGENT_ROSTER.length);
  });

  for (const file of files) {
    it(`${path.relative(REPO_ROOT, file)} invokes only transplanted verbs`, () => {
      const content = fs.readFileSync(file, "utf-8");
      const match = content.match(LEGACY_INVOCATION);
      expect(match).toBeNull();
    });
  }
});
