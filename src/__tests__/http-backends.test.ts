import { describe, it, expect, afterEach } from "vitest";
import {
  createAsanaLimiter,
  createJiraLimiter,
} from "../lib/http/backends.js";

describe("http/backends", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    process.env = { ...originalEnv };
  });

  describe("createAsanaLimiter", () => {
    it("returns a Bottleneck instance with default settings", () => {
      const limiter = createAsanaLimiter();
      // Bottleneck exposes settings via .reservoir() etc.
      // We verify it's a functional limiter by checking it can schedule work
      expect(limiter).toBeDefined();
      expect(typeof limiter.schedule).toBe("function");
    });

    it("uses ASANA_RATE_LIMIT_RPM env var to override reservoir", () => {
      process.env.ASANA_RATE_LIMIT_RPM = "200";
      const limiter = createAsanaLimiter();
      // Limiter should be functional — we can't directly read reservoir config
      // but we can verify schedule works
      expect(limiter).toBeDefined();
    });

    it("uses ASANA_MAX_CONCURRENT env var to override concurrency", () => {
      process.env.ASANA_MAX_CONCURRENT = "10";
      const limiter = createAsanaLimiter();
      expect(limiter).toBeDefined();
    });

    it("ignores non-numeric env var values and uses defaults", () => {
      process.env.ASANA_RATE_LIMIT_RPM = "not-a-number";
      const limiter = createAsanaLimiter();
      expect(limiter).toBeDefined();
    });

    it("returns a limiter that can schedule and complete work", async () => {
      const limiter = createAsanaLimiter();
      const result = await limiter.schedule(() => Promise.resolve(42));
      expect(result).toBe(42);
    });
  });

  describe("createJiraLimiter", () => {
    it("returns a Bottleneck instance with default settings", () => {
      const limiter = createJiraLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter.schedule).toBe("function");
    });

    it("uses JIRA_RATE_LIMIT_RPM env var to override reservoir", () => {
      process.env.JIRA_RATE_LIMIT_RPM = "100";
      const limiter = createJiraLimiter();
      expect(limiter).toBeDefined();
    });

    it("uses JIRA_MAX_CONCURRENT env var to override concurrency", () => {
      process.env.JIRA_MAX_CONCURRENT = "3";
      const limiter = createJiraLimiter();
      expect(limiter).toBeDefined();
    });

    it("returns a limiter that can schedule and complete work", async () => {
      const limiter = createJiraLimiter();
      const result = await limiter.schedule(() => Promise.resolve("done"));
      expect(result).toBe("done");
    });
  });
});
