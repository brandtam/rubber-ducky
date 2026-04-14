import { Command } from "commander";
import * as clack from "@clack/prompts";
import * as path from "node:path";
import chalk from "chalk";
import { createWorkspace, migrateWorkspace, detectExistingContent } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import type { BackendConfig, VocabularyOptions, TemplateOptions } from "../lib/templates.js";
import { slugify } from "../lib/page.js";
import { createAsanaClient, type AsanaClient } from "../lib/asana-client.js";
import { createJiraClient, type JiraClient } from "../lib/jira-client.js";

const BACKEND_CHOICES = [
  { value: "github", label: "GitHub", hint: "via gh CLI" },
  { value: "jira", label: "Jira", hint: "via JIRA_EMAIL + JIRA_API_TOKEN env vars" },
  { value: "asana", label: "Asana", hint: "via ASANA_ACCESS_TOKEN env var" },
] as const;

const MCP_DEFAULTS: Record<string, string> = {
  github: "github",
};

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a new Rubber-Ducky workspace")
    .argument("[directory]", "Target directory (defaults to workspace name)")
    .option("--backends-json <json>", "Backend configuration as JSON array (non-interactive)")
    .option("--vocabulary-json <json>", "Vocabulary configuration as JSON object (non-interactive)")
    .action(async (_directory: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      if (jsonMode) {
        const backends = opts.backendsJson
          ? (JSON.parse(opts.backendsJson as string) as BackendConfig[])
          : undefined;
        const vocabulary = opts.vocabularyJson
          ? (JSON.parse(opts.vocabularyJson as string) as VocabularyOptions)
          : undefined;
        await runNonInteractive(_directory, jsonMode, backends, vocabulary);
        return;
      }

      await runInteractive(_directory);
    });
}

