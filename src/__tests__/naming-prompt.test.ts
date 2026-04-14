import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AsanaClient, AsanaCustomFieldSetting, AsanaTask } from "../lib/asana-client.js";
import { runNamingPrompt, type NamingPromptResult } from "../lib/naming-prompt.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), step: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
}));

import * as clack from "@clack/prompts";

const mockSelect = vi.mocked(clack.select);
const mockConfirm = vi.mocked(clack.confirm);

function makeClient(overrides?: {
  customFields?: AsanaCustomFieldSetting[];
  tasks?: AsanaTask[];
}): AsanaClient {
  const fields = overrides?.customFields ?? [];
  const tasks = overrides?.tasks ?? [];
  return {
    getMe: vi.fn().mockResolvedValue({ gid: "u1", name: "Test", email: "t@t.com" }),
    getTask: vi.fn(),
    getStories: vi.fn(),
    getTasksForProject: vi.fn().mockResolvedValue(tasks),
    getTasksForSection: vi.fn(),
    getAttachments: vi.fn(),
    downloadFile: vi.fn(),
    createTask: vi.fn(),
    createStory: vi.fn(),
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getCustomFieldSettings: vi.fn().mockResolvedValue(fields),
  };
}

function makeTasks(): AsanaTask[] {
  return [
    {
      gid: "1001",
      name: "Fix login button on checkout",
      notes: "",
      completed: false,
      completed_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      assignee: null,
      due_on: null,
      memberships: [],
      tags: [],
      permalink_url: "https://app.asana.com/0/0/1001",
      custom_fields: [{ gid: "cf1", name: "TIK", display_value: "TIK-4647" }],
    },
    {
      gid: "1002",
      name: "Update pricing page copy",
      notes: "",
      completed: false,
      completed_at: null,
      created_at: "2026-01-02T00:00:00.000Z",
      assignee: null,
      due_on: null,
      memberships: [],
      tags: [],
      permalink_url: "https://app.asana.com/0/0/1002",
      custom_fields: [{ gid: "cf1", name: "TIK", display_value: "TIK-4648" }],
    },
    {
      gid: "1003",
      name: "Deploy hotfix for API rate limiting",
      notes: "",
      completed: false,
      completed_at: null,
      created_at: "2026-01-03T00:00:00.000Z",
      assignee: null,
      due_on: null,
      memberships: [],
      tags: [],
      permalink_url: "https://app.asana.com/0/0/1003",
      custom_fields: [{ gid: "cf1", name: "TIK", display_value: "TIK-4649" }],
    },
  ];
}

const ID_TYPE_FIELDS: AsanaCustomFieldSetting[] = [
  {
    gid: "cfs1",
    // Real Asana ID custom field — detected by non-null id_prefix
    custom_field: { gid: "cf1", name: "TIK", resource_subtype: "text", id_prefix: "TIK" },
  },
  {
    gid: "cfs2",
    custom_field: { gid: "cf2", name: "Priority", resource_subtype: "enum", id_prefix: null },
  },
  {
    gid: "cfs3",
    custom_field: { gid: "cf3", name: "Story Points", resource_subtype: "number", id_prefix: null },
  },
];

