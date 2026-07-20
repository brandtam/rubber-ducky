import { describe, it, expect } from "bun:test";
import {
  computeDrift,
  parseIncomingPayload,
  DriftPayloadError,
} from "../lib/drift.js";

/**
 * Drift is a pure structural diff — the entire behavioral contract is
 * "same inputs, same typed report." These tests pin the exact report for
 * no-drift, partial, and full disagreement fixtures, plus the comparison
 * rule (only incoming fields are compared) and payload validation.
 */
describe("computeDrift", () => {
  const wiki = {
    title: "Fix login flow",
    type: "task",
    status: "in-progress",
    priority: "high",
    tags: ["auth", "frontend"],
    created: "2026-01-15",
  };

  it("no drift: empty disagreements, exact report", () => {
    const incoming = {
      status: "in-progress",
      priority: "high",
      tags: ["auth", "frontend"],
    };
    expect(computeDrift(wiki, incoming)).toEqual({
      compared: ["priority", "status", "tags"],
      disagreements: [],
      drift: false,
    });
  });

  it("partial disagreement: exact typed report, sorted by field", () => {
    const incoming = {
      status: "done",
      priority: "high",
      assignee: "alice",
    };
    expect(computeDrift(wiki, incoming)).toEqual({
      compared: ["assignee", "priority", "status"],
      disagreements: [
        { field: "assignee", kind: "missing", incoming: "alice" },
        { field: "status", kind: "mismatch", wiki: "in-progress", incoming: "done" },
      ],
      drift: true,
    });
  });

  it("full disagreement: every incoming field reported", () => {
    const incoming = {
      status: "done",
      priority: "low",
      tags: ["backend"],
    };
    expect(computeDrift(wiki, incoming)).toEqual({
      compared: ["priority", "status", "tags"],
      disagreements: [
        { field: "priority", kind: "mismatch", wiki: "high", incoming: "low" },
        { field: "status", kind: "mismatch", wiki: "in-progress", incoming: "done" },
        { field: "tags", kind: "mismatch", wiki: ["auth", "frontend"], incoming: ["backend"] },
      ],
      drift: true,
    });
  });

  it("ignores wiki fields absent from the incoming payload", () => {
    const report = computeDrift(wiki, { status: "in-progress" });
    expect(report.compared).toEqual(["status"]);
    expect(report.drift).toBe(false);
  });

  it("an empty payload compares nothing and reports no drift", () => {
    expect(computeDrift(wiki, {})).toEqual({
      compared: [],
      disagreements: [],
      drift: false,
    });
  });

  it("distinguishes a wiki null from a missing field", () => {
    const report = computeDrift({ due: null }, { due: "2026-02-01", owner: "bob" });
    expect(report.disagreements).toEqual([
      { field: "due", kind: "mismatch", wiki: null, incoming: "2026-02-01" },
      { field: "owner", kind: "missing", incoming: "bob" },
    ]);
  });

  it("null-to-null agrees; a wiki null never counts as missing", () => {
    const report = computeDrift({ due: null }, { due: null });
    expect(report).toEqual({ compared: ["due"], disagreements: [], drift: false });
  });

  it("is type-strict: string '1' disagrees with number 1", () => {
    const report = computeDrift({ points: "1" }, { points: 1 });
    expect(report.disagreements).toEqual([
      { field: "points", kind: "mismatch", wiki: "1", incoming: 1 },
    ]);
  });

  it("compares arrays element-wise and order-sensitively", () => {
    expect(computeDrift({ tags: ["a", "b"] }, { tags: ["a", "b"] }).drift).toBe(false);
    expect(computeDrift({ tags: ["a", "b"] }, { tags: ["b", "a"] }).drift).toBe(true);
    expect(computeDrift({ tags: ["a"] }, { tags: ["a", "b"] }).drift).toBe(true);
  });

  it("compares nested objects structurally", () => {
    const wikiSide = { meta: { source: "linear", id: 42 } };
    expect(computeDrift(wikiSide, { meta: { source: "linear", id: 42 } }).drift).toBe(false);
    expect(computeDrift(wikiSide, { meta: { source: "linear", id: 43 } }).drift).toBe(true);
    expect(computeDrift(wikiSide, { meta: { source: "linear" } }).drift).toBe(true);
  });

  it("is deterministic regardless of payload key order", () => {
    const a = computeDrift(wiki, { status: "done", priority: "low" });
    const b = computeDrift(wiki, { priority: "low", status: "done" });
    expect(a).toEqual(b);
    expect(a.disagreements.map((d) => d.field)).toEqual(["priority", "status"]);
  });
});

describe("parseIncomingPayload", () => {
  it("parses a JSON object", () => {
    expect(parseIncomingPayload('{"status": "done"}')).toEqual({ status: "done" });
  });

  it("rejects malformed JSON with a DriftPayloadError", () => {
    expect(() => parseIncomingPayload("{not json")).toThrow(DriftPayloadError);
    expect(() => parseIncomingPayload("")).toThrow(DriftPayloadError);
  });

  it("rejects non-object payloads (array, scalar, null)", () => {
    expect(() => parseIncomingPayload("[1, 2]")).toThrow(DriftPayloadError);
    expect(() => parseIncomingPayload('"done"')).toThrow(DriftPayloadError);
    expect(() => parseIncomingPayload("null")).toThrow(DriftPayloadError);
    expect(() => parseIncomingPayload("42")).toThrow(DriftPayloadError);
  });

  it("accepts an empty object", () => {
    expect(parseIncomingPayload("{}")).toEqual({});
  });
});
