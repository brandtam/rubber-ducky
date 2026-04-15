import { describe, it, expect } from "vitest";
import {
  CANONICAL_SECTIONS,
  collectPreservedExtras,
  mergePageBodies,
} from "../lib/body-merge.js";

describe("mergePageBodies", () => {
  it("places Asana sections before Jira sections", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "Asana desc content",
      "",
      "## Asana comments",
      "",
      "Asana comment 1",
      "",
      "## Activity log",
      "",
      "- 2026-01-01 — Ingested from asana",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "Jira desc content",
      "",
      "## Jira comments",
      "",
      "Jira comment 1",
      "",
      "## Activity log",
      "",
      "- 2026-01-02 — Ingested from jira",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    // Asana description comes before Jira description
    const asanaDescIdx = result.indexOf("## Asana description");
    const jiraDescIdx = result.indexOf("## Jira description");
    expect(asanaDescIdx).toBeLessThan(jiraDescIdx);

    // Asana comments come before Jira comments
    const asanaCommIdx = result.indexOf("## Asana comments");
    const jiraCommIdx = result.indexOf("## Jira comments");
    expect(asanaCommIdx).toBeLessThan(jiraCommIdx);
  });

  it("preserves content within each backend-scoped section", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "Asana feature details here",
      "",
      "## Asana comments",
      "",
      "**Alice** — 2026-01-01:",
      "Looks good!",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "Jira bug details here",
      "",
      "## Jira comments",
      "",
      "**Bob** — 2026-01-02:",
      "Fixed in v2",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("Asana feature details here");
    expect(result).toContain("Jira bug details here");
    expect(result).toContain("Looks good!");
    expect(result).toContain("Fixed in v2");
  });

  it("unions activity log entries chronologically", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "- 2026-01-01T10:00:00.000Z — Ingested from asana (ECOMM-123)",
      "- 2026-01-03T10:00:00.000Z — Status changed to in-progress",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "- 2026-01-02T10:00:00.000Z — Ingested from jira (WEB-297)",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    // All three entries present
    expect(result).toContain("Ingested from asana (ECOMM-123)");
    expect(result).toContain("Ingested from jira (WEB-297)");
    expect(result).toContain("Status changed to in-progress");

    // Chronological order
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    const logLines = lines.filter(
      (l) => l.includes("Ingested") || l.includes("Status changed")
    );
    expect(logLines).toHaveLength(3);
    expect(logLines[0]).toContain("2026-01-01");
    expect(logLines[1]).toContain("2026-01-02");
    expect(logLines[2]).toContain("2026-01-03");
  });

  it("unions attachments and deduplicates by filename", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Attachments",
      "",
      "![screenshot.png](../../raw/assets/asana-123/screenshot.png)",
      "[report.pdf](../../raw/assets/asana-123/report.pdf)",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Attachments",
      "",
      "![screenshot.png](../../raw/assets/jira-297/screenshot.png)",
      "[design.fig](../../raw/assets/jira-297/design.fig)",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    // All attachment lines preserved (both screenshot.png refs since paths differ)
    expect(result).toContain("report.pdf");
    expect(result).toContain("design.fig");
    // Both screenshot refs present (different paths)
    expect(result).toContain("asana-123/screenshot.png");
    expect(result).toContain("jira-297/screenshot.png");
  });

  it("unions see-also entries and deduplicates", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
      "- [[project-alpha]]",
      "- [[daily-standup]]",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
      "- [[project-alpha]]",
      "- [[sprint-review]]",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("[[project-alpha]]");
    expect(result).toContain("[[daily-standup]]");
    expect(result).toContain("[[sprint-review]]");

    // Deduped: project-alpha appears only once
    const matches = result.match(/\[\[project-alpha\]\]/g);
    expect(matches).toHaveLength(1);
  });

  it("deterministic output: same inputs always produce same output", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "Content A",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "Content B",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result1 = mergePageBodies(asanaBody, jiraBody);
    const result2 = mergePageBodies(asanaBody, jiraBody);

    expect(result1).toBe(result2);
  });

  it("handles empty sections gracefully", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("## Asana description");
    expect(result).toContain("## Jira description");
    expect(result).toContain("## Asana comments");
    expect(result).toContain("## Jira comments");
    expect(result).toContain("## Activity log");
    expect(result).toContain("## See also");
  });

  it("handles pages without Attachments section", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "Some content",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "Other content",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    // No Attachments section should be in output
    expect(result).not.toContain("## Attachments");
    expect(result).toContain("Some content");
    expect(result).toContain("Other content");
  });

  it("includes Attachments section when only one page has it", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Attachments",
      "",
      "[file.pdf](../../raw/assets/a/file.pdf)",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("## Attachments");
    expect(result).toContain("file.pdf");
  });
});

