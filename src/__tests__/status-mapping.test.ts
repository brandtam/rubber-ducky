import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadMapping,
  translateStatus,
  parseStatusMapping,
  type StatusMapping,
} from "../lib/status-mapping.js";

const VALID_MAPPING = `---
type: config
---

# Status Mapping

Maps backend-native status values to the canonical wiki vocabulary.
See [[UBIQUITOUS_LANGUAGE]] for the full vocabulary reference.

## Jira → wiki

- \`Backlog\` → \`backlog\`
- \`To Do\` → \`to-do\`
- \`Open\` → \`to-do\`
- \`In Progress\` → \`in-progress\`
- \`In Review\` → \`in-review\`
- \`Review\` → \`in-review\`
- \`Waiting\` → \`pending\`
- \`Pending\` → \`pending\`
- \`On Hold\` → \`pending\`
- \`Blocked\` → \`blocked\`
- \`Done\` → \`done\`
- \`Closed\` → \`done\`
- \`Resolved\` → \`done\`
- \`Deferred\` → \`deferred\`
- \`Won't Do\` → \`deferred\`

## Asana → wiki

- \`Backlog\` → \`backlog\`
- \`To Do\` → \`to-do\`
- \`In Progress\` → \`in-progress\`
- \`In Review\` → \`in-review\`
- \`Waiting\` → \`pending\`
- \`Blocked\` → \`blocked\`
- \`Done\` → \`done\`
- \`Deferred\` → \`deferred\`

## Wiki vocabulary

| Term | Meaning |
|------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| in-review | Awaiting review |
| pending | Waiting on external input |
| blocked | Cannot proceed |
| done | Completed |
| deferred | Postponed indefinitely |

See [[UBIQUITOUS_LANGUAGE]] for the full vocabulary reference.
`;

describe("parseStatusMapping", () => {
  it("parses a valid mapping file", () => {
    const mapping = parseStatusMapping(VALID_MAPPING);

    expect(mapping.jira).toBeDefined();
    expect(mapping.asana).toBeDefined();
    expect(Object.keys(mapping.jira).length).toBe(15);
    expect(Object.keys(mapping.asana).length).toBe(8);
  });

  it("maps raw values to canonical values (jira)", () => {
    const mapping = parseStatusMapping(VALID_MAPPING);

    expect(mapping.jira["backlog"]).toBe("backlog");
    expect(mapping.jira["to do"]).toBe("to-do");
    expect(mapping.jira["in progress"]).toBe("in-progress");
    expect(mapping.jira["done"]).toBe("done");
    expect(mapping.jira["won't do"]).toBe("deferred");
  });

  it("maps raw values to canonical values (asana)", () => {
    const mapping = parseStatusMapping(VALID_MAPPING);

    expect(mapping.asana["backlog"]).toBe("backlog");
    expect(mapping.asana["to do"]).toBe("to-do");
    expect(mapping.asana["in progress"]).toBe("in-progress");
    expect(mapping.asana["done"]).toBe("done");
  });

  it("is permissive on extra whitespace", () => {
    const content = `---
type: config
---

## Jira → wiki

-   \`  In Progress  \`   →   \`  in-progress  \`
- \`Done\`→\`done\`
`;
    const mapping = parseStatusMapping(content);
    expect(mapping.jira["in progress"]).toBe("in-progress");
    expect(mapping.jira["done"]).toBe("done");
  });

  it("is permissive on section ordering", () => {
    const content = `---
type: config
---

## Asana → wiki

- \`Done\` → \`done\`

## Jira → wiki

- \`Closed\` → \`done\`
`;
    const mapping = parseStatusMapping(content);
    expect(mapping.asana["done"]).toBe("done");
    expect(mapping.jira["closed"]).toBe("done");
  });

  it("handles malformed file with no mapping sections gracefully", () => {
    const content = `---
type: config
---

# Just some notes, no actual mappings
`;
    const mapping = parseStatusMapping(content);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it("handles completely empty content", () => {
    const mapping = parseStatusMapping("");
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it("skips malformed bullet lines", () => {
    const content = `---
type: config
---

## Jira → wiki

- \`Done\` → \`done\`
- this line is not formatted correctly
- \`Open\` → \`to-do\`
- just some text
`;
    const mapping = parseStatusMapping(content);
    expect(Object.keys(mapping.jira)).toHaveLength(2);
    expect(mapping.jira["done"]).toBe("done");
    expect(mapping.jira["open"]).toBe("to-do");
  });

  it("normalizes raw values to lowercase", () => {
    const content = `---
type: config
---

## Jira → wiki

- \`IN PROGRESS\` → \`in-progress\`
- \`DONE\` → \`done\`
`;
    const mapping = parseStatusMapping(content);
    expect(mapping.jira["in progress"]).toBe("in-progress");
    expect(mapping.jira["done"]).toBe("done");
  });

  it("handles arrow variants (→ and ->)", () => {
    const content = `---
type: config
---

## Jira -> wiki

- \`Done\` -> \`done\`
- \`Open\` → \`to-do\`
`;
    const mapping = parseStatusMapping(content);
    expect(mapping.jira["done"]).toBe("done");
    expect(mapping.jira["open"]).toBe("to-do");
  });
});

describe("translateStatus", () => {
  let mapping: StatusMapping;

  beforeEach(() => {
    mapping = parseStatusMapping(VALID_MAPPING);
  });

  it("translates a raw backend value to canonical wiki value", () => {
    expect(translateStatus(mapping, "jira", "In Progress")).toBe("in-progress");
    expect(translateStatus(mapping, "jira", "Done")).toBe("done");
    expect(translateStatus(mapping, "asana", "Blocked")).toBe("blocked");
  });

  it("is case-insensitive on raw value lookup", () => {
    expect(translateStatus(mapping, "jira", "in progress")).toBe("in-progress");
    expect(translateStatus(mapping, "jira", "IN PROGRESS")).toBe("in-progress");
    expect(translateStatus(mapping, "jira", "In Progress")).toBe("in-progress");
  });

  it("returns null for unknown raw values", () => {
    expect(translateStatus(mapping, "jira", "nonexistent")).toBeNull();
    expect(translateStatus(mapping, "jira", "")).toBeNull();
  });

  it("returns null for unknown backends", () => {
    expect(translateStatus(mapping, "github", "open")).toBeNull();
    expect(translateStatus(mapping, "unknown", "Done")).toBeNull();
  });

  it("performs reverse lookup (canonical → raw values)", () => {
    const raw = translateStatus(mapping, "jira", "Done", "reverse");
    expect(raw).toBe("done");
  });

  it("returns first matching raw value for reverse lookup with multiple mappings", () => {
    // "to-do" has both "To Do" and "Open" mapping to it in Jira
    const result = translateStatus(mapping, "jira", "to-do", "reverse");
    // Should return the canonical value since reverse maps canonical → canonical
    expect(result).toBe("to-do");
  });

  it("returns null for unknown canonical value in reverse lookup", () => {
    expect(translateStatus(mapping, "jira", "nonexistent", "reverse")).toBeNull();
  });
});

describe("loadMapping", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-status-map-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and parses wiki/status-mapping.md from workspace root", () => {
    const wikiDir = path.join(tmpDir, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "status-mapping.md"), VALID_MAPPING, "utf-8");

    const mapping = loadMapping(tmpDir);
    expect(mapping.jira["in progress"]).toBe("in-progress");
    expect(mapping.asana["done"]).toBe("done");
  });

  it("returns empty mapping when file does not exist", () => {
    const mapping = loadMapping(tmpDir);
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});
