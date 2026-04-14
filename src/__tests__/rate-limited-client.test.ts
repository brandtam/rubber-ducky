import { describe, it, expect, vi } from "vitest";
import Bottleneck from "bottleneck";
import {
  createRateLimitedClient,
  RateLimitError,
  HttpError,
  type FetchFn,
} from "../lib/http/rate-limited-client.js";

/**
 * Helper: build a mock fetch that returns responses from a queue.
 * Each call to the returned function shifts the next response off the queue.
 */
function mockFetchSequence(
  responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
    networkError?: boolean;
  }>
): { fetch: FetchFn; calls: Array<{ url: string; init?: RequestInit }> } {
  const queue = [...responses];
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchFn: FetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("mockFetchSequence: no more responses queued");

    if (next.networkError) {
      throw new TypeError("fetch failed");
    }

    const headers = new Headers(next.headers ?? {});
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as Response;
  };

  return { fetch: fetchFn, calls };
}

/** No-op sleep for tests — resolves instantly. */
const noSleep = async () => {};

/** Create a test limiter with no delays */
function testLimiter(): Bottleneck {
  return new Bottleneck({ minTime: 0, maxConcurrent: null });
}

/** Shared test options: zero delays, no-op sleep */
function testOpts(overrides: Record<string, unknown> = {}) {
  return {
    limiter: testLimiter(),
    retryMinTimeout: 0,
    retryMaxTimeout: 0,
    sleep: noSleep,
    ...overrides,
  };
}

