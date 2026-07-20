import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILENAME,
  SETTINGS_TEMPLATE,
  SettingsValidationError,
  disableFlag,
  enableFlag,
  loadSettings,
  readSettingPath,
  resolveConfirmPolicy,
  settingsPath,
  writeSettingPath,
} from "../lib/settings.js";

/**
 * Settings is a single-file boundary type — JSONC in, validated object out.
 * Tests anchor the contract the rest of the CLI depends on: defaults are
 * always populated, unknown paths fail closed, comments survive edits,
 * writes are atomic. Anything that drifts from those four properties
 * breaks downstream code in subtle ways, so each gets its own test.
 */
describe("settings", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-settings-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadSettings", () => {
    it("returns the default object when settings.json is absent", () => {
      const loaded = loadSettings(tmpDir);
      expect(loaded).toEqual(DEFAULT_SETTINGS);
    });

    it("reads the bundled template into a fully populated object", () => {
      fs.writeFileSync(settingsPath(tmpDir), SETTINGS_TEMPLATE, "utf-8");
      const loaded = loadSettings(tmpDir);
      expect(loaded.confirm).toEqual({});
      expect(loaded.ingest).toEqual({
        auto_on_wrap_up: false,
        auto_on_onboard: true,
        kinds: ["voice", "vocabulary"],
      });
    });

    it("merges partial files with defaults so callers see a complete shape", () => {
      fs.writeFileSync(
        settingsPath(tmpDir),
        `{ "ingest": { "auto_on_wrap_up": true } }`,
        "utf-8",
      );
      const loaded = loadSettings(tmpDir);
      expect(loaded.ingest.auto_on_wrap_up).toBe(true);
      // auto_on_onboard and kinds default in even though they weren't on disk
      expect(loaded.ingest.auto_on_onboard).toBe(true);
      expect(loaded.ingest.kinds).toEqual(["voice", "vocabulary"]);
    });

    it("parses JSONC comments without choking", () => {
      fs.writeFileSync(
        settingsPath(tmpDir),
        `// vault config\n{ "ingest": { "auto_on_wrap_up": true } /* inline comment */ }\n`,
        "utf-8",
      );
      expect(loadSettings(tmpDir).ingest.auto_on_wrap_up).toBe(true);
    });

    it("throws SettingsValidationError on malformed JSON", () => {
      fs.writeFileSync(settingsPath(tmpDir), `{ not-valid-json`, "utf-8");
      expect(() => loadSettings(tmpDir)).toThrow(SettingsValidationError);
    });

    it("throws when ingest.auto_on_wrap_up has the wrong type", () => {
      fs.writeFileSync(
        settingsPath(tmpDir),
        `{ "ingest": { "auto_on_wrap_up": "yes" } }`,
        "utf-8",
      );
      expect(() => loadSettings(tmpDir)).toThrow(SettingsValidationError);
    });

    it("throws when ingest.kinds contains an unknown enum member", () => {
      fs.writeFileSync(
        settingsPath(tmpDir),
        `{ "ingest": { "kinds": ["voice", "telepathy"] } }`,
        "utf-8",
      );
      expect(() => loadSettings(tmpDir)).toThrow(SettingsValidationError);
    });

    it("throws when confirm.<svc>.<verb> is not auto|preview", () => {
      fs.writeFileSync(
        settingsPath(tmpDir),
        `{ "confirm": { "jira": { "comment": "yolo" } } }`,
        "utf-8",
      );
      expect(() => loadSettings(tmpDir)).toThrow(SettingsValidationError);
    });
  });

  describe("readSettingPath", () => {
    it("resolves a top-level path", () => {
      const settings = loadSettings(tmpDir);
      expect(readSettingPath(settings, "ingest")).toEqual(settings.ingest);
    });

    it("resolves a nested path", () => {
      const settings = loadSettings(tmpDir);
      expect(readSettingPath(settings, "ingest.auto_on_wrap_up")).toBe(false);
    });

    it("returns undefined for an unset path", () => {
      const settings = loadSettings(tmpDir);
      expect(readSettingPath(settings, "confirm.jira.comment")).toBeUndefined();
    });
  });

  describe("writeSettingPath", () => {
    it("creates settings.json from the bundled template if absent", () => {
      const result = writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", true);
      expect(result.previous).toBe(false);
      expect(result.next).toBe(true);
      expect(fs.existsSync(settingsPath(tmpDir))).toBe(true);
    });

    it("preserves comments in the bundled template across edits", () => {
      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", true);
      const raw = fs.readFileSync(settingsPath(tmpDir), "utf-8");
      // Header comment from the template survives the edit
      expect(raw).toContain("// settings.json");
      // Inline comment next to confirm survives the edit
      expect(raw).toContain("Per-action confirmation policy");
    });

    it("flips back-and-forth without leaking stale state", () => {
      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", true);
      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", false);
      expect(loadSettings(tmpDir).ingest.auto_on_wrap_up).toBe(false);
    });

    it("coerces 'true' / 'false' strings on boolean leaves (CLI-friendly)", () => {
      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", "true");
      expect(loadSettings(tmpDir).ingest.auto_on_wrap_up).toBe(true);

      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", "false");
      expect(loadSettings(tmpDir).ingest.auto_on_wrap_up).toBe(false);
    });

    it("rejects an unknown top-level path", () => {
      expect(() => writeSettingPath(tmpDir, "telemetry.enabled", true)).toThrow(
        SettingsValidationError,
      );
    });

    it("rejects an unknown ingest leaf", () => {
      expect(() =>
        writeSettingPath(tmpDir, "ingest.bogus_flag", true),
      ).toThrow(SettingsValidationError);
    });

    it("requires confirm paths to be confirm.<transport>.<verb>", () => {
      expect(() =>
        writeSettingPath(tmpDir, "confirm.jira", "auto"),
      ).toThrow(SettingsValidationError);
      expect(() =>
        writeSettingPath(tmpDir, "confirm.jira.comment.extra", "auto"),
      ).toThrow(SettingsValidationError);
    });

    it("rejects an invalid confirm policy", () => {
      expect(() =>
        writeSettingPath(tmpDir, "confirm.jira.comment", "always"),
      ).toThrow(SettingsValidationError);
    });

    it("accepts a valid confirm policy and surfaces it via resolveConfirmPolicy", () => {
      writeSettingPath(tmpDir, "confirm.jira.comment", "auto");
      const settings = loadSettings(tmpDir);
      expect(resolveConfirmPolicy(settings, "jira.comment")).toBe("auto");
    });

    it("validates ingest.kinds entries when assigning the array", () => {
      expect(() =>
        writeSettingPath(tmpDir, "ingest.kinds", ["voice", "telepathy"]),
      ).toThrow(SettingsValidationError);
    });

    it("normalizes ingest.kinds writes when valid", () => {
      writeSettingPath(tmpDir, "ingest.kinds", ["voice"]);
      expect(loadSettings(tmpDir).ingest.kinds).toEqual(["voice"]);
    });

    it("writes atomically (no temp leftover on disk)", () => {
      writeSettingPath(tmpDir, "ingest.auto_on_wrap_up", true);
      const entries = fs.readdirSync(tmpDir);
      const leftoverTmp = entries.find((e) => e.includes(".tmp"));
      expect(leftoverTmp).toBeUndefined();
      expect(entries).toContain(SETTINGS_FILENAME);
    });
  });

  describe("enableFlag / disableFlag", () => {
    it("enableFlag sets a boolean leaf to true", () => {
      const result = enableFlag(tmpDir, "ingest.auto_on_wrap_up");
      expect(result.next).toBe(true);
      expect(loadSettings(tmpDir).ingest.auto_on_wrap_up).toBe(true);
    });

    it("disableFlag sets a boolean leaf to false", () => {
      const result = disableFlag(tmpDir, "ingest.auto_on_onboard");
      expect(result.next).toBe(false);
      expect(loadSettings(tmpDir).ingest.auto_on_onboard).toBe(false);
    });

    it("rejects enableFlag on a non-boolean leaf", () => {
      expect(() => enableFlag(tmpDir, "ingest.kinds")).toThrow(
        SettingsValidationError,
      );
    });
  });

  describe("resolveConfirmPolicy", () => {
    it("defaults to 'preview' for unknown actions (fail-closed)", () => {
      const settings = loadSettings(tmpDir);
      expect(resolveConfirmPolicy(settings, "anything.at.all")).toBe("preview");
    });

    it("returns the explicit policy when configured", () => {
      writeSettingPath(tmpDir, "confirm.jira.comment", "auto");
      const settings = loadSettings(tmpDir);
      expect(resolveConfirmPolicy(settings, "jira.comment")).toBe("auto");
    });

    it("only matches the exact descriptor (transport.verb), not partial paths", () => {
      writeSettingPath(tmpDir, "confirm.jira.comment", "auto");
      const settings = loadSettings(tmpDir);
      expect(resolveConfirmPolicy(settings, "jira.transition")).toBe("preview");
    });

    it("falls back to default when descriptor is empty", () => {
      expect(resolveConfirmPolicy(loadSettings(tmpDir), "")).toBe("preview");
    });
  });
});
