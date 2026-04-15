import * as clack from "@clack/prompts";
import chalk from "chalk";
import { createAsanaClient, type AsanaClient } from "./asana-client.js";
import { createJiraClient } from "./jira-client.js";
import { runNamingPrompt } from "./naming-prompt.js";

export interface AsanaIdField {
  name: string;
  id_prefix: string;
}

/**
 * Query a project's custom field settings and return only fields that are
 * Asana ID custom fields (non-null, non-empty `id_prefix`).
 *
 * Accepts an optional pre-built client for testing; otherwise creates one
 * from the token.
 */
export async function detectAsanaIdFields(opts: {
  projectGid: string;
  client?: AsanaClient;
  token?: string;
}): Promise<AsanaIdField[]> {
  const client =
    opts.client ?? createAsanaClient({ token: opts.token! });
  const fields = await client.getCustomFieldSettings(opts.projectGid);
  return fields
    .filter(
      (f) =>
        typeof f.custom_field.id_prefix === "string" &&
        f.custom_field.id_prefix.length > 0,
    )
    .map((f) => ({
      name: f.custom_field.name,
      id_prefix: f.custom_field.id_prefix!,
    }));
}

export interface JiraDiscoveryResult {
  project_key: string;
}

export interface AsanaDiscoveryResult {
  workspace_id: string;
  project_gid: string;
  naming_source: "identifier" | "title" | "gid";
  naming_case: "preserve" | "lower" | "upper";
  identifier_field?: string;
}

/**
 * Connect to Jira, list projects, and prompt the user to pick a default.
 * Returns the chosen project_key, or null if discovery could not complete.
 * Uses clack prompts — requires an interactive terminal.
 */
export async function discoverJiraConfig(opts: {
  serverUrl: string;
  email: string;
  apiToken: string;
}): Promise<JiraDiscoveryResult | null> {
  const client = createJiraClient({
    serverUrl: opts.serverUrl,
    email: opts.email,
    apiToken: opts.apiToken,
  });

  const spinner = clack.spinner();
  spinner.start("Connecting to Jira...");
  try {
    const me = await client.getMyself();
    spinner.stop(`Connected as ${chalk.cyan(me.displayName)} (${me.emailAddress})`);
  } catch {
    spinner.stop("Could not connect to Jira.");
    return null;
  }

  const projects = await client.getProjects();
  if (projects.length === 0) {
    clack.log.warn("No projects found in your Jira instance.");
    return null;
  }

  const selected = await clack.select({
    message: "Select your default Jira project:",
    options: projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })),
  });

  if (clack.isCancel(selected)) {
    clack.cancel("Configuration cancelled.");
    return null;
  }

  return { project_key: selected as string };
}

/**
 * Connect to Asana, list workspaces + projects, prompt for default selections
 * and naming strategy. Returns the discovered fields, or null if discovery
 * could not complete. Uses clack prompts — requires an interactive terminal.
 */
export async function discoverAsanaConfig(opts: {
  token: string;
}): Promise<AsanaDiscoveryResult | null> {
  const client = createAsanaClient({ token: opts.token });

  const spinner = clack.spinner();
  spinner.start("Connecting to Asana...");
  try {
    const me = await client.getMe();
    spinner.stop(`Connected as ${chalk.cyan(me.name)} (${me.email})`);
  } catch {
    spinner.stop("Could not connect to Asana.");
    return null;
  }

  const workspaces = await client.getWorkspaces();
  if (workspaces.length === 0) {
    clack.log.warn("No workspaces found in your Asana account.");
    return null;
  }

  let workspaceGid: string;
  if (workspaces.length === 1) {
    workspaceGid = workspaces[0].gid;
    clack.log.info(`Using workspace: ${chalk.cyan(workspaces[0].name)}`);
  } else {
    const selected = await clack.select({
      message: "Select your Asana workspace:",
      options: workspaces.map((w) => ({ value: w.gid, label: w.name })),
    });

    if (clack.isCancel(selected)) {
      clack.cancel("Configuration cancelled.");
      return null;
    }

    workspaceGid = selected as string;
  }

  const projects = await client.getProjects(workspaceGid);
  if (projects.length === 0) {
    clack.log.warn("No projects found in this workspace.");
    return null;
  }

  const selectedProject = await clack.select({
    message: "Select your default Asana project:",
    options: projects.map((p) => ({ value: p.gid, label: p.name })),
  });

  if (clack.isCancel(selectedProject)) {
    clack.cancel("Configuration cancelled.");
    return null;
  }

  const projectGid = selectedProject as string;

  const namingResult = await runNamingPrompt({
    client,
    projectGid,
  });

  return {
    workspace_id: workspaceGid,
    project_gid: projectGid,
    naming_source: namingResult.naming_source,
    naming_case: namingResult.naming_case,
    ...(namingResult.identifier_field
      ? { identifier_field: namingResult.identifier_field }
      : {}),
  };
}
