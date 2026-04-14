import { describe, it, expect, vi } from "vitest";
import type { AsanaClient } from "../lib/asana-client.js";
import { detectAsanaIdFields } from "../lib/backend-discovery.js";

function makeMockClient(
  customFields: Array<{
    gid: string;
    custom_field: {
      gid: string;
      name: string;
      resource_subtype: string;
      id_prefix: string | null;
    };
  }>,
): AsanaClient {
  return {
    getCustomFieldSettings: vi.fn().mockResolvedValue(customFields),
    // Stubs — not used by detectAsanaIdFields
    getMe: vi.fn(),
    getTask: vi.fn(),
    getTaskByCustomId: vi.fn(),
    getStories: vi.fn(),
    getTasksForProject: vi.fn(),
    getTasksForSection: vi.fn(),
    getAttachments: vi.fn(),
    downloadFile: vi.fn(),
    createTask: vi.fn(),
    createStory: vi.fn(),
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
  } as unknown as AsanaClient;
}

describe("detectAsanaIdFields", () => {
  it("returns fields with non-null id_prefix", async () => {
    const client = makeMockClient([
      {
        gid: "1",
        custom_field: {
          gid: "cf1",
          name: "ECOMM",
          resource_subtype: "text",
          id_prefix: "ECOMM",
        },
      },
      {
        gid: "2",
        custom_field: {
          gid: "cf2",
          name: "Priority",
          resource_subtype: "enum",
          id_prefix: null,
        },
      },
    ]);

    const result = await detectAsanaIdFields({
      projectGid: "12345",
      client,
    });

    expect(result).toEqual([{ name: "ECOMM", id_prefix: "ECOMM" }]);
  });

  it("returns multiple ID fields when project has several", async () => {
    const client = makeMockClient([
      {
        gid: "1",
        custom_field: {
          gid: "cf1",
          name: "ECOMM",
          resource_subtype: "text",
          id_prefix: "ECOMM",
        },
      },
      {
        gid: "2",
        custom_field: {
          gid: "cf2",
          name: "BUG",
          resource_subtype: "text",
          id_prefix: "BUG",
        },
      },
    ]);

    const result = await detectAsanaIdFields({
      projectGid: "12345",
      client,
    });

    expect(result).toEqual([
      { name: "ECOMM", id_prefix: "ECOMM" },
      { name: "BUG", id_prefix: "BUG" },
    ]);
  });

  it("returns empty array when no fields have id_prefix", async () => {
    const client = makeMockClient([
      {
        gid: "1",
        custom_field: {
          gid: "cf1",
          name: "Priority",
          resource_subtype: "enum",
          id_prefix: null,
        },
      },
    ]);

    const result = await detectAsanaIdFields({
      projectGid: "12345",
      client,
    });

    expect(result).toEqual([]);
  });

  it("returns empty array when project has no custom fields", async () => {
    const client = makeMockClient([]);

    const result = await detectAsanaIdFields({
      projectGid: "12345",
      client,
    });

    expect(result).toEqual([]);
  });

  it("ignores fields with empty string id_prefix", async () => {
    const client = makeMockClient([
      {
        gid: "1",
        custom_field: {
          gid: "cf1",
          name: "Weird Field",
          resource_subtype: "text",
          id_prefix: "",
        },
      },
    ]);

    const result = await detectAsanaIdFields({
      projectGid: "12345",
      client,
    });

    expect(result).toEqual([]);
  });
});
