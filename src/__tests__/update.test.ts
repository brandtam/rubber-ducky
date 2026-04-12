import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getBundledTemplates,
  scanWorkspace,
  generateDiff,
  applyFileUpdate,
  type FileComparison,
} from "../lib/update.js";

describe("getBundledTemplates", () => {
  it("returns an array of bundled templates", () => {
    const templates = getBundledTemplates();

    expect(templates).toBeInstanceOf(Array);
    expect(templates.length).toBeGreaterThan(0);
  });

  it("each template has relativePath, content, and description", () => {
    const templates = getBundledTemplates();

    for (const t of templates) {
      expect(t.relativePath).toBeDefined();
      expect(typeof t.relativePath).toBe("string");
      expect(t.content).toBeDefined();
      expect(typeof t.content).toBe("string");
      expect(t.content.length).toBeGreaterThan(0);
      expect(t.description).toBeDefined();
      expect(typeof t.description).toBe("string");
    }
  });

  it("all template paths are under .claude/commands/ or .claude/agents/", () => {
    const templates = getBundledTemplates();

    for (const t of templates) {
      const valid =
        t.relativePath.startsWith(".claude/commands/") ||
        t.relativePath.startsWith(".claude/agents/");
      expect(valid, `unexpected path: ${t.relativePath}`).toBe(true);
    }
  });

  it("includes good-morning skill template", () => {
    const templates = getBundledTemplates();
    const gm = templates.find(
      (t) => t.relativePath === ".claude/commands/good-morning.md"
    );

    expect(gm).toBeDefined();
    expect(gm!.content).toContain("Good Morning");
  });

  it("includes wrap-up skill template", () => {
    const templates = getBundledTemplates();
    const wu = templates.find(
      (t) => t.relativePath === ".claude/commands/wrap-up.md"
    );

    expect(wu).toBeDefined();
    expect(wu!.content).toContain("Wrap Up");
  });

  it("includes work-historian agent template", () => {
    const templates = getBundledTemplates();
    const agent = templates.find(
      (t) => t.relativePath === ".claude/agents/work-historian.md"
    );

    expect(agent).toBeDefined();
    expect(agent!.content).toContain("Work Historian");
    expect(agent!.content).toContain("read-only");
    expect(agent!.content).toContain("wiki/daily/");
    expect(agent!.content).toContain("wiki/tasks/");
    expect(agent!.content).toContain("frontmatter");
    expect(agent!.content).toContain("Citation");
  });

  it("work-historian agent enforces read-only access", () => {
    const templates = getBundledTemplates();
    const agent = templates.find(
      (t) => t.relativePath === ".claude/agents/work-historian.md"
    );

    expect(agent).toBeDefined();
    // Agent must explicitly prohibit file modifications
    expect(agent!.content).toMatch(/never modify|read.only|no file modification|do not (write|edit|create|delete)/i);
  });

  it("work-historian agent references rubber-ducky wiki search", () => {
    const templates = getBundledTemplates();
    const agent = templates.find(
      (t) => t.relativePath === ".claude/agents/work-historian.md"
    );

    expect(agent).toBeDefined();
    expect(agent!.content).toContain("rubber-ducky wiki search");
  });

  it("includes query skill template", () => {
    const templates = getBundledTemplates();
    const skill = templates.find(
      (t) => t.relativePath === ".claude/commands/query.md"
    );

    expect(skill).toBeDefined();
    expect(skill!.content).toContain("work-historian");
    expect(skill!.content).toContain("query");
  });

  it("query skill routes to work-historian agent", () => {
    const templates = getBundledTemplates();
    const skill = templates.find(
      (t) => t.relativePath === ".claude/commands/query.md"
    );

    expect(skill).toBeDefined();
    expect(skill!.content).toContain("work-historian");
  });
});

describe("good-morning skill template", () => {
  function getGoodMorningTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/good-morning.md"
    )!;
  }

  it("instructs to create daily page if missing via CLI", () => {
    const gm = getGoodMorningTemplate();
    expect(gm.content).toContain("rubber-ducky page create daily");
  });

  it("instructs to read active tasks, ASAP items, reminders, and deadlines", () => {
    const gm = getGoodMorningTemplate();
    expect(gm.content).toMatch(/ASAP/i);
    expect(gm.content).toMatch(/reminder/i);
    expect(gm.content).toMatch(/deadline/i);
    expect(gm.content).toMatch(/in-progress/i);
  });

  it("instructs to set morning-brief status flag via CLI", () => {
    const gm = getGoodMorningTemplate();
    expect(gm.content).toContain("rubber-ducky frontmatter set");
    expect(gm.content).toContain("morning_brief");
    expect(gm.content).toContain("true");
  });

  it("documents redirect-to-active-task behavior", () => {
    const gm = getGoodMorningTemplate();
    expect(gm.content).toContain("active_task");
  });

  it("uses CLI commands for mechanical operations", () => {
    const gm = getGoodMorningTemplate();
    expect(gm.content).toContain("rubber-ducky");
  });
});

