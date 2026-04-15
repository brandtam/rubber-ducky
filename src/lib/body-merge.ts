/**
 * Zero data loss: every `##`-level section from either input survives the
 * merge. Canonical sections (description/comments/attachments/activity log/
 * see also) are merged in a fixed output order; any other section is
 * preserved verbatim, renamed to `<Header> (from Asana|Jira)` so the
 * reader can always trace content back to its source.
 *
 * Public API: `mergePageBodies(asanaBody, jiraBody)`.
 */

const SECTION_RE = /^## (.+)$/;

/**
 * Canonical section headers. These have fixed output positions and
 * backend-scoped or union semantics. Any `##` header NOT in this set is
 * treated as an extra and preserved verbatim with a `(from <backend>)` suffix.
 *
 * Update this set — and only this set — when adding a new canonical section;
 * the contract test in body-merge.test.ts will flag any header that slips
 * through unannounced.
 */
export const CANONICAL_SECTIONS: ReadonlySet<string> = new Set([
  "Asana description",
  "Jira description",
  "Asana comments",
  "Jira comments",
  "Attachments",
  "Activity log",
  "See also",
]);

interface ParsedSections {
  /** Insertion-ordered map: section header → trimmed content. */
  sections: Map<string, string>;
}

/**
 * Parse a page body into an insertion-ordered map of `header → content`.
 * Content is the trimmed text between the header and the next `## ` header
 * (or end of string).
 */
function parseSections(body: string): ParsedSections {
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
  return { sections };
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
 * Emit non-canonical sections from one backend, renamed with a
 * `(from <backend>)` suffix for provenance. Preserves intra-source order.
 */
function pushExtras(
  out: string[],
  sections: Map<string, string>,
  backendLabel: "Asana" | "Jira"
): string[] {
  const emitted: string[] = [];
  for (const [header, content] of sections) {
    if (CANONICAL_SECTIONS.has(header)) continue;
    const renamed = `${header} (from ${backendLabel})`;
    pushSection(out, renamed, content, { alwaysEmit: true });
    emitted.push(renamed);
  }
  return emitted;
}

/**
 * Merge two page bodies into one canonical merged body with **zero data loss**.
 *
 * Output section order:
 * 1. ## Asana description            (always emitted)
 * 2. ## Jira description             (always emitted)
 * 3. ## Asana comments               (always emitted)
 * 4. ## Jira comments                (always emitted)
 * 5. ## Attachments                  (union, deduped; omitted when empty)
 * 6. ## Activity log                 (union, chronological; always emitted)
 * 7. ## See also                     (union, deduped; always emitted)
 * 8. Asana extras — each non-canonical section from the Asana page in its
 *    original order, renamed `<Header> (from Asana)`.
 * 9. Jira extras — same for the Jira page, renamed `<Header> (from Jira)`.
 *
 * Extras are never merged with each other even when headers collide — both
 * are preserved so the reader can decide. The returned body's `## Activity
 * log` section is left untouched here; callers (e.g. `runMerge`) are
 * expected to append a breadcrumb naming the preserved extras.
 */
export function mergePageBodies(asanaBody: string, jiraBody: string): string {
  const { sections: asana } = parseSections(asanaBody);
  const { sections: jira } = parseSections(jiraBody);

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

  pushExtras(out, asana, "Asana");
  pushExtras(out, jira, "Jira");

  return out.join("\n");
}

/**
 * Collect the renamed headers that `mergePageBodies` would emit for
 * non-canonical sections. Exposed so callers (e.g. `runMerge`) can append
 * a breadcrumb to the activity log naming the preserved extras — this is
 * the provenance trail that lets readers trace merged content back to its
 * source without parsing the output body themselves.
 */
export function collectPreservedExtras(
  asanaBody: string,
  jiraBody: string
): { asana: string[]; jira: string[] } {
  const { sections: asana } = parseSections(asanaBody);
  const { sections: jira } = parseSections(jiraBody);

  const asanaExtras: string[] = [];
  for (const header of asana.keys()) {
    if (!CANONICAL_SECTIONS.has(header)) asanaExtras.push(header);
  }
  const jiraExtras: string[] = [];
  for (const header of jira.keys()) {
    if (!CANONICAL_SECTIONS.has(header)) jiraExtras.push(header);
  }
  return { asana: asanaExtras, jira: jiraExtras };
}
