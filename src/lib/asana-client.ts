/**
 * Thin REST API client for Asana using Node's built-in fetch().
 *
 * Auth: Bearer token via ASANA_ACCESS_TOKEN env var.
 * All HTTP I/O is injectable via the `fetch` option for testing.
 */

const ASANA_API_BASE = "https://app.asana.com/api/1.0";

const TASK_OPT_FIELDS = [
  "gid",
  "name",
  "notes",
  "completed",
  "completed_at",
  "assignee.name",
  "assignee.gid",
  "due_on",
  "memberships.section.name",
  "memberships.section.gid",
  "tags.name",
  "permalink_url",
  "custom_fields",
].join(",");

const ATTACHMENT_OPT_FIELDS = [
  "gid",
  "name",
  "download_url",
  "resource_subtype",
].join(",");

const STORY_OPT_FIELDS = [
  "gid",
  "type",
  "text",
  "created_by.name",
  "created_by.gid",
  "created_at",
].join(",");

export interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  completed_at: string | null;
  assignee: { name: string; gid: string } | null;
  due_on: string | null;
  memberships: { section: { name: string; gid: string } }[];
  tags: { name: string }[];
  permalink_url: string;
  custom_fields: { gid: string; name: string; display_value: string | null }[];
}

export interface AsanaStory {
  gid: string;
  type: string;
  text: string;
  created_by: { name: string; gid: string };
  created_at: string;
}

export interface AsanaAttachment {
  gid: string;
  name: string;
  download_url: string | null;
  resource_subtype: string;
}

export interface AsanaUser {
  gid: string;
  name: string;
  email: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface AsanaClientOptions {
  token: string;
  fetch?: FetchFn;
}

export interface TaskListOptions {
  assigneeGid?: string;
}

export interface AsanaCreateTaskResult {
  gid: string;
  permalink_url: string;
}

export interface AsanaCreateStoryResult {
  gid: string;
  text?: string;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
}

export interface AsanaCustomFieldSetting {
  gid: string;
  custom_field: { gid: string; name: string; resource_subtype: string };
}

export interface AsanaClient {
  getMe(): Promise<AsanaUser>;
  getTask(gid: string): Promise<AsanaTask>;
  getStories(taskGid: string): Promise<AsanaStory[]>;
  getTasksForProject(projectGid: string, opts?: TaskListOptions): Promise<AsanaTask[]>;
  getTasksForSection(sectionGid: string, opts?: TaskListOptions): Promise<AsanaTask[]>;
  getAttachments(taskGid: string): Promise<AsanaAttachment[]>;
  downloadFile(url: string): Promise<Buffer>;
  createTask(params: Record<string, unknown>): Promise<AsanaCreateTaskResult>;
  createStory(taskGid: string, text: string): Promise<AsanaCreateStoryResult>;
  getWorkspaces(): Promise<AsanaWorkspace[]>;
  getProjects(workspaceGid: string): Promise<AsanaProject[]>;
  getCustomFieldSettings(projectGid: string): Promise<AsanaCustomFieldSetting[]>;
}

export function createAsanaClient(options: AsanaClientOptions): AsanaClient {
  const { token } = options;
  const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;

  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  async function request<T>(apiPath: string, init?: RequestInit): Promise<T> {
    if (!token) {
      throw new Error(
        "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for instructions."
      );
    }

    const url = `${ASANA_API_BASE}${apiPath}`;
    const extraHeaders = init?.headers
      ? Object.fromEntries(new Headers(init.headers).entries())
      : {};
    const mergedHeaders = { ...authHeaders, ...extraHeaders };
    const response = await fetchFn(url, { ...init, headers: mergedHeaders });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Asana API ${response.status}: ${body}`
      );
    }

    const json = (await response.json()) as { data: T };
    return json.data;
  }

  /**
   * Paginate through all results for list endpoints.
   * Asana uses cursor-based pagination via next_page.uri.
   */
  async function requestPaginated<T>(initialPath: string): Promise<T[]> {
    const all: T[] = [];
    let nextUrl: string | null = `${ASANA_API_BASE}${initialPath}`;

    while (nextUrl) {
      const response = await fetchFn(nextUrl, { headers: authHeaders });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Asana API ${response.status}: ${body}`);
      }

      const json = (await response.json()) as {
        data: T[];
        next_page: { uri: string } | null;
      };
      all.push(...json.data);
      nextUrl = json.next_page?.uri ?? null;
    }

    return all;
  }

  return {
    async getMe(): Promise<AsanaUser> {
      return request<AsanaUser>("/users/me");
    },

    async getTask(gid: string): Promise<AsanaTask> {
      return request<AsanaTask>(`/tasks/${gid}?opt_fields=${TASK_OPT_FIELDS}`);
    },

    async getStories(taskGid: string): Promise<AsanaStory[]> {
      return request<AsanaStory[]>(
        `/tasks/${taskGid}/stories?opt_fields=${STORY_OPT_FIELDS}`
      );
    },

    async getTasksForProject(projectGid: string, opts?: TaskListOptions): Promise<AsanaTask[]> {
      let url = `/projects/${projectGid}/tasks?opt_fields=${TASK_OPT_FIELDS}&limit=100`;
      if (opts?.assigneeGid) {
        url += `&assignee.any=${opts.assigneeGid}`;
      }
      return requestPaginated<AsanaTask>(url);
    },

    async getTasksForSection(sectionGid: string, opts?: TaskListOptions): Promise<AsanaTask[]> {
      let url = `/sections/${sectionGid}/tasks?opt_fields=${TASK_OPT_FIELDS}&limit=100`;
      if (opts?.assigneeGid) {
        url += `&assignee.any=${opts.assigneeGid}`;
      }
      return requestPaginated<AsanaTask>(url);
    },

    async getAttachments(taskGid: string): Promise<AsanaAttachment[]> {
      return request<AsanaAttachment[]>(
        `/tasks/${taskGid}/attachments?opt_fields=${ATTACHMENT_OPT_FIELDS}`
      );
    },

    async downloadFile(url: string): Promise<Buffer> {
      const response = await fetchFn(url, {});
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Download failed ${response.status}: ${body}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },

    async createTask(params: Record<string, unknown>): Promise<AsanaCreateTaskResult> {
      return request<AsanaCreateTaskResult>("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: params }),
      });
    },

    async createStory(taskGid: string, text: string): Promise<AsanaCreateStoryResult> {
      return request<AsanaCreateStoryResult>(`/tasks/${taskGid}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { text } }),
      });
    },

    async getWorkspaces(): Promise<AsanaWorkspace[]> {
      return request<AsanaWorkspace[]>("/workspaces?opt_fields=gid,name");
    },

    async getProjects(workspaceGid: string): Promise<AsanaProject[]> {
      return request<AsanaProject[]>(
        `/workspaces/${workspaceGid}/projects?opt_fields=gid,name`
      );
    },

    async getCustomFieldSettings(projectGid: string): Promise<AsanaCustomFieldSetting[]> {
      return request<AsanaCustomFieldSetting[]>(
        `/projects/${projectGid}/custom_field_settings?opt_fields=custom_field.gid,custom_field.name,custom_field.resource_subtype`
      );
    },
  };
}
