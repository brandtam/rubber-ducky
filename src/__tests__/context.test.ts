import { describe, it, expect } from "bun:test";
import { parseSections, CONTEXT_KINDS, isContextKind } from "../commands/context.js";

/**
 * Section-parsing is the load-bearing primitive `/ingest-writing` and the
 * drafting skills rely on to pull context out of the four pages without
 * re-reading them freehand. The behavioral contract is small but
 * load-bearing: H2 headings split sections, frontmatter is ignored, empty
 * sections survive.
 */
describe("context.parseSections", () => {
  it("returns an empty record for an empty input", () => {
    expect(parseSections("")).toEqual({});
  });

  it("splits sections on H2 headings", () => {
    const raw = `# Title\n\n## Alpha\nline one\nline two\n\n## Beta\nline three\n`;
    expect(parseSections(raw)).toEqual({
      Alpha: "line one\nline two",
      Beta: "line three",
    });
  });

  it("ignores YAML frontmatter", () => {
    const raw = `---\nname: x\ndescription: y\n---\n\n## Alpha\nbody\n`;
    expect(parseSections(raw)).toEqual({ Alpha: "body" });
  });

  it("preserves empty sections as empty strings", () => {
    const raw = `## Alpha\n\n## Beta\nx\n`;
    expect(parseSections(raw)).toEqual({ Alpha: "", Beta: "x" });
  });

  it("does not treat H3+ headings as section boundaries", () => {
    const raw = `## Alpha\nbody\n### sub\nmore\n## Beta\nb\n`;
    expect(parseSections(raw)).toEqual({
      Alpha: "body\n### sub\nmore",
      Beta: "b",
    });
  });

  it("ignores text that appears before any H2", () => {
    const raw = `# Title\n\nprelude that should be skipped\n\n## A\nbody\n`;
    expect(parseSections(raw)).toEqual({ A: "body" });
  });

  it("respects fenced code blocks so ## inside a block doesn't split sections", () => {
    const raw = [
      "## Outer",
      "before fence",
      "```markdown",
      "## not a real heading",
      "still inside fence",
      "```",
      "after fence",
      "## Sibling",
      "sibling body",
      "",
    ].join("\n");
    const parsed = parseSections(raw);
    expect(Object.keys(parsed)).toEqual(["Outer", "Sibling"]);
    expect(parsed["Outer"]).toContain("## not a real heading");
    expect(parsed["Outer"]).toContain("still inside fence");
    expect(parsed["Outer"]).toContain("after fence");
    expect(parsed["Sibling"]).toBe("sibling body");
  });

  it("handles tilde-fenced blocks too", () => {
    const raw = [
      "## A",
      "~~~",
      "## still fenced",
      "~~~",
      "## B",
      "body",
      "",
    ].join("\n");
    const parsed = parseSections(raw);
    expect(Object.keys(parsed)).toEqual(["A", "B"]);
    expect(parsed["A"]).toContain("## still fenced");
  });
});

describe("context.isContextKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of CONTEXT_KINDS) {
      expect(isContextKind(kind)).toBe(true);
    }
  });

  it("rejects unknown kinds", () => {
    expect(isContextKind("voicemail")).toBe(false);
    expect(isContextKind("")).toBe(false);
    expect(isContextKind("VOICE")).toBe(false);
  });
});
