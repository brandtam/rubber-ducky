import { describe, it, expect } from "vitest";
import { mergePageBodies } from "../lib/body-merge.js";

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
