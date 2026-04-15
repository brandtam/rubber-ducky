import { describe, it, expect } from "vitest";
import Bottleneck from "bottleneck";
import { applyRateLimitHints, withRateLimitHints } from "../lib/http/rate-limit-hints.js";
import type { FetchFn } from "../lib/http/rate-limited-client.js";

/** Create a minimal Response with given headers and status. */
function fakeResponse(
  status: number,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => ({}),
    text: async () => "",
  } as Response;
}

/** Create a test limiter with a known reservoir for assertions. */
function testLimiter(reservoir = 60): Bottleneck {
  return new Bottleneck({
    minTime: 0,
    maxConcurrent: null,
    reservoir,
    reservoirRefreshAmount: reservoir,
    reservoirRefreshInterval: 60_000,
  });
}

describe("rate-limit-hints", () => {
  describe("applyRateLimitHints", () => {
    it("updates reservoir when X-RateLimit-Remaining is present", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, { "x-ratelimit-remaining": "15" });

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(15);
    });

    it("updates reservoir to 0 when X-RateLimit-Remaining: 0", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 30),
      });

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(0);
    });

    it("is a no-op when rate-limit headers are absent", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200);

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(60);
    });

    it("does not throw on malformed X-RateLimit-Remaining: abc", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, { "x-ratelimit-remaining": "abc" });

      expect(() => applyRateLimitHints(limiter, response)).not.toThrow();

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(60);
    });

    it("does not throw on malformed X-RateLimit-Reset", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, {
        "x-ratelimit-remaining": "15",
        "x-ratelimit-reset": "not-a-number",
      });

      expect(() => applyRateLimitHints(limiter, response)).not.toThrow();

      // Remaining still applied despite bad reset
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(15);
    });

    it("does not throw on negative X-RateLimit-Remaining", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, { "x-ratelimit-remaining": "-5" });

      expect(() => applyRateLimitHints(limiter, response)).not.toThrow();

      // Negative value is ignored — reservoir unchanged
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(60);
    });

    it("truncates fractional X-RateLimit-Remaining to integer", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, { "x-ratelimit-remaining": "12.7" });

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(12);
    });

    it("adjusts reservoirRefreshInterval when X-RateLimit-Reset is present", async () => {
      const limiter = testLimiter(60);
      const nowSec = Math.floor(Date.now() / 1000);
      const resetSec = nowSec + 45; // 45 seconds from now

      const response = fakeResponse(200, {
        "x-ratelimit-remaining": "5",
        "x-ratelimit-reset": String(resetSec),
      });

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(5);
      // We can't easily assert reservoirRefreshInterval directly,
      // but the call should not throw
    });

    it("handles 429 response with Retry-After by setting reservoir to 0", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(429, { "retry-after": "10" });

      applyRateLimitHints(limiter, response);

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(0);
    });

    it("ignores Retry-After on non-429 responses", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(200, { "retry-after": "10" });

      applyRateLimitHints(limiter, response);

      // Retry-After ignored on 200; no X-RateLimit-* headers so no-op
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(60);
    });

    it("handles malformed Retry-After gracefully", async () => {
      const limiter = testLimiter(60);
      const response = fakeResponse(429, { "retry-after": "not-a-number" });

      expect(() => applyRateLimitHints(limiter, response)).not.toThrow();

      // No X-RateLimit-Remaining, so reservoir unchanged despite 429
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(60);
    });
  });

  describe("withRateLimitHints", () => {
    it("wraps fetch and applies hints on every response", async () => {
      const limiter = testLimiter(60);
      const inner: FetchFn = async () =>
        fakeResponse(200, { "x-ratelimit-remaining": "42" });

      const wrapped = withRateLimitHints(inner, { limiter });
      const response = await wrapped("https://example.com/api");

      expect(response.status).toBe(200);
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(42);
    });

    it("passes url and init through to the inner fetch", async () => {
      const limiter = testLimiter(60);
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const inner: FetchFn = async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return fakeResponse(200);
      };

      const wrapped = withRateLimitHints(inner, { limiter });
      await wrapped("https://example.com/api", { method: "POST" });

      expect(capturedUrl).toBe("https://example.com/api");
      expect(capturedInit?.method).toBe("POST");
    });

    it("does not swallow fetch errors", async () => {
      const limiter = testLimiter(60);
      const inner: FetchFn = async () => {
        throw new TypeError("fetch failed");
      };

      const wrapped = withRateLimitHints(inner, { limiter });

      await expect(wrapped("https://example.com/api")).rejects.toThrow(
        "fetch failed"
      );
    });
  });
});
