import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parseFrontmatter,
  setFrontmatterField,
  validateFrontmatter,
  type ValidationError,
} from "../lib/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter from a markdown string", () => {
    const content = `---
title: My Page
type: daily
created: "2026-01-15"
---

# My Page

Some body content.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.data.title).toBe("My Page");
    expect(result!.data.type).toBe("daily");
    expect(result!.data.created).toBe("2026-01-15");
  });

  it("returns the body content separately", () => {
    const content = `---
title: Test
---

# Body here

Paragraph text.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.body).toContain("# Body here");
    expect(result!.body).toContain("Paragraph text.");
  });

  it("returns null for content without frontmatter", () => {
    const content = `# No frontmatter here

Just a regular markdown file.
`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseFrontmatter("");
    expect(result).toBeNull();
  });

  it("handles frontmatter with no body", () => {
    const content = `---
title: Minimal
---
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.data.title).toBe("Minimal");
    expect(result!.body).toBe("");
  });

  it("handles empty frontmatter", () => {
    const content = `---
---

Body only.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.data)).toHaveLength(0);
    expect(result!.body).toContain("Body only.");
  });

  describe("special characters", () => {
    it("handles values containing colons", () => {
      const content = `---
title: "Project: Alpha"
url: "https://example.com"
---
`;
      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.title).toBe("Project: Alpha");
      expect(result!.data.url).toBe("https://example.com");
    });

    it("handles values containing brackets", () => {
      const content = `---
title: "Task [urgent]"
tags:
  - "[frontend]"
  - backend
---
`;
      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.title).toBe("Task [urgent]");
      expect(result!.data.tags).toEqual(["[frontend]", "backend"]);
    });

    it("handles values containing quotes", () => {
      const content = `---
title: "She said \\"hello\\""
note: 'It''s fine'
---
`;
      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.title).toBe('She said "hello"');
      expect(result!.data.note).toBe("It's fine");
    });

    it("handles URLs as values", () => {
      const content = `---
jira_ref: "https://jira.example.com/browse/PROJ-123"
gh_ref: "https://github.com/org/repo/issues/42"
---
`;
      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.jira_ref).toBe("https://jira.example.com/browse/PROJ-123");
      expect(result!.data.gh_ref).toBe("https://github.com/org/repo/issues/42");
    });
  });

  describe("array and complex values", () => {
    it("handles array fields", () => {
      const content = `---
tags:
  - frontend
  - backend
  - urgent
tasks_touched:
  - task-one
  - task-two
---
`;
      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.tags).toEqual(["frontend", "backend", "urgent"]);
      expect(result!.data.tasks_touched).toEqual(["task-one", "task-two"]);
    });
  });
});

