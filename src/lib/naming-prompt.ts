/**
 * Shared interactive prompt module for configuring the Asana naming scheme.
 *
 * Two-step picker: source first, casing second (skipped for title/GID).
 * Then a live preview of real filenames, with a yes/no confirmation loop.
 *
 * Used by:
 * - `rubber-ducky asana configure-naming` command
 * - `rubber-ducky init` Asana discovery flow
 */

import * as clack from "@clack/prompts";
import chalk from "chalk";
import type { AsanaClient, AsanaCustomFieldSetting } from "./asana-client.js";
import { previewNames, type NamingInput, type NamingScheme } from "./naming.js";
import { updateWorkspaceBackend } from "./workspace.js";
import type { BackendConfig } from "./templates.js";

// Sentinel values used as the picker's "value" for the two non-custom-field
// sources. Kept as exported constants so callers that need to pre-select or
// pattern-match don't drift against stringly-typed literals.
export const SOURCE_TITLE = "__title__";
export const SOURCE_GID = "__gid__";
const SOURCE_SEPARATOR = "__sep__";

export interface NamingPromptResult {
  naming_source: "identifier" | "title" | "gid";
  naming_case: "preserve" | "lower";
  identifier_field: string | undefined;
}

export interface NamingPromptOptions {
  client: AsanaClient;
  projectGid: string;
  /**
   * Pre-select a value in the source picker. Accepts a custom field name
   * (e.g. "TIK"), `SOURCE_TITLE`, or `SOURCE_GID`. Used by the legacy
   * migration path and the dedicated reconfigure command so the user's
   * existing choice is the default.
   */
  preselectedSource?: string;
  preselectedCase?: "preserve" | "lower";
}

/**
 * Map a stored BackendConfig to the picker sentinel value that represents
 * the same source. Inverse of the sentinel → stored-value mapping inside
 * `resolveScheme`; kept paired here so the two don't drift apart.
 */
export function backendConfigToPickerSource(
  config: Pick<BackendConfig, "naming_source" | "identifier_field">,
): string | undefined {
  if (config.naming_source === "title") return SOURCE_TITLE;
  if (config.naming_source === "gid") return SOURCE_GID;
  if (config.identifier_field) return config.identifier_field;
  return undefined;
}

/**
 * Persist the three naming fields produced by the prompt to workspace.md.
 * Shared between the dedicated `configure-naming` command and the
 * ingest-time auto-trigger so both write the same shape.
 */
export function persistNamingResult(
  workspaceRoot: string,
  result: NamingPromptResult,
): void {
  const fields: Record<string, unknown> = {
    naming_source: result.naming_source,
    naming_case: result.naming_case,
  };
  if (result.identifier_field) {
    fields.identifier_field = result.identifier_field;
  }
  updateWorkspaceBackend(workspaceRoot, "asana", fields);
}

/**
 * Asana's first-class "ID custom field" is identified by a non-null
 * `id_prefix` (e.g. "TIK") — not by a dedicated resource_subtype. See
 * https://developers.asana.com/docs/custom-fields-guide. Sort these to
 * the top of the picker because they're the canonical choice for
 * filename generation.
 */
function isIdCustomField(field: AsanaCustomFieldSetting): boolean {
  return typeof field.custom_field.id_prefix === "string"
    && field.custom_field.id_prefix.length > 0;
}

function sortFields(fields: AsanaCustomFieldSetting[]): AsanaCustomFieldSetting[] {
  const idFields = fields.filter(isIdCustomField);
  const otherFields = fields.filter((f) => !isIdCustomField(f));
  return [...idFields, ...otherFields];
}