async function collectBackendConfig(backendType: string): Promise<BackendConfig> {
  const config: BackendConfig = {
    type: backendType as BackendConfig["type"],
  };

  clack.log.info(chalk.bold(`Configuring ${backendType} backend`));

  // Only prompt for MCP server name for GitHub (still uses gh CLI / MCP).
  // Asana and Jira now use direct REST APIs via env var tokens.
  if (MCP_DEFAULTS[backendType]) {
    const mcpServer = await clack.text({
      message: `MCP server name for ${backendType}:`,
      placeholder: MCP_DEFAULTS[backendType],
      defaultValue: MCP_DEFAULTS[backendType],
    });

    if (clack.isCancel(mcpServer)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    config.mcp_server = (mcpServer as string) || MCP_DEFAULTS[backendType];
  }

  if (backendType === "github") {
    const reposInput = await clack.text({
      message: "GitHub repos to track (comma-separated, owner/repo format):",
      placeholder: "myorg/project-a, myorg/project-b",
      validate: (value) => {
        if (!value.trim()) return "At least one repo is required (e.g., myorg/my-project)";
        const repos = value.split(",").map((s) => s.trim()).filter(Boolean);
        for (const repo of repos) {
          if (!repo.includes("/")) return `"${repo}" must be in owner/repo format`;
        }
        return undefined;
      },
    });

    if (clack.isCancel(reposInput)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    config.repos = (reposInput as string).split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (backendType === "jira") {
    const jiraEmail = process.env.JIRA_EMAIL;
    const jiraToken = process.env.JIRA_API_TOKEN;

    if (jiraEmail && jiraToken) {
      const serverUrl = await clack.text({
        message: "Jira server URL:",
        placeholder: "https://myorg.atlassian.net",
        validate: (value) => {
          if (!value.trim()) return "Server URL is required for Jira";
          return undefined;
        },
      });

      if (clack.isCancel(serverUrl)) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }

      config.server_url = serverUrl as string;
      await discoverJiraConfig(config, config.server_url, jiraEmail, jiraToken);
    }
  }

  if (backendType === "asana") {
    const asanaToken = process.env.ASANA_ACCESS_TOKEN;

    if (asanaToken) {
      await discoverAsanaConfig(config, asanaToken);
    }
  }

  return config;
}

async function discoverAsanaConfig(config: BackendConfig, token: string): Promise<void> {
  const client = createAsanaClient({ token });

  // Verify connectivity
  const spinner = clack.spinner();
  spinner.start("Connecting to Asana...");
  try {
    const me = await client.getMe();
    spinner.stop(`Connected as ${chalk.cyan(me.name)} (${me.email})`);
  } catch {
    spinner.stop("Could not connect to Asana.");
    clack.log.warn(
      "Failed to connect with ASANA_ACCESS_TOKEN. Run /get-setup after verifying your token."
    );
    return;
  }

  // Discover workspaces
  const workspaces = await client.getWorkspaces();
  if (workspaces.length === 0) {
    clack.log.warn("No workspaces found in your Asana account.");
    return;
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
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    workspaceGid = selected as string;
  }

  config.workspace_id = workspaceGid;

  // Discover projects
  const projects = await client.getProjects(workspaceGid);
  if (projects.length === 0) {
    clack.log.warn("No projects found in this workspace.");
    return;
  }

  const selectedProject = await clack.select({
    message: "Select your default Asana project:",
    options: projects.map((p) => ({ value: p.gid, label: p.name })),
  });

  if (clack.isCancel(selectedProject)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  config.project_gid = selectedProject as string;

  // Discover custom fields for identifier_field
  const customFieldSettings = await client.getCustomFieldSettings(config.project_gid);
  if (customFieldSettings.length > 0) {
    const noneOption = { value: "__none__", label: "(none — use Asana GID)" };
    const fieldOptions = customFieldSettings.map((s) => ({
      value: s.custom_field.name,
      label: s.custom_field.name,
      hint: s.custom_field.resource_subtype,
    }));

    const selectedField = await clack.select({
      message: "Select a custom field for task identifiers (optional):",
      options: [noneOption, ...fieldOptions],
    });

    if (clack.isCancel(selectedField)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (selectedField !== "__none__") {
      config.identifier_field = selectedField as string;
    }
  }
}

async function discoverJiraConfig(
  config: BackendConfig,
  serverUrl: string,
  email: string,
  apiToken: string,
): Promise<void> {
  const client = createJiraClient({ serverUrl, email, apiToken });

  // Verify connectivity
  const spinner = clack.spinner();
  spinner.start("Connecting to Jira...");
  try {
    const me = await client.getMyself();
    spinner.stop(`Connected as ${chalk.cyan(me.displayName)} (${me.emailAddress})`);
  } catch {
    spinner.stop("Could not connect to Jira.");
    clack.log.warn(
      "Failed to connect with JIRA_EMAIL/JIRA_API_TOKEN. Run /get-setup after verifying your credentials."
    );
    return;
  }

  // Discover projects
  const projects = await client.getProjects();
  if (projects.length === 0) {
    clack.log.warn("No projects found in your Jira instance.");
    return;
  }

  const selectedProject = await clack.select({
    message: "Select your default Jira project:",
    options: projects.map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })),
  });

  if (clack.isCancel(selectedProject)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  config.project_key = selectedProject as string;
}

async function collectVocabulary(): Promise<VocabularyOptions> {
  const vocabulary: VocabularyOptions = {};

  const brandsInput = await clack.text({
    message: "Brand names (comma-separated, or press Enter to skip):",
    placeholder: "Acme Corp, Widget Co",
  });

  if (clack.isCancel(brandsInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if ((brandsInput as string)?.trim()) {
    vocabulary.brands = (brandsInput as string).split(",").map((s) => s.trim()).filter(Boolean);
  }

  const teamsInput = await clack.text({
    message: "Team names (comma-separated, or press Enter to skip):",
    placeholder: "Frontend, Backend, DevOps",
  });

  if (clack.isCancel(teamsInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if ((teamsInput as string)?.trim()) {
    vocabulary.teams = (teamsInput as string).split(",").map((s) => s.trim()).filter(Boolean);
  }

  const labelsInput = await clack.text({
    message: "Labels/tags (comma-separated, or press Enter to skip):",
    placeholder: "urgent, bug, feature",
  });

  if (clack.isCancel(labelsInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if ((labelsInput as string)?.trim()) {
    vocabulary.labels = (labelsInput as string).split(",").map((s) => s.trim()).filter(Boolean);
  }

  return vocabulary;
}

async function runInteractive(directory: string | undefined): Promise<void> {
  clack.intro(chalk.bold("rubber-ducky init"));

  const name = await clack.text({
    message: "What is your workspace name?",
    placeholder: "my-work-log",
    validate: (value) => {
      if (!value.trim()) return "Workspace name is required";
      return undefined;
    },
  });

  if (clack.isCancel(name)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const purpose = await clack.text({
    message: "What is the purpose of this workspace?",
    placeholder: "Track daily work and tasks",
    validate: (value) => {
      if (!value.trim()) return "Purpose is required";
      return undefined;
    },
  });

  if (clack.isCancel(purpose)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Backend selection
  const selectedBackends = await clack.multiselect({
    message: "Which backends do you use? (Space to select, Enter to confirm)",
    options: BACKEND_CHOICES.map((b) => ({
      value: b.value,
      label: b.label,
      hint: b.hint,
    })),
    required: false,
  });

  if (clack.isCancel(selectedBackends)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Collect backend config for each selected backend
  const backends: BackendConfig[] = [];
  for (const backendType of selectedBackends as string[]) {
    const config = await collectBackendConfig(backendType);
    backends.push(config);
  }

  // Ingest scope prompt (only if Asana or Jira is selected)
  let ingestScope: "mine" | "all" | "ask" | undefined;
  const hasTaskBackend = backends.some((b) => b.type === "asana" || b.type === "jira");
  if (hasTaskBackend) {
    const scopeChoice = await clack.select({
      message: "Default ingest scope — ingest your tasks only, or everything?",
      options: [
        { value: "mine", label: "My tasks only", hint: "filter to tasks assigned to you" },
        { value: "all", label: "All tasks", hint: "ingest everything in the project" },
        { value: "ask", label: "Ask each time", hint: "prompt before each ingest" },
      ],
    });

    if (clack.isCancel(scopeChoice)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    ingestScope = scopeChoice as "mine" | "all" | "ask";
  }

  // Vocabulary collection
  clack.log.info(
    chalk.bold("Controlled vocabulary") +
      "\nDefine brands, teams, and labels for consistent metadata." +
      "\nStatus vocabulary (backlog, to-do, in-progress, etc.) is included automatically."
  );

  const vocabulary = await collectVocabulary();

  const targetDir = directory ?? slugify(name as string);
  const fullPath = path.resolve(process.cwd(), targetDir);

  // Check for existing content
  const existingContent = detectExistingContent(fullPath);

  if (existingContent) {
    const { scanResult, migrationPlan } = existingContent;

    clack.log.info(
      `Found existing content in ${chalk.bold(fullPath)}:\n` +
      `  ${chalk.cyan(String(scanResult.totalMdFiles))} markdown file(s)\n` +
      `  ${chalk.cyan(String(scanResult.filesWithFrontmatter))} with YAML frontmatter`
    );

    if (migrationPlan.adoptedFiles.length > 0) {
      clack.log.info(
        `Migration plan:\n` +
        `  ${chalk.green(String(migrationPlan.filesToAddFrontmatter.length))} file(s) will get frontmatter added\n` +
        `  ${chalk.green(String(migrationPlan.filesToUpdateFrontmatter.length))} file(s) with existing frontmatter will be preserved\n` +
        `  ${chalk.green(String(migrationPlan.dirsToCreate.length))} directories will be created\n` +
        `  ${chalk.green(String(migrationPlan.templateFilesToCreate.length))} template file(s) will be created`
      );
    }

    const confirmMigrate = await clack.confirm({
      message: "Adopt existing content into Rubber-Ducky workspace?",
    });

    if (clack.isCancel(confirmMigrate) || !confirmMigrate) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    const spinner = clack.spinner();
    spinner.start("Migrating workspace...");

    try {
      const result = await migrateWorkspace({
        name: name as string,
        purpose: purpose as string,
        targetDir: fullPath,
      });

      spinner.stop("Workspace migrated!");

      const noteLines = [
        `${chalk.bold("Directories created:")} ${result.dirsCreated.join(", ") || "none"}`,
        `${chalk.bold("Files created:")} ${result.filesCreated.join(", ") || "none"}`,
        `${chalk.bold("Files migrated:")} ${result.filesAdopted?.length ?? 0}`,
        ...(result.claudeMdBackedUp ? [`${chalk.bold("CLAUDE.md backup:")} CLAUDE.md.backup (original preserved)`] : []),
        "",
        chalk.bold("Next steps:"),
        `  1. Open ${chalk.cyan(fullPath)} as a vault in Obsidian`,
        `  2. cd ${fullPath}`,
        `  3. Run ${chalk.cyan("claude")} to start Claude Code in your workspace`,
        `  4. Type ${chalk.cyan("/good-morning")} to start your first day`,
      ];

      clack.note(noteLines.join("\n"), result.workspacePath);
      clack.outro(chalk.green("Done! Your workspace is ready with migrated content."));
    } catch (error) {
      spinner.stop("Failed!");
      clack.log.error(
        error instanceof Error ? error.message : "Unknown error"
      );
      process.exit(1);
    }

    return;
  }

  // Fresh workspace creation
  const spinner = clack.spinner();
  spinner.start("Creating workspace...");

  try {
    const result = await createWorkspace({
      name: name as string,
      purpose: purpose as string,
      targetDir: fullPath,
      backends: backends.length > 0 ? backends : undefined,
      vocabulary: hasVocabulary(vocabulary) ? vocabulary : undefined,
      ingest_scope: ingestScope,
    });

    spinner.stop("Workspace created!");

    const notes = [
      `${chalk.bold("Created:")} ${result.filesCreated.length} files, ${result.dirsCreated.length} directories`,
    ];

    const needsSetup = backends.some((b) => b.type === "asana" || b.type === "jira");

    if (backends.length > 0) {
      notes.push(`${chalk.bold("Backends:")} ${backends.map((b) => b.type).join(", ")}`);
    }

    notes.push(
      "",
      chalk.bold("Next steps:"),
      `  1. Open ${chalk.cyan(fullPath)} as a vault in Obsidian`,
      `  2. cd ${fullPath}`,
    );

    if (needsSetup) {
      notes.push(
        `  3. Copy ${chalk.cyan(".env.example")} to ${chalk.cyan(".env.local")} and add your API tokens`,
        `  4. Run ${chalk.cyan("source .env.local")}`,
        `  5. Run ${chalk.cyan("claude")} and type ${chalk.cyan("/get-setup")} to connect your backends`,
      );
    } else {
      notes.push(
        `  3. Run ${chalk.cyan("claude")} to start Claude Code in your workspace`,
        `  4. Type ${chalk.cyan("/good-morning")} to start your first day`,
      );
    }

    clack.note(notes.join("\n"), result.workspacePath);

    clack.outro(chalk.green("Done! Your workspace is ready."));
  } catch (error) {
    spinner.stop("Failed!");
    clack.log.error(
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

async function runNonInteractive(
  directory: string | undefined,
  jsonMode: boolean,
  backends?: BackendConfig[],
  vocabulary?: VocabularyOptions,
): Promise<void> {
  // In non-interactive mode, use sensible defaults or error
  if (!directory) {
    const output = formatOutput(
      {
        success: false,
        error: "Directory argument is required in non-interactive mode",
      },
      { json: jsonMode, humanReadable: "Error: directory argument required in non-interactive mode" }
    );
    console.log(output);
    process.exit(1);
  }

  const name = path.basename(directory);
  const fullPath = path.resolve(process.cwd(), directory);

  // Check for existing content and auto-migrate
  const existingContent = detectExistingContent(fullPath);

  if (existingContent) {
    try {
      const result = await migrateWorkspace({
        name,
        purpose: "Rubber-Ducky workspace",
        targetDir: fullPath,
      });

      const output = formatOutput(
        {
          success: true,
          migrated: true,
          workspacePath: result.workspacePath,
          filesCreated: result.filesCreated,
          dirsCreated: result.dirsCreated,
          filesAdopted: result.filesAdopted,
          claudeMdBackedUp: result.claudeMdBackedUp,
        },
        {
          json: jsonMode,
          humanReadable: `Workspace migrated at ${result.workspacePath} (${result.filesAdopted?.length ?? 0} files migrated)`,
        }
      );
      console.log(output);
    } catch (error) {
      const output = formatOutput(
        {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        {
          json: jsonMode,
          humanReadable: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        }
      );
      console.log(output);
      process.exit(1);
    }

    return;
  }

  try {
    const result = await createWorkspace({
      name,
      purpose: "Rubber-Ducky workspace",
      targetDir: fullPath,
      backends,
      vocabulary,
    });

    const output = formatOutput(
      {
        success: true,
        workspacePath: result.workspacePath,
        filesCreated: result.filesCreated,
        dirsCreated: result.dirsCreated,
      },
      {
        json: jsonMode,
        humanReadable: `Workspace created at ${result.workspacePath}`,
      }
    );
    console.log(output);
  } catch (error) {
    const output = formatOutput(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        json: jsonMode,
        humanReadable: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    );
    console.log(output);
    process.exit(1);
  }
}

function hasVocabulary(v: VocabularyOptions): boolean {
  return Boolean(
    (v.brands && v.brands.length > 0) ||
    (v.teams && v.teams.length > 0) ||
    (v.labels && v.labels.length > 0)
  );
}

