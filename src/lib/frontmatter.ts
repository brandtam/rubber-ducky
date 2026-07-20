import { parse as yamlParse, stringify as yamlStringify } from "yaml";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)---(\n[\s\S]*)?$/;

const VALID_STATUSES = [
  "backlog", "to-do", "in-progress", "in-review",
  "pending", "blocked", "done", "deferred",
];

const VALID_SPIKE_STATUSES = ["open", "closed", "revisit"];

const VALID_PROJECT_STATUSES = ["backlog", "active", "completed", "archived"];

const VALID_PAGE_TYPES = ["daily", "task", "project", "meeting", "spike", "weekly", "repo"];

interface SchemaField {
  required: boolean;
  validate?: (value: unknown) => string | null;
}

type Schema = Record<string, SchemaField>;

const SCHEMAS: Record<string, Schema> = {
  daily: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "daily" ? null : 'type must be "daily"',
    },
    created: { required: true },
  },
  task: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "task" ? null : 'type must be "task"',
    },
    status: {
      required: true,
      validate: (v) =>
        typeof v === "string" && VALID_STATUSES.includes(v)
          ? null
          : `status must be one of: ${VALID_STATUSES.join(", ")}`,
    },
    created: { required: true },
  },
  project: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "project" ? null : 'type must be "project"',
    },
    status: {
      required: false,
      validate: (v) =>
        typeof v === "string" && VALID_PROJECT_STATUSES.includes(v)
          ? null
          : `status must be one of: ${VALID_PROJECT_STATUSES.join(", ")}`,
    },
    created: { required: true },
    data_sources: {
      required: false,
      validate: (v) =>
        Array.isArray(v) && v.every((entry) => typeof entry === "string")
          ? null
          : "data_sources must be an array of strings",
    },
  },
  meeting: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "meeting" ? null : 'type must be "meeting"',
    },
    date: { required: true },
    created: { required: true },
  },
  spike: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "spike" ? null : 'type must be "spike"',
    },
    status: {
      required: true,
      validate: (v) =>
        typeof v === "string" && VALID_SPIKE_STATUSES.includes(v)
          ? null
          : `status must be one of: ${VALID_SPIKE_STATUSES.join(", ")}`,
    },
    created: { required: true },
  },
  weekly: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "weekly" ? null : 'type must be "weekly"',
    },
    created: { required: true },
    period_start: { required: true },
    period_end: { required: true },
  },
  repo: {
    title: { required: true },
    type: {
      required: true,
      validate: (v) => v === "repo" ? null : 'type must be "repo"',
    },
    created: { required: true },
    // `repo` (owner/repo) and `changelog_path` are optional at creation time —
    // a user can create the page first and have /release fill them in on the
    // first run by writing back to this page's frontmatter.
  },
};

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns null if no valid frontmatter is found.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  if (!content || !content.startsWith("---\n")) {
    return null;
  }

  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return null;
  }

  const yamlStr = match[1];
  const body = match[2] ? match[2].replace(/^\n/, "") : "";

  const data = yamlStr.trim() === "" ? {} : yamlParse(yamlStr);

  return {
    data: data && typeof data === "object" ? data : {},
    body: body.trimEnd() === "" ? "" : body,
  };
}

/**
 * Set or update a frontmatter field, preserving all other fields and the body.
 * Throws if the content has no frontmatter.
 */
export function setFrontmatterField(
  content: string,
  field: string,
  value: unknown
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    throw new Error("Cannot set frontmatter field: no frontmatter found in content");
  }

  const updatedData = { ...parsed.data, [field]: value };
  const yamlStr = yamlStringify(updatedData).trimEnd();
  const body = parsed.body;

  if (body) {
    return `---\n${yamlStr}\n---\n${body}`;
  }
  return `---\n${yamlStr}\n---\n`;
}

function readArrayField(
  parsed: ParsedFrontmatter,
  field: string
): unknown[] {
  const current = parsed.data[field];
  if (current === undefined || current === null) {
    return [];
  }
  if (!Array.isArray(current)) {
    throw new FrontmatterArrayTypeError(field, current);
  }
  return current;
}

