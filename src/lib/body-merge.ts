/**
 * Pure body merge for Asana + Jira task pages.
 *
 * `mergePageBodies(asanaBody, jiraBody)` takes the markdown body (post-
 * frontmatter) of each page and produces a merged body with:
 *
 * 1. Backend-scoped sections: Asana description, Jira description,
 *    Asana comments, Jira comments (in that order)
 * 2. Attachments: union of all attachment lines from both pages
 * 3. Activity log: union of entries, sorted chronologically
 * 4. See also: union, deduped
 */

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

interface ParsedSections {
  asanaDescription: string;
  jiraDescription: string;
  asanaComments: string;
  jiraComments: string;
  attachments: string[];
  activityLog: string[];
  seeAlso: string[];
}

const SECTION_RE = /^## (.+)$/;

/**
 * Parse a page body into named sections. Each section captures all lines
 * between its header and the next `## ` header (or end of string).
 */
function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split("\n");
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(SECTION_RE);
    if (match) {
      if (currentSection !== null) {
        sections.set(currentSection, currentLines.join("\n").trim());
      }
      currentSection = match[1];
      currentLines = [];
    } else if (currentSection !== null) {
      currentLines.push(line);
    }
  }

  if (currentSection !== null) {
    sections.set(currentSection, currentLines.join("\n").trim());
  }

  return sections;
}

/**
 * Extract bullet-list items from a section's content.
 */
function extractListItems(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge two page bodies into one canonical merged body.
 *
 * Output section order:
 * 1. ## Asana description
 * 2. ## Jira description
 * 3. ## Asana comments
 * 4. ## Jira comments
 * 5. ## Attachments (only if either page has attachments)
 * 6. ## Activity log (union, chronological)
 * 7. ## See also (union, deduped)
 */
export function mergePageBodies(asanaBody: string, jiraBody: string): string {
  const asanaSections = parseSections(asanaBody);
  const jiraSections = parseSections(jiraBody);

  const sections: string[] = [];

  // 1. Asana description
  sections.push("## Asana description");
  sections.push("");
  const asanaDesc = asanaSections.get("Asana description") ?? "";
  if (asanaDesc) {
    sections.push(asanaDesc);
    sections.push("");
  }

  // 2. Jira description
  sections.push("## Jira description");
  sections.push("");
  const jiraDesc = jiraSections.get("Jira description") ?? "";
  if (jiraDesc) {
    sections.push(jiraDesc);
    sections.push("");
  }

  // 3. Asana comments
  sections.push("## Asana comments");
  sections.push("");
  const asanaComments = asanaSections.get("Asana comments") ?? "";
  if (asanaComments) {
    sections.push(asanaComments);
    sections.push("");
  }

  // 4. Jira comments
  sections.push("## Jira comments");
  sections.push("");
  const jiraComments = jiraSections.get("Jira comments") ?? "";
  if (jiraComments) {
    sections.push(jiraComments);
    sections.push("");
  }

  // 5. Attachments — union of all lines from both pages
  const asanaAttachments = asanaSections.get("Attachments") ?? "";
  const jiraAttachments = jiraSections.get("Attachments") ?? "";
  const allAttachmentLines = [
    ...extractListItems(asanaAttachments),
    ...extractListItems(jiraAttachments),
  ];

  // Dedup by full line (different paths = different lines)
  const uniqueAttachments = [...new Set(allAttachmentLines)];

  if (uniqueAttachments.length > 0) {
    sections.push("## Attachments");
    sections.push("");
    for (const line of uniqueAttachments) {
      sections.push(line);
    }
    sections.push("");
  }

  // 6. Activity log — union, sorted chronologically
  const asanaLog = asanaSections.get("Activity log") ?? "";
  const jiraLog = jiraSections.get("Activity log") ?? "";
  const allLogEntries = [
    ...extractListItems(asanaLog),
    ...extractListItems(jiraLog),
  ];

  // Dedup and sort chronologically (entries start with `- <ISO timestamp>`)
  const uniqueLogEntries = [...new Set(allLogEntries)];
  uniqueLogEntries.sort();

  sections.push("## Activity log");
  sections.push("");
  if (uniqueLogEntries.length > 0) {
    for (const entry of uniqueLogEntries) {
      sections.push(entry);
    }
    sections.push("");
  }

  // 7. See also — union, deduped
  const asanaSeeAlso = asanaSections.get("See also") ?? "";
  const jiraSeeAlso = jiraSections.get("See also") ?? "";
  const allSeeAlso = [
    ...extractListItems(asanaSeeAlso),
    ...extractListItems(jiraSeeAlso),
  ];
  const uniqueSeeAlso = [...new Set(allSeeAlso)];

  sections.push("## See also");
  sections.push("");
  if (uniqueSeeAlso.length > 0) {
    for (const entry of uniqueSeeAlso) {
      sections.push(entry);
    }
    sections.push("");
  }

  return sections.join("\n");
}