describe("setFrontmatterField", () => {
  it("sets a new field in existing frontmatter", () => {
    const content = `---
title: My Page
type: daily
---

# My Page
`;
    const updated = setFrontmatterField(content, "status", "in-progress");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.status).toBe("in-progress");
  });

  it("updates an existing field", () => {
    const content = `---
title: My Page
status: backlog
---

# My Page
`;
    const updated = setFrontmatterField(content, "status", "done");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.status).toBe("done");
  });

  it("preserves all other fields when setting a field", () => {
    const content = `---
title: My Page
type: task
status: backlog
priority: high
tags:
  - frontend
  - urgent
created: "2026-01-15"
---

# My Page
`;
    const updated = setFrontmatterField(content, "status", "in-progress");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.title).toBe("My Page");
    expect(result!.data.type).toBe("task");
    expect(result!.data.status).toBe("in-progress");
    expect(result!.data.priority).toBe("high");
    expect(result!.data.tags).toEqual(["frontend", "urgent"]);
    expect(result!.data.created).toBe("2026-01-15");
  });

  it("preserves the body content", () => {
    const content = `---
title: My Page
---

# My Page

Important body content here.
`;
    const updated = setFrontmatterField(content, "status", "done");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.body).toContain("# My Page");
    expect(result!.body).toContain("Important body content here.");
  });

  it("handles setting array values", () => {
    const content = `---
title: My Page
---

# My Page
`;
    const updated = setFrontmatterField(content, "tags", ["frontend", "urgent"]);
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.tags).toEqual(["frontend", "urgent"]);
  });

  it("handles setting values with special characters", () => {
    const content = `---
title: My Page
---

# My Page
`;
    const updated = setFrontmatterField(content, "ref", "https://jira.example.com/browse/PROJ-123");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.ref).toBe("https://jira.example.com/browse/PROJ-123");
  });

  it("handles setting values with colons", () => {
    const content = `---
title: My Page
---

# Body
`;
    const updated = setFrontmatterField(content, "title", "Project: Alpha & Beta");
    const result = parseFrontmatter(updated);

    expect(result).not.toBeNull();
    expect(result!.data.title).toBe("Project: Alpha & Beta");
  });

  it("throws when content has no frontmatter", () => {
    const content = `# No frontmatter

Just body.
`;
    expect(() => setFrontmatterField(content, "title", "Test")).toThrow();
  });

  describe("round-trip preservation", () => {
    it("round-trips complex frontmatter without data loss", () => {
      const content = `---
title: "Complex: Task [v2]"
type: task
status: in-progress
priority: high
ref: "PROJ-123"
source: jira
tags:
  - frontend
  - "[critical]"
  - "phase: 2"
created: "2026-01-15"
updated: "2026-03-01"
jira_ref: "https://jira.example.com/browse/PROJ-123"
gh_ref: "https://github.com/org/repo/issues/42"
---

# Complex: Task [v2]

Body content with [[wikilinks]] and other stuff.
`;
      // Set one field
      const updated = setFrontmatterField(content, "status", "done");
      const result = parseFrontmatter(updated);

      expect(result).not.toBeNull();
      expect(result!.data.title).toBe("Complex: Task [v2]");
      expect(result!.data.type).toBe("task");
      expect(result!.data.status).toBe("done");
      expect(result!.data.priority).toBe("high");
      expect(result!.data.ref).toBe("PROJ-123");
      expect(result!.data.source).toBe("jira");
      expect(result!.data.tags).toEqual(["frontend", "[critical]", "phase: 2"]);
      expect(result!.data.created).toBe("2026-01-15");
      expect(result!.data.updated).toBe("2026-03-01");
      expect(result!.data.jira_ref).toBe("https://jira.example.com/browse/PROJ-123");
      expect(result!.data.gh_ref).toBe("https://github.com/org/repo/issues/42");
      expect(result!.body).toContain("[[wikilinks]]");
    });

    it("survives multiple set operations", () => {
      let content = `---
title: My Task
type: task
status: backlog
created: "2026-01-01"
---

# My Task
`;
      content = setFrontmatterField(content, "status", "in-progress");
      content = setFrontmatterField(content, "priority", "high");
      content = setFrontmatterField(content, "tags", ["urgent"]);
      content = setFrontmatterField(content, "status", "done");

      const result = parseFrontmatter(content);
      expect(result).not.toBeNull();
      expect(result!.data.title).toBe("My Task");
      expect(result!.data.type).toBe("task");
      expect(result!.data.status).toBe("done");
      expect(result!.data.priority).toBe("high");
      expect(result!.data.tags).toEqual(["urgent"]);
      expect(result!.data.created).toBe("2026-01-01");
    });
  });
});