describe("mergePageBodies — zero data loss", () => {
  it("preserves non-canonical sections from Asana, renamed with provenance", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "desc",
      "",
      "## Decision notes",
      "",
      "We chose option B because of latency.",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("## Decision notes (from Asana)");
    expect(result).toContain("We chose option B because of latency.");
    expect(result).not.toMatch(/^## Decision notes$/m);
  });

  it("preserves non-canonical sections from Jira, renamed with provenance", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "",
      "## Repro steps",
      "",
      "1. Click the button",
      "2. Observe the crash",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("## Repro steps (from Jira)");
    expect(result).toContain("1. Click the button");
    expect(result).toContain("2. Observe the crash");
  });

  it("preserves both sides when the same non-canonical header appears on both", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Notes",
      "",
      "asana note",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "",
      "## Notes",
      "",
      "jira note",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);

    expect(result).toContain("## Notes (from Asana)");
    expect(result).toContain("asana note");
    expect(result).toContain("## Notes (from Jira)");
    expect(result).toContain("jira note");
  });

  it("emits Asana extras before Jira extras, each preserving intra-source order", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Alpha",
      "",
      "a1",
      "",
      "## Bravo",
      "",
      "a2",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "",
      "## Charlie",
      "",
      "j1",
      "",
      "## Delta",
      "",
      "j2",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);
    const alpha = result.indexOf("## Alpha (from Asana)");
    const bravo = result.indexOf("## Bravo (from Asana)");
    const charlie = result.indexOf("## Charlie (from Jira)");
    const delta = result.indexOf("## Delta (from Jira)");

    expect(alpha).toBeGreaterThan(-1);
    expect(bravo).toBeGreaterThan(alpha);
    expect(charlie).toBeGreaterThan(bravo);
    expect(delta).toBeGreaterThan(charlie);
  });

  it("emits all extras after the canonical sections", () => {
    const asanaBody = [
      "## Asana description",
      "",
      "## Decision notes",
      "",
      "note",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);
    const seeAlsoIdx = result.indexOf("## See also");
    const extraIdx = result.indexOf("## Decision notes (from Asana)");
    expect(seeAlsoIdx).toBeGreaterThan(-1);
    expect(extraIdx).toBeGreaterThan(seeAlsoIdx);
  });

  it("contract: every `##` header from either input appears in the output (as canonical or as a `(from …)` rename)", () => {
    const asanaBody = [
      "## Asana description",
      "desc",
      "## Custom one",
      "c1",
      "## Asana comments",
      "## Shared header",
      "asana-shared",
      "## Activity log",
      "## See also",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "## Custom two",
      "c2",
      "## Shared header",
      "jira-shared",
      "## Jira comments",
      "## Activity log",
      "## See also",
    ].join("\n");

    const result = mergePageBodies(asanaBody, jiraBody);
    const outputHeaders = new Set(
      result
        .split("\n")
        .filter((l) => l.startsWith("## "))
        .map((l) => l.slice(3))
    );

    const inputHeaders = (body: string, backend: "Asana" | "Jira") =>
      body
        .split("\n")
        .filter((l) => l.startsWith("## "))
        .map((l) => l.slice(3))
        .map((h) => (CANONICAL_SECTIONS.has(h) ? h : `${h} (from ${backend})`));

    for (const expected of inputHeaders(asanaBody, "Asana")) {
      expect(outputHeaders.has(expected)).toBe(true);
    }
    for (const expected of inputHeaders(jiraBody, "Jira")) {
      expect(outputHeaders.has(expected)).toBe(true);
    }
  });

  it("collectPreservedExtras reports non-canonical headers per backend in source order", () => {
    const asanaBody = [
      "## Asana description",
      "## Zeta",
      "## Alpha",
      "## Asana comments",
      "## Activity log",
      "## See also",
    ].join("\n");
    const jiraBody = [
      "## Jira description",
      "## Bravo",
      "## Jira comments",
      "## Activity log",
      "## See also",
    ].join("\n");

    expect(collectPreservedExtras(asanaBody, jiraBody)).toEqual({
      asana: ["Zeta", "Alpha"],
      jira: ["Bravo"],
    });
  });

  it("collectPreservedExtras returns empty arrays when both pages are purely canonical", () => {
    const body = [
      "## Asana description",
      "## Asana comments",
      "## Activity log",
      "## See also",
    ].join("\n");
    expect(collectPreservedExtras(body, body)).toEqual({ asana: [], jira: [] });
  });
});