function buildSourceOptions(fields: AsanaCustomFieldSetting[]): Array<{
  value: string;
  label: string;
  hint?: string;
}> {
  const sorted = sortFields(fields);
  const fieldOptions = sorted.map((f) => ({
    value: f.custom_field.name,
    label: f.custom_field.name,
    hint: isIdCustomField(f)
      ? `ID field — prefix: ${f.custom_field.id_prefix}`
      : f.custom_field.resource_subtype,
  }));

  const separator = fieldOptions.length > 0
    ? [{ value: SOURCE_SEPARATOR, label: "───────────────────", hint: "" }]
    : [];

  return [
    ...fieldOptions,
    ...separator,
    { value: SOURCE_TITLE, label: "Task title", hint: "slugified, always lowercase" },
    { value: SOURCE_GID, label: "Asana GID", hint: "numeric, stable unique ID" },
  ];
}

function resolveScheme(
  sourceValue: string,
  casingValue?: string,
): { scheme: NamingScheme; identifierField: string | undefined } {
  if (sourceValue === SOURCE_TITLE) {
    return {
      scheme: { source: "title", case: "lower" },
      identifierField: undefined,
    };
  }
  if (sourceValue === SOURCE_GID) {
    return {
      scheme: { source: "gid", case: "lower" },
      identifierField: undefined,
    };
  }
  return {
    scheme: {
      source: "identifier",
      case: (casingValue as "preserve" | "lower") ?? "lower",
    },
    identifierField: sourceValue,
  };
}

function resolveIdentifierForPreview(
  task: { custom_fields: { name: string; display_value: string | null }[] },
  fieldName: string,
): string | null {
  const cf = task.custom_fields.find(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
  );
  return cf?.display_value || null;
}

export async function runNamingPrompt(
  opts: NamingPromptOptions,
): Promise<NamingPromptResult> {
  const { client, projectGid, preselectedSource, preselectedCase } = opts;

  // Fetch custom fields for the source picker
  const customFieldSettings = await client.getCustomFieldSettings(projectGid);

  // Fetch sample tasks for preview (up to 5)
  const sampleTasks = await client.getTasksForProject(projectGid);
  const previewTasks = sampleTasks.slice(0, 5);

  while (true) {
    const options = buildSourceOptions(customFieldSettings);
    const selectableOptions = options.filter((o) => o.value !== SOURCE_SEPARATOR);

    const sourceInitial =
      preselectedSource && selectableOptions.some((o) => o.value === preselectedSource)
        ? preselectedSource
        : undefined;

    const sourceValue = await clack.select({
      message: "How should task filenames be generated?",
      options: selectableOptions,
      initialValue: sourceInitial,
    });

    if (clack.isCancel(sourceValue)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    let casingValue: string | undefined;
    const isCustomField = sourceValue !== SOURCE_TITLE && sourceValue !== SOURCE_GID;

    if (isCustomField) {
      casingValue = (await clack.select({
        message: "Filename casing:",
        options: [
          { value: "preserve", label: "Preserve original casing", hint: "e.g. TIK-4647.md" },
          { value: "lower", label: "Lowercase", hint: "e.g. tik-4647.md" },
        ],
        initialValue: preselectedCase,
      })) as string;

      if (clack.isCancel(casingValue)) {
        clack.cancel("Setup cancelled.");
        process.exit(0);
      }
    }

    // Resolve the scheme
    const { scheme, identifierField } = resolveScheme(
      sourceValue as string,
      casingValue,
    );

    // Step 3: Preview
    if (previewTasks.length > 0) {
      const inputs: NamingInput[] = previewTasks.map((task) => ({
        gid: task.gid,
        title: task.name,
        identifier: identifierField
          ? resolveIdentifierForPreview(task, identifierField)
          : null,
      }));

      const previewed = previewNames(inputs, scheme);
      const previewLines = previewed.map((name) => `  ${name}.md`).join("\n");
      clack.log.info(`Preview filenames:\n${previewLines}`);
    }

    // Step 4: Confirmation
    const confirmed = await clack.confirm({
      message: "Use this naming scheme?",
    });

    if (clack.isCancel(confirmed)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (confirmed) {
      return {
        naming_source: scheme.source,
        naming_case: scheme.case,
        identifier_field: identifierField,
      };
    }
    // User declined — loop back to re-pick
  }
}
