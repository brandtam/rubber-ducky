import { describe, it, expect } from "vitest";
import {
  applyNamingScheme,
  previewNames,
  inferLegacyScheme,
  type NamingScheme,
  type NamingInput,
} from "../lib/naming.js";

describe("applyNamingScheme", () => {
  const baseInput: NamingInput = {
    gid: "1234567890",
    title: "Fix the login bug",
    identifier: "ECOMM-4643",
  };

  describe("source: identifier", () => {
    it("lowercases and slugifies identifier with case: lower", () => {
      const scheme: NamingScheme = { source: "identifier", case: "lower" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("ecomm-4643");
    });

    it("preserves case and slugifies identifier with case: preserve", () => {
      const scheme: NamingScheme = { source: "identifier", case: "preserve" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("ECOMM-4643");
    });

    it("falls back to GID when identifier is null", () => {
      const input: NamingInput = { ...baseInput, identifier: null };
      const scheme: NamingScheme = { source: "identifier", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("falls back to GID when identifier is empty string", () => {
      const input: NamingInput = { ...baseInput, identifier: "" };
      const scheme: NamingScheme = { source: "identifier", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("falls back to GID when identifier slugifies to empty (all emoji)", () => {
      const input: NamingInput = { ...baseInput, identifier: "🎉🎊🎈" };
      const scheme: NamingScheme = { source: "identifier", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("falls back to GID when identifier slugifies to empty (all emoji, preserve case)", () => {
      const input: NamingInput = { ...baseInput, identifier: "🎉🎊🎈" };
      const scheme: NamingScheme = { source: "identifier", case: "preserve" };
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("handles identifier with special characters", () => {
      const input: NamingInput = { ...baseInput, identifier: "TIK / 4647 (draft)" };
      const scheme: NamingScheme = { source: "identifier", case: "preserve" };
      expect(applyNamingScheme(input, scheme)).toBe("TIK-4647-draft");
    });

    it("handles identifier with special characters lowercased", () => {
      const input: NamingInput = { ...baseInput, identifier: "TIK / 4647 (draft)" };
      const scheme: NamingScheme = { source: "identifier", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("tik-4647-draft");
    });
  });

  describe("source: title", () => {
    it("slugifies title to lowercase regardless of case setting", () => {
      const scheme: NamingScheme = { source: "title", case: "lower" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("fix-the-login-bug");
    });

    it("slugifies title to lowercase even with case: preserve", () => {
      const scheme: NamingScheme = { source: "title", case: "preserve" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("fix-the-login-bug");
    });

    it("falls back to GID when title slugifies to empty", () => {
      const input: NamingInput = { ...baseInput, title: "🎉🎊" };
      const scheme: NamingScheme = { source: "title", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("handles non-Latin title (CJK characters)", () => {
      const input: NamingInput = { ...baseInput, title: "修复登录错误" };
      const scheme: NamingScheme = { source: "title", case: "lower" };
      // CJK chars are stripped by slugify → falls back to GID
      expect(applyNamingScheme(input, scheme)).toBe("1234567890");
    });

    it("handles mixed Latin and non-Latin title", () => {
      const input: NamingInput = { ...baseInput, title: "Fix the バグ bug" };
      const scheme: NamingScheme = { source: "title", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("fix-the-bug");
    });

    it("handles title with leading/trailing special characters", () => {
      const input: NamingInput = { ...baseInput, title: "---Hello World---" };
      const scheme: NamingScheme = { source: "title", case: "lower" };
      expect(applyNamingScheme(input, scheme)).toBe("hello-world");
    });
  });

  describe("source: gid", () => {
    it("returns raw GID regardless of case setting", () => {
      const scheme: NamingScheme = { source: "gid", case: "lower" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("1234567890");
    });

    it("returns raw GID with case: preserve", () => {
      const scheme: NamingScheme = { source: "gid", case: "preserve" };
      expect(applyNamingScheme(baseInput, scheme)).toBe("1234567890");
    });
  });

  describe("empty value fallbacks", () => {
    it("never returns empty string — always falls back to GID", () => {
      const emptyInputs: NamingInput[] = [
        { gid: "999", title: "", identifier: null },
        { gid: "999", title: "🎉", identifier: "" },
        { gid: "999", title: "   ", identifier: null },
      ];
      const schemes: NamingScheme[] = [
        { source: "identifier", case: "lower" },
        { source: "identifier", case: "preserve" },
        { source: "title", case: "lower" },
      ];

      for (const input of emptyInputs) {
        for (const scheme of schemes) {
          const result = applyNamingScheme(input, scheme);
          expect(result).toBeTruthy();
          expect(result).toBe("999");
        }
      }
    });
  });
});

describe("previewNames", () => {
  it("returns filenames for a list of tasks", () => {
    const tasks: NamingInput[] = [
      { gid: "1", title: "Task One", identifier: "TIK-100" },
      { gid: "2", title: "Task Two", identifier: "TIK-200" },
      { gid: "3", title: "Task Three", identifier: "TIK-300" },
    ];
    const scheme: NamingScheme = { source: "identifier", case: "preserve" };
    expect(previewNames(tasks, scheme)).toEqual([
      "TIK-100",
      "TIK-200",
      "TIK-300",
    ]);
  });

  it("handles mixed empty values in preview", () => {
    const tasks: NamingInput[] = [
      { gid: "1", title: "Task One", identifier: "TIK-100" },
      { gid: "2", title: "Task Two", identifier: null },
      { gid: "3", title: "Task Three", identifier: "" },
    ];
    const scheme: NamingScheme = { source: "identifier", case: "lower" };
    expect(previewNames(tasks, scheme)).toEqual([
      "tik-100",
      "2",
      "3",
    ]);
  });

  it("returns empty array for empty input", () => {
    const scheme: NamingScheme = { source: "title", case: "lower" };
    expect(previewNames([], scheme)).toEqual([]);
  });
});

describe("inferLegacyScheme", () => {
  it("returns null when naming_source is already set", () => {
    expect(
      inferLegacyScheme({ naming_source: "identifier", identifier_field: "TIK" })
    ).toBeNull();
  });

  it("infers identifier + lower when identifier_field is set but no naming_source", () => {
    expect(
      inferLegacyScheme({ identifier_field: "ECOMM" })
    ).toEqual({ source: "identifier", case: "lower" });
  });

  it("returns null when neither naming_source nor identifier_field is set", () => {
    expect(inferLegacyScheme({})).toBeNull();
  });

  it("returns null for empty config", () => {
    expect(inferLegacyScheme({})).toBeNull();
  });
});
