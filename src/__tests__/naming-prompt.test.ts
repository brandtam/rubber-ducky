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
    custom_field: { gid: "cf1", name: "TIK", resource_subtype: "text" },
  },
  {
    gid: "cfs2",
    custom_field: { gid: "cf2", name: "Priority", resource_subtype: "enum" },
  },
  {
    gid: "cfs3",
    custom_field: { gid: "cf3", name: "Story Points", resource_subtype: "number" },
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

  it("sorts ID-type custom fields to top in source picker options", async () => {
    const fields: AsanaCustomFieldSetting[] = [
      { gid: "1", custom_field: { gid: "cf1", name: "Priority", resource_subtype: "enum" } },
      { gid: "2", custom_field: { gid: "cf2", name: "Ticket ID", resource_subtype: "text" } },
      { gid: "3", custom_field: { gid: "cf3", name: "Points", resource_subtype: "number" } },
    ];
    const client = makeClient({ customFields: fields, tasks: makeTasks() });

    mockSelect.mockResolvedValueOnce("__title__");
    mockConfirm.mockResolvedValueOnce(true);

    await runNamingPrompt({ client, projectGid: "proj-123" });

    // Inspect the options passed to the first select call
    const firstCall = mockSelect.mock.calls[0][0] as { options: Array<{ value: string; label: string }> };
    const values = firstCall.options.map((o) => o.value);

    // Text fields (ID-like) should be before enum/number fields
    const ticketIdx = values.indexOf("Ticket ID");
    const priorityIdx = values.indexOf("Priority");
    const pointsIdx = values.indexOf("Points");
    expect(ticketIdx).toBeLessThan(priorityIdx);
    expect(ticketIdx).toBeLessThan(pointsIdx);

    // Title and GID should be after custom fields
    const titleIdx = values.indexOf("__title__");
    const gidIdx = values.indexOf("__gid__");
    expect(titleIdx).toBeGreaterThan(priorityIdx);
    expect(gidIdx).toBeGreaterThan(titleIdx);
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
});
