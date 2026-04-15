/**
 * Pure body merge for Asana + Jira task pages.
 *
 * `mergePageBodies(asanaBody, jiraBody)` produces a merged body with:
 * backend-scoped description/comment sections, a unioned attachments
 * list, a deduped chronological activity log, and a deduped see-also.
 */

const SECTION_RE = /^## (.+)$/;

/**
 * Parse a page body into named sections. Each section captures the trimmed
 * content between its header and the next `## ` header (or end of string).
 */
function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of body.split("\n")) {
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

function nonEmptyLines(content: string): string[] {
  return content.split("\n").filter((line) => line.trim().length > 0);
}

function pushSection(
  out: string[],
  header: string,
  content: string,
  options?: { alwaysEmit?: boolean }
): void {
  if (!content && !options?.alwaysEmit) return;
  out.push(`## ${header}`);
  out.push("");
  if (content) {
    out.push(content);
    out.push("");
  }
}

function pushList(
  out: string[],
  header: string,
  items: string[],
  options?: { alwaysEmit?: boolean }
): void {
  if (items.length === 0 && !options?.alwaysEmit) return;
  out.push(`## ${header}`);
  out.push("");
  for (const item of items) out.push(item);
  if (items.length > 0) out.push("");
}

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
  const asana = parseSections(asanaBody);
  const jira = parseSections(jiraBody);

  const out: string[] = [];

  pushSection(out, "Asana description", asana.get("Asana description") ?? "", { alwaysEmit: true });
  pushSection(out, "Jira description", jira.get("Jira description") ?? "", { alwaysEmit: true });
  pushSection(out, "Asana comments", asana.get("Asana comments") ?? "", { alwaysEmit: true });
  pushSection(out, "Jira comments", jira.get("Jira comments") ?? "", { alwaysEmit: true });

  const attachments = [
    ...new Set([
      ...nonEmptyLines(asana.get("Attachments") ?? ""),
      ...nonEmptyLines(jira.get("Attachments") ?? ""),
    ]),
  ];
  pushList(out, "Attachments", attachments);

  const activityLog = [
    ...new Set([
      ...nonEmptyLines(asana.get("Activity log") ?? ""),
      ...nonEmptyLines(jira.get("Activity log") ?? ""),
    ]),
  ].sort();
  pushList(out, "Activity log", activityLog, { alwaysEmit: true });

  const seeAlso = [
    ...new Set([
      ...nonEmptyLines(asana.get("See also") ?? ""),
      ...nonEmptyLines(jira.get("See also") ?? ""),
    ]),
  ];
  pushList(out, "See also", seeAlso, { alwaysEmit: true });

  return out.join("\n");
}
