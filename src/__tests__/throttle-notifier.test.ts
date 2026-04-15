import { describe, it, expect } from "vitest";
import Bottleneck from "bottleneck";
import { createThrottleNotifier } from "../lib/http/throttle-notifier.js";
import {
  createRateLimitedClient,
  RateLimitError,
  type FetchFn,
} from "../lib/http/rate-limited-client.js";

describe("throttle-notifier", () => {
  it("formats the standard throttle message with backend name, wait, and queue depth", () => {
    const messages: string[] = [];
    const notifier = createThrottleNotifier("Asana", {
      log: (msg) => messages.push(msg),
    });

    notifier({ waitMs: 3000, queued: 42 });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      "\u23F8 Asana rate limit \u2014 waiting 3s (42 requests queued)"
    );
  });

  it("rounds up fractional seconds", () => {
    const messages: string[] = [];
    const notifier = createThrottleNotifier("Jira", {
      log: (msg) => messages.push(msg),
    });

    notifier({ waitMs: 2100, queued: 5 });

    expect(messages[0]).toBe(
      "\u23F8 Jira rate limit \u2014 waiting 3s (5 requests queued)"
    );
  });

  it("shows 0 queued when queue is empty", () => {
    const messages: string[] = [];
    const notifier = createThrottleNotifier("Asana", {
      log: (msg) => messages.push(msg),
    });

    notifier({ waitMs: 5000, queued: 0 });

    expect(messages[0]).toBe(
      "\u23F8 Asana rate limit \u2014 waiting 5s (0 requests queued)"
    );
  });
});

describe("throttle-notifier integration with rate-limited-client", () => {
  const noSleep = async () => {};

  it("3-second simulated Bottleneck pause emits the throttle message once", async () => {
    const messages: string[] = [];
    let nowCallCount = 0;
    const now = () => {
      nowCallCount++;
      return nowCallCount <= 1 ? 0 : 3000;
    };

    const notifier = createThrottleNotifier("Asana", {
      log: (msg) => messages.push(msg),
    });

    const fetchFn: FetchFn = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: "ok" }),
        text: async () => "ok",
      }) as Response;

    const client = createRateLimitedClient({
      limiter: new Bottleneck({ minTime: 0, maxConcurrent: null }),
      fetch: fetchFn,
      sleep: noSleep,
      now,
      onThrottle: notifier,
    });

    await client.request("https://api.example.com/test");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Asana rate limit");
    expect(messages[0]).toContain("waiting 3s");
  });

  it("1-second simulated pause emits no message", async () => {
    const messages: string[] = [];
    let nowCallCount = 0;
    const now = () => {
      nowCallCount++;
      return nowCallCount <= 1 ? 0 : 1000;
    };

    const notifier = createThrottleNotifier("Asana", {
      log: (msg) => messages.push(msg),
    });

    const fetchFn: FetchFn = async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: "ok" }),
        text: async () => "ok",
      }) as Response;

    const client = createRateLimitedClient({
      limiter: new Bottleneck({ minTime: 0, maxConcurrent: null }),
      fetch: fetchFn,
      sleep: noSleep,
      now,
      onThrottle: notifier,
    });

    await client.request("https://api.example.com/test");

    expect(messages).toHaveLength(0);
  });

  it("retry-exhausted error from Asana client propagates with env-var hint", async () => {
    const fetchFn: FetchFn = async () =>
      ({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0" }),
        json: async () => ({}),
        text: async () => "{}",
      }) as Response;

    const client = createRateLimitedClient({
      limiter: new Bottleneck({ minTime: 0, maxConcurrent: null }),
      fetch: fetchFn,
      sleep: noSleep,
      maxRetryTime: 1,
      maxRetries: 5,
      retryMinTimeout: 0,
      retryMaxTimeout: 0,
      envVarHint: "ASANA_RATE_LIMIT_RPM",
    });

    const err = await client
      .request("https://api.example.com/test")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).message).toContain("Rate limit exceeded");
    expect((err as RateLimitError).message).toContain("ASANA_RATE_LIMIT_RPM");
  });
});
