import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { createWorkspace } from "../lib/workspace.js";
import type { BackendConfig } from "../lib/templates.js";

// Mock only the interactive prompt; keep the pure helpers real so the
// persistence and pre-selection mapping actually execute under test.
vi.mock("../lib/naming-prompt.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/naming-prompt.js")>(
    "../lib/naming-prompt.js",
  );
  return { ...actual, runNamingPrompt: vi.fn() };
});

// Mock asana-client
vi.mock("../lib/asana-client.js", () => ({
  createAsanaClient: vi.fn(() => ({
    getTask: vi.fn(),
    getStories: vi.fn(async () => []),
    getAttachments: vi.fn(async () => []),
    getTasksForProject: vi.fn(async () => []),
    getMe: vi.fn(async () => ({ gid: "me", name: "Test", email: "t@t.com" })),
    getCustomFieldSettings: vi.fn(async () => []),
    downloadFile: vi.fn(),
  })),
}));

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
}));

import { runNamingPrompt } from "../lib/naming-prompt.js";
import { ensureNamingConfig } from "../commands/ingest.js";

const mockRunNamingPrompt = vi.mocked(runNamingPrompt);

describe("ensureNamingConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-ingest-auto-naming-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFrontmatter(wsDir: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(wsDir, "workspace.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return parseYaml(match![1]);
  }

  it("skips prompt when naming_source is already configured", async () => {
    const targetDir = path.join(tmpDir, "ws");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        {
          type: "asana",
          workspace_id: "ws-123",
          project_gid: "proj-456",
          naming_source: "title",
          naming_case: "lower",
        },
      ],
    });

    const result = await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: {
        type: "asana",
        project_gid: "proj-456",
        naming_source: "title",
        naming_case: "lower",
      },
    });

    expect(mockRunNamingPrompt).not.toHaveBeenCalled();
    expect(result).toEqual({
      namingSource: "title",
      namingCase: "lower",
      identifierField: undefined,
    });
  });

  it("runs prompt when naming_source is missing and persists config", async () => {
    const targetDir = path.join(tmpDir, "ws2");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
      ],
    });

    mockRunNamingPrompt.mockResolvedValueOnce({
      naming_source: "identifier",
      naming_case: "preserve",
      identifier_field: "TIK",
    });

    const result = await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: {
        type: "asana",
        project_gid: "proj-456",
      },
    });

    expect(mockRunNamingPrompt).toHaveBeenCalledOnce();
    expect(mockRunNamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.anything(),
        projectGid: "proj-456",
      }),
    );
    expect(result).toEqual({
      namingSource: "identifier",
      namingCase: "preserve",
      identifierField: "TIK",
    });

    // Verify persisted to workspace.md
    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("identifier");
    expect(asana.naming_case).toBe("preserve");
    expect(asana.identifier_field).toBe("TIK");
  });

  it("runs prompt for legacy workspace with identifier_field but no naming_source", async () => {
    const targetDir = path.join(tmpDir, "ws3");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        {
          type: "asana",
          workspace_id: "ws-123",
          project_gid: "proj-456",
          identifier_field: "ECOMM",
        },
      ],
    });

    mockRunNamingPrompt.mockResolvedValueOnce({
      naming_source: "identifier",
      naming_case: "lower",
      identifier_field: "ECOMM",
    });

    const result = await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: {
        type: "asana",
        project_gid: "proj-456",
        identifier_field: "ECOMM",
      },
    });

    expect(mockRunNamingPrompt).toHaveBeenCalledOnce();
    // Legacy migration: existing identifier_field must be passed as
    // preselectedSource so the user's prior implicit choice is the default.
    expect(mockRunNamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        preselectedSource: "ECOMM",
        preselectedCase: "lower",
      }),
    );
    expect(result).toEqual({
      namingSource: "identifier",
      namingCase: "lower",
      identifierField: "ECOMM",
    });

    // Verify persisted
    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("identifier");
    expect(asana.naming_case).toBe("lower");
  });

  it("does not pass preselectedSource for a fresh workspace (no identifier_field)", async () => {
    const targetDir = path.join(tmpDir, "ws-fresh");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
      ],
    });

    mockRunNamingPrompt.mockResolvedValueOnce({
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });

    await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: { type: "asana", project_gid: "proj-456" },
    });

    expect(mockRunNamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        preselectedSource: undefined,
        preselectedCase: undefined,
      }),
    );
  });

  it("preserves existing backend fields when persisting naming config", async () => {
    const targetDir = path.join(tmpDir, "ws4");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
      ],
    });

    mockRunNamingPrompt.mockResolvedValueOnce({
      naming_source: "gid",
      naming_case: "lower",
      identifier_field: undefined,
    });

    await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: {
        type: "asana",
        workspace_id: "ws-123",
        project_gid: "proj-456",
      },
    });

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.workspace_id).toBe("ws-123");
    expect(asana.project_gid).toBe("proj-456");
    expect(asana.naming_source).toBe("gid");
    expect(asana.naming_case).toBe("lower");
  });

  it("returns identifier_field as undefined for title source", async () => {
    const targetDir = path.join(tmpDir, "ws5");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
      ],
    });

    mockRunNamingPrompt.mockResolvedValueOnce({
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });

    const result = await ensureNamingConfig({
      workspaceRoot: targetDir,
      client: {} as any,
      projectGid: "proj-456",
      backendConfig: {
        type: "asana",
        project_gid: "proj-456",
      },
    });

    expect(result.identifierField).toBeUndefined();
  });
});
