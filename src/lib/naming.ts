/**
 * Pure naming logic — given a task and a naming scheme, returns
 * the filename base (no .md extension).
 *
 * No I/O, no API calls, no file system. The single source of truth
 * for "what does this task's filename look like under this scheme?"
 */

import { slugify, slugifyPreserveCase } from "./page.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NamingInput {
  gid: string;
  title: string;
  identifier: string | null;
}

export interface NamingScheme {
  source: "identifier" | "title" | "gid";
  case: "preserve" | "lower" | "upper";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a naming scheme to a single task and return the filename base
 * (no `.md` extension).
 *
 * Empty-value fallback is centralized here: if the chosen source
 * produces an empty string (all-emoji title, missing custom field, etc.),
 * the filename falls back to the task GID.
 */
export function applyNamingScheme(
  input: NamingInput,
  scheme: NamingScheme
): string {
  switch (scheme.source) {
    case "gid":
      return input.gid;

    case "title": {
      // Title source always lowercases through slugify
      const slug = slugify(input.title);
      return slug || input.gid;
    }

    case "identifier": {
      if (!input.identifier) return input.gid;
      let result: string;
      if (scheme.case === "preserve") {
        result = slugifyPreserveCase(input.identifier);
      } else if (scheme.case === "upper") {
        result = slugifyPreserveCase(input.identifier).toUpperCase();
      } else {
        result = slugify(input.identifier);
      }
      return result || input.gid;
    }
  }
}

/**
 * Run a naming scheme over a list of tasks for preview generation.
 * Returns an array of filename bases (no `.md` extension).
 */
export function previewNames(
  inputs: NamingInput[],
  scheme: NamingScheme
): string[] {
  return inputs.map((input) => applyNamingScheme(input, scheme));
}

/**
 * For migration: given a workspace config, infer whether the user has
 * an existing naming choice or whether the prompt needs to fire.
 *
 * Returns a NamingScheme if one can be inferred from legacy config
 * (identifier_field set but no explicit naming_source), or null if
 * the prompt should fire (no config to infer from, or already migrated).
 */
export function inferLegacyScheme(config: {
  identifier_field?: string;
  naming_source?: string;
}): NamingScheme | null {
  // Already migrated — no inference needed
  if (config.naming_source) return null;

  // Legacy config: identifier_field set → infer identifier + lower
  if (config.identifier_field) {
    return { source: "identifier", case: "lower" };
  }

  // No config to infer from — prompt should fire
  return null;
}
