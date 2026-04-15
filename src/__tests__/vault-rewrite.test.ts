import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { renameAndRewrite } from "../lib/vault-rewrite.js";

describe("vault-rewrite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-rewrite-"));
    // Create wiki/tasks and wiki/daily directories
    fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("renameAndRewrite", () => {
    it("renames a file from oldPath to newPath", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n## Description\n");

      renameAndRewrite(oldPath, newPath, tmpDir);

      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(oldPath)).toBe(false);
    });

    it("rewrites [[wikilinks]] in other vault files to the new filename", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n## Description\n");

      // A daily page referencing the old name
      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(
        dailyPath,
        "---\ntitle: 2026-01-01\n---\n## Work log\n- Worked on [[ecomm-123]]\n"
      );

      renameAndRewrite(oldPath, newPath, tmpDir);

      const dailyContent = fs.readFileSync(dailyPath, "utf-8");
      expect(dailyContent).toContain("[[ECOMM-123]]");
      expect(dailyContent).not.toContain("[[ecomm-123]]");
    });

    it("rewrites wikilinks across multiple files", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "web-45.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "WEB-45.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n");

      const daily1 = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      const daily2 = path.join(tmpDir, "wiki", "daily", "2026-01-02.md");
      const project = path.join(tmpDir, "wiki", "projects", "my-project.md");

      fs.writeFileSync(daily1, "See [[web-45]] for details\n");
      fs.writeFileSync(daily2, "Also [[web-45]] here\n");
      fs.writeFileSync(project, "Tasks: [[web-45]], [[other-task]]\n");

      renameAndRewrite(oldPath, newPath, tmpDir);

      expect(fs.readFileSync(daily1, "utf-8")).toContain("[[WEB-45]]");
      expect(fs.readFileSync(daily2, "utf-8")).toContain("[[WEB-45]]");
      expect(fs.readFileSync(project, "utf-8")).toContain("[[WEB-45]]");
      // Other links untouched
      expect(fs.readFileSync(project, "utf-8")).toContain("[[other-task]]");
    });

    it("handles wikilinks with display text (piped links)", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n");

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(
        dailyPath,
        "See [[ecomm-123|ECOMM ticket]] for details\n"
      );

      renameAndRewrite(oldPath, newPath, tmpDir);

      const content = fs.readFileSync(dailyPath, "utf-8");
      expect(content).toContain("[[ECOMM-123|ECOMM ticket]]");
    });

    it("handles multiple wikilinks on the same line", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n");

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(
        dailyPath,
        "Links: [[ecomm-123]] and [[ecomm-123|alias]] done\n"
      );

      renameAndRewrite(oldPath, newPath, tmpDir);

      const content = fs.readFileSync(dailyPath, "utf-8");
      expect(content).toBe("Links: [[ECOMM-123]] and [[ECOMM-123|alias]] done\n");
    });

    it("does not rewrite partial matches", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-12.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-12.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n");

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(
        dailyPath,
        "See [[ecomm-123]] and [[ecomm-12]] here\n"
      );

      renameAndRewrite(oldPath, newPath, tmpDir);

      const content = fs.readFileSync(dailyPath, "utf-8");
      expect(content).toContain("[[ecomm-123]]"); // not rewritten
      expect(content).toContain("[[ECOMM-12]]"); // rewritten
    });

    it("is a no-op when oldPath and newPath are the same", () => {
      const filePath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(filePath, "---\ntitle: Test\n---\n");

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(dailyPath, "See [[ECOMM-123]] here\n");

      renameAndRewrite(filePath, filePath, tmpDir);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(dailyPath, "utf-8")).toBe("See [[ECOMM-123]] here\n");
    });

    it("rewrites wikilinks in the renamed file itself", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");

      // Another task also being renamed
      const other = path.join(tmpDir, "wiki", "tasks", "web-45.md");
      fs.writeFileSync(other, "---\ntitle: Other\n---\n");

      fs.writeFileSync(
        oldPath,
        "---\ntitle: Test\n---\n## See also\n- [[web-45]]\n"
      );

      // Only rename ecomm-123 for now — web-45 link stays as-is
      renameAndRewrite(oldPath, newPath, tmpDir);

      const content = fs.readFileSync(newPath, "utf-8");
      // web-45 was not renamed, so it stays as-is
      expect(content).toContain("[[web-45]]");
    });

    it("handles case-insensitive wikilink matching", () => {
      const oldPath = path.join(tmpDir, "wiki", "tasks", "ecomm-123.md");
      const newPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md");
      fs.writeFileSync(oldPath, "---\ntitle: Test\n---\n");

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-01-01.md");
      fs.writeFileSync(
        dailyPath,
        "See [[Ecomm-123]] and [[ECOMM-123]] and [[ecomm-123]] here\n"
      );

      renameAndRewrite(oldPath, newPath, tmpDir);

      const content = fs.readFileSync(dailyPath, "utf-8");
      // All case variants should be rewritten to the new name
      expect(content).toBe("See [[ECOMM-123]] and [[ECOMM-123]] and [[ECOMM-123]] here\n");
    });
  });
});
