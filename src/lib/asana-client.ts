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

export interface AsanaClient {
  getMe(): Promise<AsanaUser>;
  getTask(gid: string): Promise<AsanaTask>;
  getStories(taskGid: string): Promise<AsanaStory[]>;
  getTasksForProject(projectGid: string, opts?: TaskListOptions): Promise<AsanaTask[]>;
  getTasksForSection(sectionGid: string, opts?: TaskListOptions): Promise<AsanaTask[]>;
}

export function createAsanaClient(options: AsanaClientOptions): AsanaClient {
  const { token } = options;

  if (!token) {
    throw new Error(
      "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for instructions."
    );
  }

  const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  async function request<T>(path: string): Promise<T> {
    const url = `${ASANA_API_BASE}${path}`;
    const response = await fetchFn(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Asana API ${response.status}: ${body}`
      );
    }

    const json = (await response.json()) as { data: T };
    return json.data;
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
      let url = `/projects/${projectGid}/tasks?opt_fields=${TASK_OPT_FIELDS}`;
      if (opts?.assigneeGid) {
        url += `&assignee.any=${opts.assigneeGid}`;
      }
      return request<AsanaTask[]>(url);
    },

    async getTasksForSection(sectionGid: string, opts?: TaskListOptions): Promise<AsanaTask[]> {
      let url = `/sections/${sectionGid}/tasks?opt_fields=${TASK_OPT_FIELDS}`;
      if (opts?.assigneeGid) {
        url += `&assignee.any=${opts.assigneeGid}`;
      }
      return request<AsanaTask[]>(url);
    },
  };
}
