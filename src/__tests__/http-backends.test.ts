import { describe, it, expect, afterEach } from "vitest";
import {
  createAsanaLimiter,
  createJiraLimiter,
} from "../lib/http/backends.js";

describe("http/backends", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /**
   * Probe the effective maxConcurrent by saturating the limiter with jobs
   * that all block on a single latch, then sampling the peak RUNNING count
   * over a window long enough for Bottleneck's minTime spacing to promote
   * every eligible job. Releasing the latch drains the queue cleanly.
   */
  async function probeMaxConcurrent(
    limiter: ReturnType<typeof createAsanaLimiter>,
    attempts: number
  ): Promise<number> {
    let releaseLatch!: () => void;
    const latch = new Promise<void>((resolve) => {
      releaseLatch = resolve;
    });
    const jobs = Array.from({ length: attempts }, () =>
      limiter.schedule(() => latch)
    );

    // backends.ts uses minTime: 50ms. With 8 attempts, a cap of 5 is reached
    // at ~200ms; a cap of 2 at ~50ms. 400ms of polling covers both cases.
    let peak = 0;
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      const counts = limiter.counts();
      const live = counts.RUNNING + counts.EXECUTING;
      if (live > peak) peak = live;
      await new Promise((r) => setTimeout(r, 10));
    }

    releaseLatch();
    await Promise.all(jobs);
    return peak;
  }

  describe("createAsanaLimiter", () => {
    it("defaults reservoir to 120 (80% of Asana free tier 150 req/min)", async () => {
      delete process.env.ASANA_RATE_LIMIT_RPM;
      const limiter = createAsanaLimiter();
      expect(await limiter.currentReservoir()).toBe(120);
    });

    it("defaults maxConcurrent to 5", async () => {
      delete process.env.ASANA_MAX_CONCURRENT;
      const limiter = createAsanaLimiter();
      expect(await probeMaxConcurrent(limiter, 8)).toBe(5);
    });

    it("ASANA_RATE_LIMIT_RPM overrides the reservoir", async () => {
      process.env.ASANA_RATE_LIMIT_RPM = "200";
      const limiter = createAsanaLimiter();
      expect(await limiter.currentReservoir()).toBe(200);
    });

    it("ASANA_MAX_CONCURRENT overrides the concurrency cap", async () => {
      process.env.ASANA_MAX_CONCURRENT = "3";
      const limiter = createAsanaLimiter();
      expect(await probeMaxConcurrent(limiter, 8)).toBe(3);
    });

    it("non-numeric ASANA_RATE_LIMIT_RPM falls back to the default", async () => {
      process.env.ASANA_RATE_LIMIT_RPM = "not-a-number";
      const limiter = createAsanaLimiter();
      expect(await limiter.currentReservoir()).toBe(120);
    });

    it("zero ASANA_RATE_LIMIT_RPM falls back to the default", async () => {
      process.env.ASANA_RATE_LIMIT_RPM = "0";
      const limiter = createAsanaLimiter();
      expect(await limiter.currentReservoir()).toBe(120);
    });

    it("truncates fractional env values to an integer", async () => {
      process.env.ASANA_RATE_LIMIT_RPM = "150.7";
      const limiter = createAsanaLimiter();
      expect(await limiter.currentReservoir()).toBe(150);
    });
  });

  describe("createJiraLimiter", () => {
    it("defaults reservoir to 60 (static floor; Cloud adapts upward via hints)", async () => {
      delete process.env.JIRA_RATE_LIMIT_RPM;
      const limiter = createJiraLimiter();
      expect(await limiter.currentReservoir()).toBe(60);
    });

    it("defaults maxConcurrent to 5", async () => {
      delete process.env.JIRA_MAX_CONCURRENT;
      const limiter = createJiraLimiter();
      expect(await probeMaxConcurrent(limiter, 8)).toBe(5);
    });

    it("JIRA_RATE_LIMIT_RPM overrides the reservoir", async () => {
      process.env.JIRA_RATE_LIMIT_RPM = "100";
      const limiter = createJiraLimiter();
      expect(await limiter.currentReservoir()).toBe(100);
    });

    it("JIRA_MAX_CONCURRENT overrides the concurrency cap", async () => {
      process.env.JIRA_MAX_CONCURRENT = "2";
      const limiter = createJiraLimiter();
      expect(await probeMaxConcurrent(limiter, 8)).toBe(2);
    });

    it("non-numeric JIRA_RATE_LIMIT_RPM falls back to the default", async () => {
      process.env.JIRA_RATE_LIMIT_RPM = "abc";
      const limiter = createJiraLimiter();
      expect(await limiter.currentReservoir()).toBe(60);
    });
  });
});
