import { describe, it, expect } from "vitest";
import { formatOutput } from "../lib/output.js";

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
    // Should NOT be valid JSON
    expect(() => JSON.parse(result)).toThrow();
  });

  it("returns JSON for non-TTY environments", () => {
    const result = formatOutput(
      { success: true },
      { json: false, isTTY: false }
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
  });

  it("returns human-readable for TTY when json is false", () => {
    const result = formatOutput(
      { success: true },
      { json: false, isTTY: true, humanReadable: "All good" }
    );

    expect(result).toBe("All good");
  });
});