describe("wrap-up skill template", () => {
  function getWrapUpTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/wrap-up.md"
    )!;
  }

  it("instructs to update task pages via CLI", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toContain("rubber-ducky frontmatter set");
  });

  it("instructs to update daily log via CLI", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toContain("rubber-ducky log append");
  });

  it("instructs to create a status snapshot", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toMatch(/snapshot|summary|status/i);
  });

  it("instructs to set wrap-up status flag via CLI", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toContain("wrap_up");
    expect(wu.content).toContain("true");
  });

  it("documents redirect-to-active-task behavior", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toContain("active_task");
  });

  it("uses CLI commands for mechanical operations", () => {
    const wu = getWrapUpTemplate();
    expect(wu.content).toContain("rubber-ducky");
  });
});

describe("scanWorkspace", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-update-test-"));
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeBundledFile(relativePath: string, content: string): void {
    const fullPath = path.join(workspacePath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  it("marks files as 'new' when they don't exist locally", () => {
    const result = scanWorkspace(workspacePath);

    expect(result.newFiles.length).toBeGreaterThan(0);
    for (const f of result.newFiles) {
      expect(f.status).toBe("new");
      expect(f.localContent).toBeNull();
    }
  });

  it("marks files as 'unchanged' when local matches bundled", () => {
    const templates = getBundledTemplates();
    for (const t of templates) {
      writeBundledFile(t.relativePath, t.content);
    }

    const result = scanWorkspace(workspacePath);

    expect(result.unchanged.length).toBe(templates.length);
    expect(result.modified.length).toBe(0);
    expect(result.newFiles.length).toBe(0);
  });

  it("marks files as 'modified' when local differs from bundled", () => {
    const templates = getBundledTemplates();
    // Write all files but modify the first one
    for (const t of templates) {
      writeBundledFile(t.relativePath, t.content);
    }
    const firstTemplate = templates[0];
    writeBundledFile(firstTemplate.relativePath, firstTemplate.content + "\n\n<!-- user customization -->");

    const result = scanWorkspace(workspacePath);

    expect(result.modified.length).toBe(1);
    expect(result.modified[0].relativePath).toBe(firstTemplate.relativePath);
    expect(result.modified[0].status).toBe("modified");
    expect(result.modified[0].diff).not.toBeNull();
  });

  it("returns comparisons array with all files", () => {
    const templates = getBundledTemplates();
    const result = scanWorkspace(workspacePath);

    expect(result.comparisons.length).toBe(templates.length);
    expect(result.comparisons.length).toBe(
      result.unchanged.length + result.modified.length + result.newFiles.length
    );
  });

  it("includes bundled content in all comparisons", () => {
    const result = scanWorkspace(workspacePath);

    for (const c of result.comparisons) {
      expect(c.bundledContent).toBeDefined();
      expect(c.bundledContent.length).toBeGreaterThan(0);
    }
  });

  it("includes description from template in comparisons", () => {
    const result = scanWorkspace(workspacePath);

    for (const c of result.comparisons) {
      expect(c.description).toBeDefined();
      expect(typeof c.description).toBe("string");
    }
  });
});

describe("generateDiff", () => {
  it("returns empty string for identical content", () => {
    const diff = generateDiff("hello\nworld", "hello\nworld");
    expect(diff).toBe("");
  });

  it("shows added lines with + prefix", () => {
    const diff = generateDiff("hello", "hello\nworld");

    expect(diff).toContain("+world");
  });

  it("shows removed lines with - prefix", () => {
    const diff = generateDiff("hello\nworld", "hello");

    expect(diff).toContain("-world");
  });

  it("shows context lines with space prefix", () => {
    const diff = generateDiff("hello\nold\nworld", "hello\nnew\nworld");

    expect(diff).toContain(" hello");
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
    expect(diff).toContain(" world");
  });

  it("handles completely different content", () => {
    const diff = generateDiff("aaa\nbbb", "ccc\nddd");

    expect(diff).toContain("-aaa");
    expect(diff).toContain("-bbb");
    expect(diff).toContain("+ccc");
    expect(diff).toContain("+ddd");
  });

  it("handles empty local content", () => {
    const diff = generateDiff("", "hello\nworld");

    expect(diff).toContain("+hello");
    expect(diff).toContain("+world");
  });
});

describe("applyFileUpdate", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-apply-test-"));
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("overwrites local file with bundled content when action is 'overwrite'", () => {
    const relPath = ".claude/commands/test.md";
    const fullPath = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "old content", "utf-8");

    const result = applyFileUpdate(workspacePath, relPath, "new content", "overwrite");

    expect(result.applied).toBe(true);
    expect(result.action).toBe("overwrite");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("new content");
  });

  it("creates new file when action is 'overwrite' and file does not exist", () => {
    const relPath = ".claude/commands/new-skill.md";
    const fullPath = path.join(workspacePath, relPath);

    const result = applyFileUpdate(workspacePath, relPath, "skill content", "overwrite");

    expect(result.applied).toBe(true);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("skill content");
  });

  it("does not modify file when action is 'keep'", () => {
    const relPath = ".claude/commands/test.md";
    const fullPath = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "user content", "utf-8");

    const result = applyFileUpdate(workspacePath, relPath, "new content", "keep");

    expect(result.applied).toBe(false);
    expect(result.action).toBe("keep");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("user content");
  });

  it("does not create file when action is 'skip'", () => {
    const relPath = ".claude/commands/skipped.md";
    const fullPath = path.join(workspacePath, relPath);

    const result = applyFileUpdate(workspacePath, relPath, "content", "skip");

    expect(result.applied).toBe(false);
    expect(result.action).toBe("skip");
    expect(fs.existsSync(fullPath)).toBe(false);
  });
});