describe("rate-limited-client", () => {
  describe("429 with Retry-After (seconds)", () => {
    it("retries after Retry-After seconds and succeeds", async () => {
      const sleepCalls: number[] = [];
      const { fetch, calls } = mockFetchSequence([
        { status: 429, headers: { "retry-after": "1" }, body: { error: "rate limited" } },
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        sleep: async (ms) => { sleepCalls.push(ms); },
      });

      const result = await client.request("https://api.example.com/test");
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ data: "ok" });
      expect(calls).toHaveLength(2);
      // Should have slept for ~1000ms (Retry-After: 1 → 1000ms)
      expect(sleepCalls).toEqual([1000]);
    });
  });

  describe("429 with HTTP-date Retry-After", () => {
    it("parses HTTP-date Retry-After and retries", async () => {
      const sleepCalls: number[] = [];
      // HTTP-date 2 seconds in the future
      const httpDate = new Date(Date.now() + 2000).toUTCString();
      const { fetch, calls } = mockFetchSequence([
        { status: 429, headers: { "retry-after": httpDate }, body: {} },
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        sleep: async (ms) => { sleepCalls.push(ms); },
      });

      const result = await client.request("https://api.example.com/test");
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(2);
      // Should have parsed the HTTP-date and computed a positive delay
      expect(sleepCalls).toHaveLength(1);
      expect(sleepCalls[0]).toBeGreaterThan(0);
    });
  });

  describe("5xx GET retries", () => {
    it("retries 5xx GET with backoff and eventually succeeds", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 503, body: { error: "unavailable" } },
        { status: 502, body: { error: "bad gateway" } },
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      const result = await client.request("https://api.example.com/test", {
        method: "GET",
      });
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(3);
    });
  });

  describe("5xx POST does NOT retry", () => {
    it("fails immediately on 5xx POST without retrying", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 500, body: { error: "internal server error" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      await expect(
        client.request("https://api.example.com/test", { method: "POST" })
      ).rejects.toThrow(HttpError);

      expect(calls).toHaveLength(1);
    });
  });

  describe("network error on POST retries", () => {
    it("retries POST on network error and succeeds", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 0, networkError: true },
        { status: 200, body: { data: "created" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      const result = await client.request("https://api.example.com/test", {
        method: "POST",
      });
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(2);
    });
  });

  describe("4xx non-429 fails immediately", () => {
    it("does not retry on 400", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 400, body: { error: "bad request" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      await expect(
        client.request("https://api.example.com/test")
      ).rejects.toThrow(HttpError);

      expect(calls).toHaveLength(1);
    });

    it("does not retry on 404", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 404, body: { error: "not found" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      await expect(
        client.request("https://api.example.com/test")
      ).rejects.toThrow(HttpError);

      expect(calls).toHaveLength(1);
    });
  });

  describe("retry budget exhaustion", () => {
    it("throws RateLimitError after maxRetryTime on repeated 429s", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        // Use a very short maxRetryTime so the budget runs out quickly
        maxRetryTime: 1,
        maxRetries: 5,
      });

      const err = await client
        .request("https://api.example.com/test")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).message).toMatch(/rate.limit/i);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("concurrent requests respect limiter", () => {
    it("limits concurrent requests based on maxConcurrent", async () => {
      let inFlight = 0;
      let maxInFlight = 0;

      const fetchFn: FetchFn = async (url: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Simulate some async work
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ data: "ok" }),
          text: async () => "ok",
        } as Response;
      };

      const limiter = new Bottleneck({
        minTime: 0,
        maxConcurrent: 2,
      });

      const client = createRateLimitedClient({
        limiter,
        fetch: fetchFn,
        sleep: noSleep,
      });

      // Fire 5 concurrent requests
      const promises = Array.from({ length: 5 }, (_, i) =>
        client.request(`https://api.example.com/test/${i}`)
      );

      await Promise.all(promises);
      expect(maxInFlight).toBeLessThanOrEqual(2);
    });
  });

  describe("throttle notification", () => {
    it("emits onThrottle when limiter pause exceeds 2 seconds", async () => {
      let nowCallCount = 0;
      const throttleCalls: Array<{ waitMs: number; queued: number }> = [];

      // now() returns 0 when queuedAt is recorded, then 3000 inside the
      // scheduled callback — simulating a 3-second limiter wait.
      const now = () => {
        nowCallCount++;
        return nowCallCount <= 1 ? 0 : 3000;
      };

      const { fetch } = mockFetchSequence([
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        now,
        onThrottle: (info) => throttleCalls.push(info),
      });

      await client.request("https://api.example.com/test");
      expect(throttleCalls).toHaveLength(1);
      expect(throttleCalls[0].waitMs).toBe(3000);
    });

    it("does NOT emit onThrottle when pause is under 2 seconds", async () => {
      let nowCallCount = 0;
      const throttleCalls: Array<{ waitMs: number; queued: number }> = [];

      // 1-second simulated pause — below the 2s threshold
      const now = () => {
        nowCallCount++;
        return nowCallCount <= 1 ? 0 : 1000;
      };

      const { fetch } = mockFetchSequence([
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        now,
        onThrottle: (info) => throttleCalls.push(info),
      });

      await client.request("https://api.example.com/test");
      expect(throttleCalls).toHaveLength(0);
    });

    it("emits onThrottle exactly once per throttled request", async () => {
      let nowCallCount = 0;
      const throttleCalls: Array<{ waitMs: number; queued: number }> = [];

      // First request: no pause. Second request: 3s pause.
      const now = () => {
        nowCallCount++;
        // Calls 1,2 are for request 1 (queued + scheduled → 0,0 → 0ms wait)
        // Calls 3,4 are for request 2 (queued + scheduled → 0,3000 → 3000ms wait)
        if (nowCallCount <= 2) return 0;
        return nowCallCount === 3 ? 0 : 3000;
      };

      const { fetch } = mockFetchSequence([
        { status: 200, body: { data: "first" } },
        { status: 200, body: { data: "second" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        now,
        onThrottle: (info) => throttleCalls.push(info),
      });

      await client.request("https://api.example.com/1");
      await client.request("https://api.example.com/2");
      expect(throttleCalls).toHaveLength(1);
      expect(throttleCalls[0].waitMs).toBe(3000);
    });
  });

  describe("per-attempt timeout", () => {
    it("aborts a hung fetch after perAttemptTimeoutMs and retries", async () => {
      let attempt = 0;
      let firstAttemptSignal: AbortSignal | undefined;

      const fetchFn: FetchFn = async (_url, init) => {
        attempt++;
        if (attempt === 1) {
          firstAttemptSignal = init?.signal ?? undefined;
          // Hung socket: never resolve; only reject when the per-attempt
          // controller fires, which is the behavior under test.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ data: "ok" }),
          text: async () => "ok",
        } as Response;
      };

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch: fetchFn,
        perAttemptTimeoutMs: 50,
      });

      const result = await client.request("https://api.example.com/hung");
      expect(result.status).toBe(200);
      expect(attempt).toBe(2);
      expect(firstAttemptSignal?.aborted).toBe(true);
    });

    it("a single hung attempt does not drain the whole retry budget", async () => {
      const startedAt = Date.now();
      let attempt = 0;

      const fetchFn: FetchFn = async (_url, init) => {
        attempt++;
        if (attempt === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ data: "ok" }),
          text: async () => "ok",
        } as Response;
      };

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch: fetchFn,
        perAttemptTimeoutMs: 50,
        maxRetryTime: 10_000,
      });

      await client.request("https://api.example.com/hung");
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeLessThan(1_000);
    });
  });

  describe("error classification", () => {
    it("HttpError includes status code", async () => {
      const { fetch } = mockFetchSequence([
        { status: 403, body: { error: "forbidden" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      try {
        await client.request("https://api.example.com/test");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(403);
      }
    });

    it("RateLimitError includes env-var hint", async () => {
      const { fetch } = mockFetchSequence([
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
        { status: 429, headers: { "retry-after": "0" }, body: {} },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
        maxRetryTime: 1,
        maxRetries: 5,
        envVarHint: "ASANA_RATE_LIMIT_RPM",
      });

      const err = await client
        .request("https://api.example.com/test")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).message).toContain("ASANA_RATE_LIMIT_RPM");
    });

    it("network error on GET retries and succeeds", async () => {
      const { fetch, calls } = mockFetchSequence([
        { status: 0, networkError: true },
        { status: 200, body: { data: "ok" } },
      ]);

      const client = createRateLimitedClient({
        ...testOpts(),
        fetch,
      });

      const result = await client.request("https://api.example.com/test", {
        method: "GET",
      });
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(2);
    });
  });
});
