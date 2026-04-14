import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { createWorkspace } from "../lib/workspace.js";
import type { BackendConfig } from "../lib/templates.js";

// Mock naming-prompt module
vi.mock("../lib/naming-prompt.js", () => ({
  runNamingPrompt: vi.fn(),
}));

// Mock asana-client
vi.mock("../lib/asana-client.js", () => ({
  createAsanaClient: vi.fn(() => ({})),
}));

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
}));

import { runNamingPrompt } from "../lib/naming-prompt.js";
import { configureNaming } from "../commands/asana.js";

const mockRunNamingPrompt = vi.mocked(runNamingPrompt);

describe("configureNaming", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-configure-naming-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFrontmatter(wsDir: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(wsDir, "workspace.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return parseYaml(match![1]);
  }

  it("writes naming fields to workspace.md for identifier+preserve", async () => {
    const targetDir = path.join(tmpDir, "ws");
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

    await configureNaming(targetDir, "fake-token");

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("identifier");
    expect(asana.naming_case).toBe("preserve");
    expect(asana.identifier_field).toBe("TIK");
  });

  it("writes naming fields for title source", async () => {
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
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });

    await configureNaming(targetDir, "fake-token");

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("title");
    expect(asana.naming_case).toBe("lower");
  });

  it("writes naming fields for gid source", async () => {
    const targetDir = path.join(tmpDir, "ws3");
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

    await configureNaming(targetDir, "fake-token");

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("gid");
    expect(asana.naming_case).toBe("lower");
  });

  it("preserves existing backend fields", async () => {
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
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });

    await configureNaming(targetDir, "fake-token");

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.workspace_id).toBe("ws-123");
    expect(asana.project_gid).toBe("proj-456");
  });
});
