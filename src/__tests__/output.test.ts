import { describe, it, expect } from "bun:test";
import {
  ExitCode,
  formatOutput,
  resolveOutputOptions,
  summarizeArray,
  DEFAULT_SAMPLE_SIZE,
} from "../lib/output.js";

describe("ExitCode", () => {
  it("exposes the documented typed codes", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.Unclassified).toBe(1);
    expect(ExitCode.InvalidInput).toBe(2);
    expect(ExitCode.NotFound).toBe(3);
    expect(ExitCode.AuthError).toBe(4);
    expect(ExitCode.ExternalError).toBe(5);
    expect(ExitCode.StateConflict).toBe(7);
  });
});

describe("formatOutput", () => {
  it("returns JSON string when json flag is true", () => {
    const result = formatOutput({ success: true, data: "hello" }, { json: true });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe("hello");
  });

  it("returns human-readable string when json flag is false", () => {
    const result = formatOutput(
      { success: true, message: "Done!" },
      { json: false, humanReadable: "Done!" }
    );

    expect(result).toBe("Done!");
    expect(() => JSON.parse(result)).toThrow();
  });

  it("falls back to pretty JSON when human mode is requested with no humanReadable", () => {
    // formatOutput trusts options.json; it does not consult TTY state.
    // If the caller asks for human output but provides nothing, returning
    // pretty JSON is the documented fallback (better than an empty string).
    const result = formatOutput({ success: true }, { json: false });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
  });

  it("respects an explicit human decision regardless of pipe context", () => {
    // Regression: formatOutput previously second-guessed the resolved
    // decision by checking isTTY itself, which silently turned `--no-json`
    // on a pipe back into JSON. Render-time should trust the resolution.
    const result = formatOutput(
      { success: true },
      { json: false, humanReadable: "All good" }
    );
    expect(result).toBe("All good");
  });

});

describe("resolveOutputOptions", () => {
  it("auto-enables JSON when stdout is piped and neither flag is given", () => {
    const opts = resolveOutputOptions({}, undefined, /* isTTY */ false);
    expect(opts.json).toBe(true);
  });

  it("stays in human mode on a TTY when neither flag is given", () => {
    const opts = resolveOutputOptions({}, undefined, /* isTTY */ true);
    expect(opts.json).toBe(false);
  });

  it("explicit --json wins over TTY autodetect", () => {
    const opts = resolveOutputOptions({ json: true }, undefined, /* isTTY */ true);
    expect(opts.json).toBe(true);
  });

  it("explicit --no-json wins over non-TTY pipe", () => {
    // Commander sets json: false when --no-json is given.
    const opts = resolveOutputOptions({ json: false }, undefined, /* isTTY */ false);
    expect(opts.json).toBe(false);
  });

  it("propagates --verbose from globalOpts", () => {
    const opts = resolveOutputOptions({ verbose: true }, undefined, /* isTTY */ true);
    expect(opts.verbose).toBe(true);
  });

  it("verbose defaults to false when not set", () => {
    const opts = resolveOutputOptions({}, undefined, /* isTTY */ true);
    expect(opts.verbose).toBe(false);
  });
});

describe("summarizeArray", () => {
  it("returns {count, sample} envelope by default", () => {
    const items = ["a", "b", "c"];
    const result = summarizeArray(items, { verbose: false }) as { count: number; sample: string[] };

    expect(result.count).toBe(3);
    expect(result.sample).toEqual(["a", "b", "c"]);
  });

  it("count and sample are always present together", () => {
    // Empty input still returns the pair — consumers can rely on the envelope
    // shape without checking for absent keys.
    const result = summarizeArray([], { verbose: false }) as { count: number; sample: unknown[] };
    expect(result).toHaveProperty("count");
    expect(result).toHaveProperty("sample");
    expect(result.count).toBe(0);
    expect(result.sample).toEqual([]);
  });

  it("caps sample at DEFAULT_SAMPLE_SIZE entries", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const result = summarizeArray(items, { verbose: false }) as { count: number; sample: string[] };

    expect(result.count).toBe(30);
    expect(result.sample.length).toBe(DEFAULT_SAMPLE_SIZE);
    expect(result.sample[0]).toBe("item-0");
  });

  it("honors a caller-supplied sampleSize", () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const result = summarizeArray(items, { verbose: false, sampleSize: 2 }) as { sample: string[] };
    expect(result.sample.length).toBe(2);
  });

  it("returns the full array under --verbose", () => {
    const items = ["a", "b", "c"];
    const result = summarizeArray(items, { verbose: true });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(items);
  });
});
