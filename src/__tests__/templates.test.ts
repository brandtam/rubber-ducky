import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateClaudeMd,
  generateUbiquitousLanguageMd,
  generateBackendSkills,
  type BackendConfig,
  type VocabularyOptions,
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

  it("includes empty backends array when no backends provided", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter.backends).toEqual([]);
  });

  it("includes backend configs in frontmatter when provided", () => {
    const backends: BackendConfig[] = [
      { type: "github", mcp_server: "github" },
      { type: "jira", mcp_server: "atlassian-remote", server_url: "https://myorg.atlassian.net", project_key: "PROJ" },
    ];
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing", backends });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter.backends).toHaveLength(2);
    expect(frontmatter.backends[0].type).toBe("github");
    expect(frontmatter.backends[0].mcp_server).toBe("github");
    expect(frontmatter.backends[1].type).toBe("jira");
    expect(frontmatter.backends[1].mcp_server).toBe("atlassian-remote");
    expect(frontmatter.backends[1].server_url).toBe("https://myorg.atlassian.net");
    expect(frontmatter.backends[1].project_key).toBe("PROJ");
  });

  it("includes asana backend config in frontmatter", () => {
    const backends: BackendConfig[] = [
      { type: "asana", mcp_server: "asana", workspace_id: "12345" },
    ];
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing", backends });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter.backends).toHaveLength(1);
    expect(frontmatter.backends[0].type).toBe("asana");
    expect(frontmatter.backends[0].mcp_server).toBe("asana");
    expect(frontmatter.backends[0].workspace_id).toBe("12345");
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

  it("always includes status vocabulary", () => {
    const content = generateUbiquitousLanguageMd();

    expect(content).toContain("backlog");
    expect(content).toContain("to-do");
    expect(content).toContain("in-progress");
    expect(content).toContain("in-review");
    expect(content).toContain("pending");
    expect(content).toContain("blocked");
    expect(content).toContain("done");
    expect(content).toContain("deferred");
  });

  it("includes status vocabulary even when custom vocabulary is provided", () => {
    const vocabulary: VocabularyOptions = {
      brands: ["Acme"],
      teams: ["Frontend"],
      labels: ["urgent"],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    expect(content).toContain("backlog");
    expect(content).toContain("done");
    expect(content).toContain("deferred");
  });

  it("includes brands section when brands are provided", () => {
    const vocabulary: VocabularyOptions = {
      brands: ["Acme Corp", "Widget Co"],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    expect(content).toContain("## Brands");
    expect(content).toContain("Acme Corp");
    expect(content).toContain("Widget Co");
  });

  it("includes teams section when teams are provided", () => {
    const vocabulary: VocabularyOptions = {
      teams: ["Frontend", "Backend", "DevOps"],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    expect(content).toContain("## Teams");
    expect(content).toContain("Frontend");
    expect(content).toContain("Backend");
    expect(content).toContain("DevOps");
  });

  it("includes labels section when labels are provided", () => {
    const vocabulary: VocabularyOptions = {
      labels: ["urgent", "bug", "feature"],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    expect(content).toContain("## Labels");
    expect(content).toContain("urgent");
    expect(content).toContain("bug");
    expect(content).toContain("feature");
  });

  it("omits empty vocabulary sections", () => {
    const vocabulary: VocabularyOptions = {
      brands: ["Acme"],
      teams: [],
      labels: [],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    expect(content).toContain("## Brands");
    expect(content).not.toContain("## Teams");
    expect(content).not.toContain("## Labels");
  });

  it("renders vocabulary terms as table rows", () => {
    const vocabulary: VocabularyOptions = {
      brands: ["Acme Corp"],
    };
    const content = generateUbiquitousLanguageMd(vocabulary);

    // Brands should be in a markdown table
    expect(content).toMatch(/\|\s*Acme Corp\s*\|/);
  });

  it("produces valid output with no vocabulary provided", () => {
    const content = generateUbiquitousLanguageMd();

    expect(content).toContain("# Ubiquitous Language");
    expect(content).toContain("## Statuses");
    expect(content).toContain("## Custom terms");
  });
});

describe("generateBackendSkills", () => {
  it("returns empty array when no backends provided", () => {
    expect(generateBackendSkills()).toEqual([]);
    expect(generateBackendSkills([])).toEqual([]);
  });

  it("generates ingest-asana skill when asana backend is configured", () => {
    const backends: BackendConfig[] = [
      { type: "asana", mcp_server: "asana" },
    ];
    const skills = generateBackendSkills(backends);

    expect(skills).toHaveLength(1);
    expect(skills[0].path).toBe(".claude/commands/ingest-asana.md");
    expect(skills[0].content).toContain("Ingest Asana Task");
    expect(skills[0].content).toContain("/ingest-asana");
    expect(skills[0].content).toContain("rubber-ducky backend check asana");
    expect(skills[0].content).toContain("Bulk ingest");
    expect(skills[0].content).toContain("project:<project-gid>");
    expect(skills[0].content).toContain("section:<section-gid>");
  });

  it("includes workspace ID in skill when configured", () => {
    const backends: BackendConfig[] = [
      { type: "asana", mcp_server: "asana", workspace_id: "12345" },
    ];
    const skills = generateBackendSkills(backends);

    expect(skills[0].content).toContain("12345");
  });

  it("does not generate skills for non-asana backends", () => {
    const backends: BackendConfig[] = [
      { type: "github", mcp_server: "github" },
    ];
    const skills = generateBackendSkills(backends);

    expect(skills).toHaveLength(0);
  });

  it("generates skills for asana among mixed backends", () => {
    const backends: BackendConfig[] = [
      { type: "github", mcp_server: "github" },
      { type: "asana", mcp_server: "asana" },
      { type: "jira", mcp_server: "atlassian-remote" },
    ];
    const skills = generateBackendSkills(backends);

    expect(skills).toHaveLength(1);
    expect(skills[0].path).toBe(".claude/commands/ingest-asana.md");
  });
});
