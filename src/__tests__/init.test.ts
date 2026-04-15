import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { createWorkspace, type WorkspaceOptions } from "../lib/workspace.js";
import type { BackendConfig } from "../lib/templates.js";

describe("init — workspace creation with discovery fields", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-init-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFrontmatter(wsDir: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(wsDir, "workspace.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return parseYaml(match![1]);
  }

  it("writes workspace_id and project_gid for Asana backend", async () => {
    const targetDir = path.join(tmpDir, "ws-asana");
    const backends: BackendConfig[] = [
      {
        type: "asana",
        mcp_server: "asana",
        workspace_id: "ws-12345",
        project_gid: "proj-67890",
      },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const fm = readFrontmatter(targetDir);
    const asanaBackend = (fm.backends as BackendConfig[])[0];
    expect(asanaBackend.workspace_id).toBe("ws-12345");
    expect(asanaBackend.project_gid).toBe("proj-67890");
  });

  it("writes identifier_field for Asana backend when provided", async () => {
    const targetDir = path.join(tmpDir, "ws-asana-id");
    const backends: BackendConfig[] = [
      {
        type: "asana",
        mcp_server: "asana",
        workspace_id: "ws-12345",
        project_gid: "proj-67890",
        identifier_field: "ECOMM",
      },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const fm = readFrontmatter(targetDir);
    const asanaBackend = (fm.backends as BackendConfig[])[0];
    expect(asanaBackend.identifier_field).toBe("ECOMM");
  });

  it("writes project_key for Jira backend when provided", async () => {
    const targetDir = path.join(tmpDir, "ws-jira");
    const backends: BackendConfig[] = [
      {
        type: "jira",
        mcp_server: "atlassian-remote",
        server_url: "https://myorg.atlassian.net",
        project_key: "ECOMM",
      },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const fm = readFrontmatter(targetDir);
    const jiraBackend = (fm.backends as BackendConfig[])[0];
    expect(jiraBackend.project_key).toBe("ECOMM");
    expect(jiraBackend.server_url).toBe("https://myorg.atlassian.net");
  });

  it("writes ingest_scope to workspace.md when provided", async () => {
    const targetDir = path.join(tmpDir, "ws-scope");
    const backends: BackendConfig[] = [
      { type: "asana", mcp_server: "asana" },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
      ingest_scope: "mine",
    });

    const fm = readFrontmatter(targetDir);
    expect(fm.ingest_scope).toBe("mine");
  });

  it("writes ingest_scope 'ask' to workspace.md", async () => {
    const targetDir = path.join(tmpDir, "ws-scope-ask");
    const backends: BackendConfig[] = [
      { type: "jira", mcp_server: "atlassian-remote", server_url: "https://x.atlassian.net" },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
      ingest_scope: "ask",
    });

    const fm = readFrontmatter(targetDir);
    expect(fm.ingest_scope).toBe("ask");
  });

  it("omits ingest_scope from workspace.md when not provided", async () => {
    const targetDir = path.join(tmpDir, "ws-no-scope");

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
    });

    const fm = readFrontmatter(targetDir);
    expect(fm).not.toHaveProperty("ingest_scope");
  });

  it("creates get-setup skill with PAT instructions for Asana backend", async () => {
    const targetDir = path.join(tmpDir, "ws-setup-asana");
    const backends: BackendConfig[] = [
      { type: "asana", mcp_server: "asana" },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const setupContent = fs.readFileSync(
      path.join(targetDir, ".claude/commands/get-setup.md"),
      "utf-8"
    );
    expect(setupContent).toContain("Personal Access Token");
    expect(setupContent).toContain("ASANA_ACCESS_TOKEN");
    expect(setupContent).not.toContain("mcp.asana.com");
    expect(setupContent).not.toContain("/mcp");
  });

  it("creates get-setup skill with API token instructions for Jira backend", async () => {
    const targetDir = path.join(tmpDir, "ws-setup-jira");
    const backends: BackendConfig[] = [
      {
        type: "jira",
        mcp_server: "atlassian-remote",
        server_url: "https://myorg.atlassian.net",
      },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const setupContent = fs.readFileSync(
      path.join(targetDir, ".claude/commands/get-setup.md"),
      "utf-8"
    );
    expect(setupContent).toContain("API token");
    expect(setupContent).toContain("JIRA_EMAIL");
    expect(setupContent).toContain("JIRA_API_TOKEN");
    expect(setupContent).not.toContain("mcp.atlassian.com");
  });

  it("writes naming_source and naming_case for Asana backend when provided", async () => {
    const targetDir = path.join(tmpDir, "ws-naming");
    const backends: BackendConfig[] = [
      {
        type: "asana",
        workspace_id: "ws-123",
        project_gid: "proj-456",
        identifier_field: "TIK",
        naming_source: "identifier",
        naming_case: "preserve",
      },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("identifier");
    expect(asana.naming_case).toBe("preserve");
    expect(asana.identifier_field).toBe("TIK");
  });

  it("seeds wiki/status-mapping.md with Jira and Asana mappings", async () => {
    const targetDir = path.join(tmpDir, "ws-status-map");
    const backends: BackendConfig[] = [
      { type: "jira", server_url: "https://myorg.atlassian.net", project_key: "WEB" },
      { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
    ];

    const result = await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const mappingPath = path.join(targetDir, "wiki", "status-mapping.md");
    expect(fs.existsSync(mappingPath)).toBe(true);

    const content = fs.readFileSync(mappingPath, "utf-8");
    expect(content).toContain("## Jira → wiki");
    expect(content).toContain("## Asana → wiki");
    expect(content).toContain("## Wiki vocabulary");
    expect(result.filesCreated).toContain("wiki/status-mapping.md");
  });

  it("seeds wiki/status-mapping.md with only configured backends", async () => {
    const targetDir = path.join(tmpDir, "ws-status-jira-only");
    const backends: BackendConfig[] = [
      { type: "jira", server_url: "https://myorg.atlassian.net" },
    ];

    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const content = fs.readFileSync(
      path.join(targetDir, "wiki", "status-mapping.md"),
      "utf-8",
    );
    expect(content).toContain("## Jira → wiki");
    expect(content).not.toContain("## Asana → wiki");
  });

  it("creates workspace with all discovery fields populated end-to-end", async () => {
    const targetDir = path.join(tmpDir, "ws-full");
    const backends: BackendConfig[] = [
      {
        type: "asana",
        mcp_server: "asana",
        workspace_id: "ws-123",
        project_gid: "proj-456",
        identifier_field: "TICKET",
      },
      {
        type: "jira",
        mcp_server: "atlassian-remote",
        server_url: "https://myorg.atlassian.net",
        project_key: "WEB",
      },
    ];

    await createWorkspace({
      name: "full-workspace",
      purpose: "end-to-end test",
      targetDir,
      backends,
      ingest_scope: "all",
    });

    const fm = readFrontmatter(targetDir);
    expect(fm.ingest_scope).toBe("all");

    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.workspace_id).toBe("ws-123");
    expect(asana.project_gid).toBe("proj-456");
    expect(asana.identifier_field).toBe("TICKET");

    const jira = (fm.backends as BackendConfig[])[1];
    expect(jira.server_url).toBe("https://myorg.atlassian.net");
    expect(jira.project_key).toBe("WEB");
  });

  it("installs configure-status-mapping skill when workspace is created with backends", async () => {
    const targetDir = path.join(tmpDir, "ws-skill");
    const backends: BackendConfig[] = [
      { type: "jira", server_url: "https://x.atlassian.net" },
    ];

    const result = await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends,
    });

    const skillPath = path.join(targetDir, ".claude", "commands", "configure-status-mapping.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("Configure Status Mapping");
    expect(content).toContain("wiki/status-mapping.md");
    expect(result.filesCreated).toContain(".claude/commands/configure-status-mapping.md");
  });
});
