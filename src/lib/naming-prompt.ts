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

export interface NamingPromptResult {
  naming_source: "identifier" | "title" | "gid";
  naming_case: "preserve" | "lower";
  identifier_field: string | undefined;
}

export interface NamingPromptOptions {
  client: AsanaClient;
  projectGid: string;
}

// Subtypes that typically represent ID-like fields (sort to top)
const ID_SUBTYPES = new Set(["text"]);

function sortFields(fields: AsanaCustomFieldSetting[]): AsanaCustomFieldSetting[] {
  const idFields = fields.filter((f) => ID_SUBTYPES.has(f.custom_field.resource_subtype));
  const otherFields = fields.filter((f) => !ID_SUBTYPES.has(f.custom_field.resource_subtype));
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
    hint: f.custom_field.resource_subtype,
  }));

  const separator = fieldOptions.length > 0
    ? [{ value: "__sep__", label: "───────────────────", hint: "" }]
    : [];

  return [
    ...fieldOptions,
    ...separator,
    { value: "__title__", label: "Task title", hint: "slugified, always lowercase" },
    { value: "__gid__", label: "Asana GID", hint: "numeric, stable unique ID" },
  ];
}

function resolveScheme(
  sourceValue: string,
  casingValue?: string,
): { scheme: NamingScheme; identifierField: string | undefined } {
  if (sourceValue === "__title__") {
    return {
      scheme: { source: "title", case: "lower" },
      identifierField: undefined,
    };
  }
  if (sourceValue === "__gid__") {
    return {
      scheme: { source: "gid", case: "lower" },
      identifierField: undefined,
    };
  }
  // Custom field
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
  const { client, projectGid } = opts;

  // Fetch custom fields for the source picker
  const customFieldSettings = await client.getCustomFieldSettings(projectGid);

  // Fetch sample tasks for preview (up to 5)
  const sampleTasks = await client.getTasksForProject(projectGid);
  const previewTasks = sampleTasks.slice(0, 5);

  // Loop until user confirms
  while (true) {
    // Step 1: Source picker
    const options = buildSourceOptions(customFieldSettings);
    // Filter out separator for actual selection
    const selectableOptions = options.filter((o) => o.value !== "__sep__");

    const sourceValue = await clack.select({
      message: "How should task filenames be generated?",
      options: selectableOptions,
    });

    if (clack.isCancel(sourceValue)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    // Step 2: Casing picker (only for custom fields)
    let casingValue: string | undefined;
    const isCustomField = sourceValue !== "__title__" && sourceValue !== "__gid__";

    if (isCustomField) {
      casingValue = (await clack.select({
        message: "Filename casing:",
        options: [
          { value: "preserve", label: "Preserve original casing", hint: "e.g. TIK-4647.md" },
          { value: "lower", label: "Lowercase", hint: "e.g. tik-4647.md" },
        ],
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
