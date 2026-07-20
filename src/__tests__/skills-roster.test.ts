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
  // Integration skills on bridge docs (issue #9).
  "connect",
  "ingest",
  "backend-write",
  "new-ticket",
  "reconcile",
];

/**
 * The five bridge-doc integration skills (issue #9). All service knowledge
 * lives in the per-vault bridge doc at `.rubber-ducky/integrations/<name>.md`;
 * each skill must anchor on that location, and none may hardcode a service.
 */
const INTEGRATION_SKILLS = [
  "connect",
  "ingest",
  "backend-write",
  "new-ticket",
  "reconcile",
];

const BRIDGE_DOC_LOCATION = ".rubber-ducky/integrations/";

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
  it("contains exactly the fourteen skills (nine consolidated + five integration)", () => {
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

describe("integration skills (bridge-doc surface)", () => {
  for (const skill of INTEGRATION_SKILLS) {
    it(`${skill} anchors on the bridge-doc location`, () => {
      const content = fs.readFileSync(
        path.join(SKILLS_DIR, skill, "SKILL.md"),
        "utf-8",
      );
      expect(content).toContain(BRIDGE_DOC_LOCATION);
    });
  }

  it("connect ships the bridge-doc template reference file", () => {
    expect(
      fs.existsSync(path.join(SKILLS_DIR, "connect", "bridge-doc.md")),
    ).toBe(true);
  });

  it("connect documents the write-patterns registration file", () => {
    const content = fs.readFileSync(
      path.join(SKILLS_DIR, "connect", "SKILL.md"),
      "utf-8",
    );
    expect(content).toContain(".rubber-ducky/write-patterns");
  });
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
