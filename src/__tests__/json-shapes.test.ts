/**
 * Lib-level contract tests for every `*ToJson` shape function.
 *
 * Per-command response shapes live next to their source types in `lib/`.
 * These tests pin the on-the-wire contract — default `{count, sample}`
 * envelopes, full arrays under `--verbose`, and any per-command structural
 * invariants (e.g. wiki search's limit/truncate semantics) — without going
 * through the Commander/CLI layer. New shape functions should land alongside
 * their tests here.
 */

import { describe, it, expect } from "bun:test";
import { workspaceResultToJson, type WorkspaceResult } from "../lib/workspace.js";
import { searchResultToJson, type SearchResult, type SearchMatch } from "../lib/wiki.js";
import { DEFAULT_SAMPLE_SIZE } from "../lib/output.js";

describe("workspaceResultToJson", () => {
  const result: WorkspaceResult = {
    workspacePath: "/tmp/ws",
    filesCreated: Array.from({ length: 30 }, (_, i) => `file-${i}.md`),
    dirsCreated: Array.from({ length: 7 }, (_, i) => `dir-${i}`),
  };

  it("emits {count, sample} envelopes for both arrays by default", () => {
    const json = workspaceResultToJson(result, { verbose: false });
    expect(json.success).toBe(true);
    expect(json.workspacePath).toBe("/tmp/ws");
    expect(json.filesCreated).toMatchObject({ count: 30 });
    expect((json.filesCreated as { sample: string[] }).sample.length).toBe(DEFAULT_SAMPLE_SIZE);
    expect(json.dirsCreated).toMatchObject({ count: 7 });
  });

  it("emits the full arrays under --verbose", () => {
    const json = workspaceResultToJson(result, { verbose: true });
    expect(Array.isArray(json.filesCreated)).toBe(true);
    expect((json.filesCreated as string[]).length).toBe(30);
    expect(Array.isArray(json.dirsCreated)).toBe(true);
  });

  it("count + sample are always present together (even when array is empty)", () => {
    const empty: WorkspaceResult = { workspacePath: "/x", filesCreated: [], dirsCreated: [] };
    const json = workspaceResultToJson(empty, { verbose: false });
    expect(json.filesCreated).toEqual({ count: 0, sample: [] });
  });
});

describe("searchResultToJson", () => {
  function match(relativePath: string): SearchMatch {
    return {
      relativePath,
      type: "task",
      frontmatter: { title: relativePath },
      matchingLines: [{ lineNumber: 1, text: "hit" }],
    };
  }

  const result: SearchResult = {
    query: "auth",
    matches: Array.from({ length: 12 }, (_, i) => match(`task-${i}.md`)),
    totalMatches: 12,
  };

  it("caps matches at limit and reports truncated", () => {
    const json = searchResultToJson(result, { verbose: false, limit: 10 });
    expect(json.totalMatches).toBe(12);
    expect(json.returnedMatches).toBe(10);
    expect(json.truncated).toBe(true);
    expect(json.matches.length).toBe(10);
  });

  it("--verbose returns every match regardless of limit", () => {
    const json = searchResultToJson(result, { verbose: true, limit: 1 });
    expect(json.returnedMatches).toBe(12);
    expect(json.truncated).toBe(false);
    expect(json.matches.length).toBe(12);
  });

  it("truncated is false when limit ≥ totalMatches", () => {
    const json = searchResultToJson(result, { verbose: false, limit: 50 });
    expect(json.truncated).toBe(false);
    expect(json.returnedMatches).toBe(12);
  });

  it("limit 0 returns no matches but reports total accurately", () => {
    const json = searchResultToJson(result, { verbose: false, limit: 0 });
    expect(json.totalMatches).toBe(12);
    expect(json.returnedMatches).toBe(0);
    expect(json.truncated).toBe(true);
    expect(json.matches).toEqual([]);
  });
});
