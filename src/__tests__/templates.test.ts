import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
} from "../lib/templates.js";

describe("generateWorkspaceMd", () => {
  it("produces valid YAML frontmatter", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();

    const frontmatter = parseYaml(match![1]);
    expect(frontmatter).toBeDefined();
    expect(frontmatter.name).toBe("Test");
    expect(frontmatter.purpose).toBe("Testing");
  });

  it("includes required frontmatter fields", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter.name).toBe("Test");
    expect(frontmatter.purpose).toBe("Testing");
    expect(frontmatter.version).toBe("0.1.0");
    expect(frontmatter.created).toBeDefined();
  });

  it("handles special characters in name and purpose", () => {
    const content = generateWorkspaceMd({
      name: "Project: Alpha & Beta",
      purpose: 'Track "everything" with colons: yes',
    });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter.name).toBe("Project: Alpha & Beta");
    expect(frontmatter.purpose).toBe('Track "everything" with colons: yes');
  });

  it("includes a markdown body section", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const parts = content.split("---");
    const body = parts.slice(2).join("---").trim();

    expect(body).toContain("# Test");
  });
});

describe("generateClaudeMd", () => {
  it("includes workspace identity", () => {
    const content = generateClaudeMd({ name: "Dev Log", purpose: "Daily tracking" });

    expect(content).toContain("Dev Log");
    expect(content).toContain("Daily tracking");
  });

  it("references UBIQUITOUS_LANGUAGE.md", () => {
    const content = generateClaudeMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("@UBIQUITOUS_LANGUAGE.md");
  });

  it("includes key file pointers", () => {
    const content = generateClaudeMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("workspace.md");
    expect(content).toContain("wiki/");
  });

  it("is under 60 lines", () => {
    const content = generateClaudeMd({ name: "Test", purpose: "Testing" });
    const lines = content.split("\n").length;

    expect(lines).toBeLessThanOrEqual(60);
  });
});

describe("generateUbiquitousLanguageMd", () => {
  it("has a title", () => {
    const content = generateUbiquitousLanguageMd();

    expect(content).toContain("# Ubiquitous Language");
  });

  it("includes placeholder sections for terms", () => {
    const content = generateUbiquitousLanguageMd();

    // Should have some structure for adding terms
    expect(content).toContain("##");
  });
});
