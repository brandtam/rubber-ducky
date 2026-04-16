import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createMergeSentinel,
  writeSentinel,
  advanceSentinel,
  readSentinel,
  deleteSentinel,
  deleteSentinelAbort,
  listSentinels,
  isStale,
  sentinelAgeMs,
  findOrphanSentinels,
  describeRemainingWork,
  transactionsDir,
  sentinelPath,
  SENTINEL_SCHEMA_VERSION,
  MERGE_STEPS,
  type MergeSentinel,
  type MergeStep,
} from "../lib/merge-sentinel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function setup(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-test-"));
  fs.mkdirSync(transactionsDir(tmpDir), { recursive: true });
  return tmpDir;
}

function makeSentinel(
  overrides?: Partial<Parameters<typeof createMergeSentinel>[0]>,
): MergeSentinel {
  return createMergeSentinel({
    asanaRef: "ECOMM-100",
    jiraRef: "WEB-50",
    merged: {
      filename: "ECOMM-100 (WEB-50).md",
      path: "/wiki/tasks/ECOMM-100 (WEB-50).md",
      stem: "ECOMM-100 (WEB-50)",
      oldAsanaStem: "ECOMM-100",
      oldJiraStem: "WEB-50",
    },
    ...overrides,
  });
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("createMergeSentinel", () => {
  it("creates a sentinel at step 'started' with schema version", () => {
    const s = makeSentinel();
    expect(s.schemaVersion).toBe(SENTINEL_SCHEMA_VERSION);
    expect(s.operation).toBe("merge");
    expect(s.step).toBe("started");
    expect(s.args.asanaRef).toBe("ECOMM-100");
    expect(s.args.jiraRef).toBe("WEB-50");
    expect(s.timestamp).toBeTruthy();
    expect(s.lastUpdated).toBe(s.timestamp);
  });

  it("includes resolutions when provided", () => {
    const s = makeSentinel({ resolutions: { status: "in-progress" } });
    expect(s.args.resolutions).toEqual({ status: "in-progress" });
  });
});

// ---------------------------------------------------------------------------
// Write / Read round-trip
// ---------------------------------------------------------------------------

describe("writeSentinel + readSentinel", () => {
  it("round-trips sentinel data through the filesystem", () => {
    const s = makeSentinel();
    const fp = writeSentinel(tmpDir, s);
    expect(fs.existsSync(fp)).toBe(true);

    const loaded = readSentinel(fp);
    expect(loaded.schemaVersion).toBe(SENTINEL_SCHEMA_VERSION);
    expect(loaded.args.asanaRef).toBe("ECOMM-100");
    expect(loaded.step).toBe("started");
  });

  it("creates the transactions directory if missing", () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-fresh-"));
    const s = makeSentinel();
    const fp = writeSentinel(freshDir, s);
    expect(fs.existsSync(fp)).toBe(true);
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it("rejects unknown schema version", () => {
    const s = makeSentinel();
    const fp = writeSentinel(tmpDir, s);

    // Tamper with schema version
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
    raw.schemaVersion = 999;
    fs.writeFileSync(fp, JSON.stringify(raw), "utf-8");

    expect(() => readSentinel(fp)).toThrow(/schema version 999/);
  });
});

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

describe("advanceSentinel", () => {
  it("advances step and updates lastUpdated", () => {
    const s = makeSentinel();
    writeSentinel(tmpDir, s);

    const advanced = advanceSentinel(tmpDir, s, "merged-file-written");
    expect(advanced.step).toBe("merged-file-written");
    expect(advanced.lastUpdated).not.toBe(s.lastUpdated);
  });

  it("accepts a patch to add backLinks", () => {
    const s = makeSentinel();
    writeSentinel(tmpDir, s);

    const backLinks = [
      { backend: "asana" as const, target: "123", posted: false },
      { backend: "jira" as const, target: "WEB-50", posted: false },
    ];
    const advanced = advanceSentinel(tmpDir, s, "logged", { backLinks });
    expect(advanced.backLinks).toEqual(backLinks);
  });

  it("persists the advanced state to disk", () => {
    const s = makeSentinel();
    const fp = writeSentinel(tmpDir, s);

    advanceSentinel(tmpDir, s, "orphans-deleted");
    const loaded = readSentinel(fp);
    expect(loaded.step).toBe("orphans-deleted");
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("deleteSentinel", () => {
  it("removes the sentinel file", () => {
    const s = makeSentinel();
    const fp = writeSentinel(tmpDir, s);
    expect(fs.existsSync(fp)).toBe(true);

    deleteSentinel(tmpDir, s);
    expect(fs.existsSync(fp)).toBe(false);
  });

  it("appends a 'complete' history entry", () => {
    const s = makeSentinel();
    writeSentinel(tmpDir, s);
    deleteSentinel(tmpDir, s);

    const historyFile = path.join(transactionsDir(tmpDir), "history.jsonl");
    const lines = fs
      .readFileSync(historyFile, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const completeEntry = lines.find((l) => l.event === "complete");
    expect(completeEntry).toBeDefined();
    expect(completeEntry.asanaRef).toBe("ECOMM-100");
  });

  it("is safe to call when file already deleted", () => {
    const s = makeSentinel();
    writeSentinel(tmpDir, s);
    deleteSentinel(tmpDir, s);
    expect(() => deleteSentinel(tmpDir, s)).not.toThrow();
  });
});

describe("deleteSentinelAbort", () => {
  it("removes the file and logs an abort event", () => {
    const s = makeSentinel();
    const fp = writeSentinel(tmpDir, s);

    deleteSentinelAbort(tmpDir, s);
    expect(fs.existsSync(fp)).toBe(false);

    const historyFile = path.join(transactionsDir(tmpDir), "history.jsonl");
    const lines = fs
      .readFileSync(historyFile, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    const abortEntry = lines.find((l) => l.event === "abort");
    expect(abortEntry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

describe("listSentinels", () => {
  it("returns empty when no sentinels exist", () => {
    expect(listSentinels(tmpDir)).toEqual([]);
  });

  it("returns paths for all sentinel files", () => {
    writeSentinel(tmpDir, makeSentinel());
    writeSentinel(
      tmpDir,
      makeSentinel({ asanaRef: "ECOMM-200", jiraRef: "WEB-99" }),
    );

    const files = listSentinels(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".json"))).toBe(true);
  });

  it("ignores non-sentinel files (like history.jsonl)", () => {
    writeSentinel(tmpDir, makeSentinel());
    const files = listSentinels(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("merge-");
  });
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

describe("isStale", () => {
  it("returns false for a recent sentinel", () => {
    const s = makeSentinel();
    expect(isStale(s)).toBe(false);
  });

  it("returns true for a sentinel older than 24 hours", () => {
    const s = makeSentinel();
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    s.lastUpdated = dayAgo;
    expect(isStale(s)).toBe(true);
  });

  it("respects a custom nowMs for testing", () => {
    const s = makeSentinel();
    const futureMs = Date.now() + 25 * 60 * 60 * 1000;
    expect(isStale(s, futureMs)).toBe(true);
  });
});

describe("sentinelAgeMs", () => {
  it("returns the age in milliseconds", () => {
    const s = makeSentinel();
    const age = sentinelAgeMs(s);
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(5000); // created just now
  });
});

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

describe("findOrphanSentinels", () => {
  it("returns empty when no sentinels exist", () => {
    expect(findOrphanSentinels(tmpDir)).toEqual([]);
  });

  it("detects an orphaned sentinel with resume/abort commands", () => {
    writeSentinel(tmpDir, makeSentinel());
    const orphans = findOrphanSentinels(tmpDir);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].resumeCommand).toContain("--resume");
    expect(orphans[0].abortCommand).toContain("--abort");
    expect(orphans[0].sentinel.args.asanaRef).toBe("ECOMM-100");
  });

  it("handles corrupted sentinel files gracefully", () => {
    const fp = sentinelPath(tmpDir, "ECOMM-BAD", "WEB-BAD");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "not json at all", "utf-8");

    const orphans = findOrphanSentinels(tmpDir);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].ageMs).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// describeRemainingWork
// ---------------------------------------------------------------------------

describe("describeRemainingWork", () => {
  it("lists all steps remaining from 'started'", () => {
    const s = makeSentinel();
    const work = describeRemainingWork(s);
    expect(work.length).toBeGreaterThanOrEqual(4);
    expect(work.some((w) => w.includes("Merged file"))).toBe(true);
    expect(work.some((w) => w.includes("wikilink"))).toBe(true);
  });

  it("lists only back-link work when at 'logged'", () => {
    const s = makeSentinel();
    s.step = "logged";
    s.backLinks = [
      { backend: "asana", target: "123", posted: false },
      { backend: "jira", target: "WEB-50", posted: true },
    ];
    const work = describeRemainingWork(s);
    expect(work).toHaveLength(1);
    expect(work[0]).toContain("asana");
    expect(work[0]).not.toContain("jira");
  });

  it("returns empty when at final step", () => {
    const s = makeSentinel();
    s.step = "back-links-posted";
    const work = describeRemainingWork(s);
    expect(work).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// History log
// ---------------------------------------------------------------------------

describe("history log", () => {
  it("records advance, complete, and abort events", () => {
    const s = makeSentinel();
    writeSentinel(tmpDir, s);
    advanceSentinel(tmpDir, s, "merged-file-written");
    deleteSentinel(tmpDir, { ...s, step: "merged-file-written" });

    const historyFile = path.join(transactionsDir(tmpDir), "history.jsonl");
    const lines = fs
      .readFileSync(historyFile, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines.filter((l) => l.event === "advance")).toHaveLength(2);
    expect(lines.filter((l) => l.event === "complete")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MergeStep ordering
// ---------------------------------------------------------------------------

describe("MERGE_STEPS", () => {
  it("has the expected phases in order", () => {
    expect(MERGE_STEPS).toEqual([
      "started",
      "merged-file-written",
      "orphans-deleted",
      "wikilinks-rewritten",
      "logged",
      "back-links-posted",
    ]);
  });
});
