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

const VALID_PAGE_TYPES = ["daily", "task", "project"];

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
    created: { required: true },
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

  return errors;
}