describe("runNamingPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns identifier source with preserve case when user picks a custom field", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    // 1st select: pick "TIK" custom field
    // 2nd select: pick "preserve" casing
    // confirm: yes
    mockSelect
      .mockResolvedValueOnce("TIK")      // source picker
      .mockResolvedValueOnce("preserve"); // casing picker
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "identifier",
      naming_case: "preserve",
      identifier_field: "TIK",
    });
  });

  it("returns title source and skips casing picker", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });
    // Casing select should NOT have been called
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns gid source and skips casing picker", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect.mockResolvedValueOnce("__gid__");
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "gid",
      naming_case: "lower",
      identifier_field: undefined,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("works with zero custom fields — only title and GID options", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: [], tasks });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });
  });

  it("re-picks when user declines confirmation", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    // First round: pick TIK + preserve, decline
    mockSelect
      .mockResolvedValueOnce("TIK")
      .mockResolvedValueOnce("preserve");
    mockConfirm.mockResolvedValueOnce(false);

    // Second round: pick title, accept
    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "title",
      naming_case: "lower",
      identifier_field: undefined,
    });
  });

  it("sorts Asana ID custom fields (non-null id_prefix) to top in source picker", async () => {
    const fields: AsanaCustomFieldSetting[] = [
      { gid: "1", custom_field: { gid: "cf1", name: "Priority", resource_subtype: "enum", id_prefix: null } },
      // Real ID custom field — should surface first even though base type is text
      { gid: "2", custom_field: { gid: "cf2", name: "Ticket ID", resource_subtype: "text", id_prefix: "TIK" } },
      { gid: "3", custom_field: { gid: "cf3", name: "Points", resource_subtype: "number", id_prefix: null } },
      // Plain text field — not an ID field, should NOT be sorted to top
      { gid: "4", custom_field: { gid: "cf4", name: "Notes", resource_subtype: "text", id_prefix: null } },
    ];
    const client = makeClient({ customFields: fields, tasks: makeTasks() });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    await runNamingPrompt({ client, projectGid: "proj-123" });

    const firstCall = mockSelect.mock.calls[0][0] as {
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    const values = firstCall.options.map((o) => o.value);

    // Ticket ID (real ID field) must come before all non-ID fields,
    // including the plain text "Notes" field.
    const ticketIdx = values.indexOf("Ticket ID");
    const priorityIdx = values.indexOf("Priority");
    const pointsIdx = values.indexOf("Points");
    const notesIdx = values.indexOf("Notes");
    expect(ticketIdx).toBeLessThan(priorityIdx);
    expect(ticketIdx).toBeLessThan(pointsIdx);
    expect(ticketIdx).toBeLessThan(notesIdx);

    // Title and GID should be after custom fields
    const titleIdx = values.indexOf("__title__");
    const gidIdx = values.indexOf("__gid__");
    expect(titleIdx).toBeGreaterThan(notesIdx);
    expect(gidIdx).toBeGreaterThan(titleIdx);

    // Hint for the ID field should surface the prefix
    const ticketOption = firstCall.options.find((o) => o.value === "Ticket ID");
    expect(ticketOption?.hint).toContain("TIK");
  });

  it("returns identifier with lower case", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect
      .mockResolvedValueOnce("TIK")
      .mockResolvedValueOnce("lower");
    mockConfirm.mockResolvedValueOnce(true);

    const result = await runNamingPrompt({
      client,
      projectGid: "proj-123",
    });

    expect(result).toEqual({
      naming_source: "identifier",
      naming_case: "lower",
      identifier_field: "TIK",
    });
  });

  it("pre-selects a custom field when preselectedSource matches", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect
      .mockResolvedValueOnce("TIK")
      .mockResolvedValueOnce("preserve");
    mockConfirm.mockResolvedValueOnce(true);

    await runNamingPrompt({
      client,
      projectGid: "proj-123",
      preselectedSource: "TIK",
      preselectedCase: "preserve",
    });

    // Source picker was called with initialValue: "TIK"
    const sourceCall = mockSelect.mock.calls[0][0] as { initialValue?: string };
    expect(sourceCall.initialValue).toBe("TIK");

    // Casing picker was called with initialValue: "preserve"
    const casingCall = mockSelect.mock.calls[1][0] as { initialValue?: string };
    expect(casingCall.initialValue).toBe("preserve");
  });

  it("ignores preselectedSource when it does not match any option", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    await runNamingPrompt({
      client,
      projectGid: "proj-123",
      preselectedSource: "NonexistentField",
    });

    const sourceCall = mockSelect.mock.calls[0][0] as { initialValue?: string };
    expect(sourceCall.initialValue).toBeUndefined();
  });

  it("pre-selects __title__ when that was the previous choice", async () => {
    const tasks = makeTasks();
    const client = makeClient({ customFields: ID_TYPE_FIELDS, tasks });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    await runNamingPrompt({
      client,
      projectGid: "proj-123",
      preselectedSource: "__title__",
    });

    const sourceCall = mockSelect.mock.calls[0][0] as { initialValue?: string };
    expect(sourceCall.initialValue).toBe("__title__");
  });
});