describe("validateFrontmatter", () => {
  describe("daily page schema", () => {
    it("passes for valid daily frontmatter", () => {
      const data = {
        title: "2026-01-15",
        type: "daily",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data, "daily");
      expect(errors).toHaveLength(0);
    });

    it("catches missing required fields", () => {
      const data = {
        type: "daily",
      };
      const errors = validateFrontmatter(data, "daily");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e: ValidationError) => e.field === "title")).toBe(true);
      expect(errors.some((e: ValidationError) => e.field === "created")).toBe(true);
    });

    it("catches invalid type value", () => {
      const data = {
        title: "2026-01-15",
        type: "wrong",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data, "daily");
      expect(errors.some((e: ValidationError) => e.field === "type")).toBe(true);
    });
  });

  describe("task page schema", () => {
    it("passes for valid task frontmatter", () => {
      const data = {
        title: "Fix the bug",
        type: "task",
        status: "in-progress",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data, "task");
      expect(errors).toHaveLength(0);
    });

    it("catches missing required fields", () => {
      const data = {
        title: "Fix the bug",
      };
      const errors = validateFrontmatter(data, "task");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e: ValidationError) => e.field === "type")).toBe(true);
      expect(errors.some((e: ValidationError) => e.field === "status")).toBe(true);
      expect(errors.some((e: ValidationError) => e.field === "created")).toBe(true);
    });

    it("catches invalid status value", () => {
      const data = {
        title: "Fix the bug",
        type: "task",
        status: "invalid-status",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data, "task");
      expect(errors.some((e: ValidationError) => e.field === "status")).toBe(true);
    });

    it("accepts all valid status values", () => {
      const validStatuses = [
        "backlog", "to-do", "in-progress", "in-review",
        "pending", "blocked", "done", "deferred",
      ];
      for (const status of validStatuses) {
        const data = {
          title: "Test",
          type: "task",
          status,
          created: "2026-01-15",
        };
        const errors = validateFrontmatter(data, "task");
        expect(errors.filter((e: ValidationError) => e.field === "status")).toHaveLength(0);
      }
    });
  });

  describe("project page schema", () => {
    it("passes for valid project frontmatter", () => {
      const data = {
        title: "Project Alpha",
        type: "project",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data, "project");
      expect(errors).toHaveLength(0);
    });

    it("catches missing required fields", () => {
      const data = {
        type: "project",
      };
      const errors = validateFrontmatter(data, "project");
      expect(errors.some((e: ValidationError) => e.field === "title")).toBe(true);
      expect(errors.some((e: ValidationError) => e.field === "created")).toBe(true);
    });
  });

  describe("auto-detection from type field", () => {
    it("auto-detects page type from the type field when no pageType specified", () => {
      const data = {
        title: "Test Task",
        type: "task",
        status: "backlog",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data);
      expect(errors).toHaveLength(0);
    });

    it("reports missing type field when no pageType specified and type is absent", () => {
      const data = {
        title: "No Type",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data);
      expect(errors.some((e: ValidationError) => e.field === "type")).toBe(true);
    });

    it("reports unknown type value when type is not recognized", () => {
      const data = {
        title: "Unknown",
        type: "unknown-type",
        created: "2026-01-15",
      };
      const errors = validateFrontmatter(data);
      expect(errors.some((e: ValidationError) => e.field === "type")).toBe(true);
    });
  });
});

describe("file-based operations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-fm-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("can parse frontmatter from a real file", () => {
    const filePath = path.join(tmpDir, "test.md");
    fs.writeFileSync(filePath, `---
title: File Test
type: task
status: backlog
created: "2026-01-15"
---

# File Test
`, "utf-8");

    const content = fs.readFileSync(filePath, "utf-8");
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.data.title).toBe("File Test");
  });

  it("can set a field and write back to file", () => {
    const filePath = path.join(tmpDir, "test.md");
    const original = `---
title: File Test
type: task
status: backlog
created: "2026-01-15"
---

# File Test

Body content.
`;
    fs.writeFileSync(filePath, original, "utf-8");

    const content = fs.readFileSync(filePath, "utf-8");
    const updated = setFrontmatterField(content, "status", "done");
    fs.writeFileSync(filePath, updated, "utf-8");

    const reread = fs.readFileSync(filePath, "utf-8");
    const result = parseFrontmatter(reread);
    expect(result).not.toBeNull();
    expect(result!.data.status).toBe("done");
    expect(result!.data.title).toBe("File Test");
    expect(result!.body).toContain("Body content.");
  });
});
