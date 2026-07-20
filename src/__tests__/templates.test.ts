import { describe, it, expect } from "bun:test";
import { parse as parseYaml } from "yaml";
import {
  generateWorkspaceMd,
  generateAgentsMd,
  generateReferenceFiles,
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

  it("omits backends key entirely when no backends provided", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter).not.toHaveProperty("backends");
  });

  it("does not include cli_mode in frontmatter", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter).not.toHaveProperty("cli_mode");
    expect(content).not.toContain("cli_mode");
  });

  it("omits ingest_scope from frontmatter when not provided", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter).not.toHaveProperty("ingest_scope");
  });

  it("omits intake when not provided", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter).not.toHaveProperty("intake");
  });

  it("omits repo_labels when not provided or empty", () => {
    const content = generateWorkspaceMd({ name: "Test", purpose: "Testing" });
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = parseYaml(match![1]);

    expect(frontmatter).not.toHaveProperty("repo_labels");
  });
});

describe("generateAgentsMd", () => {
  it("includes workspace identity", () => {
    const content = generateAgentsMd({ name: "Dev Log", purpose: "Daily tracking" });

    expect(content).toContain("Dev Log");
    expect(content).toContain("Daily tracking");
  });

  it("does NOT reference UBIQUITOUS_LANGUAGE.md when no backends are configured", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).not.toContain("Import and follow @UBIQUITOUS_LANGUAGE.md");
  });

  it("includes a Connected integrations placeholder when no backends", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("## Connected integrations");
    expect(content).toContain("/connect");
  });

  it("always includes the credential safety guardrail", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("## Credential safety");
    expect(content).toContain(
      "Ask the user to paste API tokens, passwords, or credentials into the chat"
    );
  });

  it("includes key file pointers", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("workspace.md");
    expect(content).toContain("wiki/");
  });

  it("includes CLI command reference", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("rubber-ducky page create");
    expect(content).toContain("rubber-ducky task start");
    expect(content).toContain("rubber-ducky asap add");
    expect(content).toContain("rubber-ducky log append");
  });

  it("includes common request mapping table", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("User says");
    expect(content).toContain("You do");
  });

  it("describes the primary interface role", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).toContain("You are the primary interface");
  });

  it("does not include cli_mode references", () => {
    const content = generateAgentsMd({ name: "Test", purpose: "Testing" });

    expect(content).not.toContain("cli_mode");
  });
});

describe("generateAgentsMd natural-language triggers", () => {
  it("instructs the agent to dispatch good-morning greetings directly", () => {
    const content = generateAgentsMd({ name: "W", purpose: "P" });

    expect(content).toContain("/good-morning");
    expect(content).toContain("do not ask for confirmation");
  });

  it("instructs the agent to dispatch wrap-up triggers directly", () => {
    const content = generateAgentsMd({ name: "W", purpose: "P" });

    expect(content).toContain("/wrap-up");
    expect(content).toContain("eod");
  });
});

describe("generateReferenceFiles", () => {
  it("returns universal files when no backends provided", () => {
    const refs = generateReferenceFiles();
    const paths = refs.map((r) => r.path);

    expect(paths).toContain("references/frontmatter-templates.md");
    expect(paths).toContain("references/when-to-use-cli.md");
    expect(paths).toHaveLength(2);
  });

  it("frontmatter templates reference contains all three page types", () => {
    const refs = generateReferenceFiles();
    const fm = refs.find((r) => r.path === "references/frontmatter-templates.md")!;

    expect(fm.content).toContain("## Daily page");
    expect(fm.content).toContain("## Task page");
    expect(fm.content).toContain("## Project page");
  });

  it("frontmatter templates reference contains status vocabulary", () => {
    const refs = generateReferenceFiles();
    const fm = refs.find((r) => r.path === "references/frontmatter-templates.md")!;

    expect(fm.content).toContain("## Valid statuses");
    expect(fm.content).toContain("backlog");
    expect(fm.content).toContain("in-progress");
    expect(fm.content).toContain("done");
    expect(fm.content).toContain("deferred");
  });

  it("when-to-use-cli reference contains decision guide", () => {
    const refs = generateReferenceFiles();
    const cli = refs.find((r) => r.path === "references/when-to-use-cli.md")!;

    expect(cli.content).toContain("## The rule");
    expect(cli.content).toContain("## Decision guide");
  });

  it("when-to-use-cli reference does not contain cli_mode toggle section", () => {
    const refs = generateReferenceFiles();
    const cli = refs.find((r) => r.path === "references/when-to-use-cli.md")!;

    expect(cli.content).not.toContain("cli_mode");
  });

  it("backend-setup reference is not generated when no backends configured", () => {
    const refs = generateReferenceFiles();
    const paths = refs.map((r) => r.path);

    expect(paths).not.toContain("references/backend-setup.md");
  });
});