function writeArrayBack(parsed: ParsedFrontmatter, field: string, values: unknown[]): string {
  const updatedData = { ...parsed.data, [field]: values };
  const yamlStr = yamlStringify(updatedData).trimEnd();
  if (parsed.body) {
    return `---\n${yamlStr}\n---\n${parsed.body}`;
  }
  return `---\n${yamlStr}\n---\n`;
}

/**
 * Append a value to a frontmatter array field.
 *
 * - Creates the field as `[value]` when it doesn't exist.
 * - Unique by default (no-op when value already present).
 *   Pass `allowDuplicates: true` to append unconditionally.
 *
 * Throws `FrontmatterArrayTypeError` if the field exists but isn't an array.
 */
export function addToFrontmatterArray(
  content: string,
  field: string,
  value: string,
  options?: { allowDuplicates?: boolean }
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    throw new Error("Cannot modify frontmatter array: no frontmatter found in content");
  }

  const current = readArrayField(parsed, field);

  if (!options?.allowDuplicates && current.includes(value)) {
    return content;
  }

  return writeArrayBack(parsed, field, [...current, value]);
}

/**
 * Remove a value from a frontmatter array field. Idempotent — no-op when
 * the value isn't present. Field is preserved as an empty array even when
 * the last element is removed, so downstream consumers can rely on its
 * presence.
 *
 * Throws `FrontmatterArrayTypeError` if the field exists but isn't an array.
 */
export function removeFromFrontmatterArray(
  content: string,
  field: string,
  value: string
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    throw new Error("Cannot modify frontmatter array: no frontmatter found in content");
  }

  const current = readArrayField(parsed, field);
  const next = current.filter((entry) => entry !== value);

  if (next.length === current.length) {
    return content;
  }

  return writeArrayBack(parsed, field, next);
}

/**
 * Replace a frontmatter array field with the given values. An empty array
 * is a valid state — the field is set to `[]`, not removed.
 *
 * Unlike add/remove, this does not require the field to already be an
 * array (overwrite is the explicit semantic).
 */
export function setFrontmatterArray(
  content: string,
  field: string,
  values: string[]
): string {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    throw new Error("Cannot modify frontmatter array: no frontmatter found in content");
  }

  return writeArrayBack(parsed, field, [...values]);
}

/**
 * Thrown when the caller asks `addToFrontmatterArray` or
 * `removeFromFrontmatterArray` to operate on a field that already exists
 * with a non-array value. Carries the field name and observed value so the
 * CLI layer can format a helpful message.
 */
export class FrontmatterArrayTypeError extends Error {
  readonly field: string;
  readonly actualValue: unknown;

  constructor(field: string, actualValue: unknown) {
    super(`Field "${field}" exists but is not an array (got ${typeof actualValue}). Use 'frontmatter set' for scalar values.`);
    this.name = "FrontmatterArrayTypeError";
    this.field = field;
    this.actualValue = actualValue;
  }
}

/**
 * Validate frontmatter data against a page type schema.
 * If pageType is not specified, it is auto-detected from the `type` field.
 */
export function validateFrontmatter(
  data: Record<string, unknown>,
  pageType?: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Determine page type
  const effectiveType = pageType ?? (data.type as string | undefined);

  if (!effectiveType) {
    errors.push({
      field: "type",
      message: `type is required and must be one of: ${VALID_PAGE_TYPES.join(", ")}`,
    });
    return errors;
  }

  if (!VALID_PAGE_TYPES.includes(effectiveType)) {
    errors.push({
      field: "type",
      message: `unknown page type "${effectiveType}"; must be one of: ${VALID_PAGE_TYPES.join(", ")}`,
    });
    return errors;
  }

  const schema = SCHEMAS[effectiveType];

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const value = data[fieldName];

    if (fieldSchema.required && (value === undefined || value === null || value === "")) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required for ${effectiveType} pages`,
      });
      continue;
    }

    if (value !== undefined && value !== null && fieldSchema.validate) {
      const error = fieldSchema.validate(value);
      if (error) {
        errors.push({ field: fieldName, message: error });
      }
    }
  }

  // Cross-field rule: a closed spike must have a verdict.
  if (effectiveType === "spike" && data.status === "closed") {
    const verdict = data.verdict;
    if (verdict === undefined || verdict === null || verdict === "") {
      errors.push({
        field: "verdict",
        message: "verdict is required when spike status is closed",
      });
    }
  }

  return errors;
}