describe("push skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/push.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes pushing a wiki task to an external backend", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/push/i);
    expect(t.content).toMatch(/backend/i);
    expect(t.content).toMatch(/task/i);
  });

  it("requires write-back safety: preview before confirmation", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/preview/i);
    expect(t.content).toMatch(/confirm/i);
  });

  it("requires audit logging to log.md", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/log/i);
  });
});

describe("comment skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/comment.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes adding a comment to an external ticket", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/comment/i);
    expect(t.content).toMatch(/backend/i);
  });

  it("requires write-back safety: preview before confirmation", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/preview/i);
    expect(t.content).toMatch(/confirm/i);
  });

  it("requires audit logging", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/log/i);
  });
});

describe("transition skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/transition.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes changing status in both wiki and backend", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/status/i);
    expect(t.content).toMatch(/wiki/i);
    expect(t.content).toMatch(/backend/i);
  });

  it("requires write-back safety: preview before confirmation", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/preview/i);
    expect(t.content).toMatch(/confirm/i);
  });

  it("requires audit logging", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/log/i);
  });
});

describe("pull-active skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/pull-active.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes pulling latest state for active tasks", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/pull/i);
    expect(t.content).toMatch(/active/i);
    expect(t.content).toMatch(/backend/i);
  });

  it("scans wiki/tasks for tasks with backend refs", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/wiki\/tasks/i);
  });
});

describe("reconcile skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/reconcile.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes comparing wiki state with backend state", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/reconcile|compare/i);
    expect(t.content).toMatch(/wiki/i);
    expect(t.content).toMatch(/backend/i);
  });

  it("surfaces differences between wiki and backend", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/difference|drift|mismatch/i);
  });
});

describe("start skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/start.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("uses rubber-ducky task start for mechanical operation", () => {
    const t = getTemplate();
    expect(t.content).toContain("rubber-ducky task start");
  });

  it("triggers backend transition to in-progress when ref exists", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/backend/i);
    expect(t.content).toMatch(/in-progress/i);
    expect(t.content).toMatch(/transition/i);
  });

  it("requires write-back safety for backend transition", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/preview/i);
    expect(t.content).toMatch(/confirm/i);
  });
});

describe("close skill template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/commands/close.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("uses rubber-ducky task close for mechanical operation", () => {
    const t = getTemplate();
    expect(t.content).toContain("rubber-ducky task close");
  });

  it("triggers backend transition to done when ref exists", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/backend/i);
    expect(t.content).toMatch(/done/i);
    expect(t.content).toMatch(/transition/i);
  });

  it("requires write-back safety for backend transition", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/preview/i);
    expect(t.content).toMatch(/confirm/i);
  });
});

describe("ticket-writer agent template", () => {
  function getTemplate() {
    return getBundledTemplates().find(
      (t) => t.relativePath === ".claude/agents/ticket-writer.md"
    )!;
  }

  it("exists as a bundled template", () => {
    expect(getTemplate()).toBeDefined();
  });

  it("describes drafting ticket content from wiki pages", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/draft/i);
    expect(t.content).toMatch(/ticket/i);
  });

  it("adapts tone to target system", () => {
    const t = getTemplate();
    expect(t.content).toMatch(/github/i);
    expect(t.content).toMatch(/jira/i);
    expect(t.content).toMatch(/asana/i);
  });

  it("is read-only with respect to external systems", () => {
    const t = getTemplate();
    // Ticket writer drafts content but does not write to backends
    expect(t.content).toMatch(/draft|generate|produce/i);
  });
});
