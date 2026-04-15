import type Bottleneck from "bottleneck";
import pRetry, { AbortError } from "p-retry";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly body: string;
  constructor(message: string, statusCode: number, body = "") {
    super(body ? `${message}: ${body}` : message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export class RateLimitError extends HttpError {
  constructor(message: string) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

/**
 * Internal signal thrown from inside pRetry on 429 so the outer loop can
 * honor Retry-After with exact timing. Never escapes to callers — always
 * either consumed (retry) or converted to RateLimitError (exhaustion).
 */
class RetryAfterSignal extends Error {
  readonly waitMs: number;
  constructor(waitMs: number) {
    super("429");
    this.waitMs = waitMs;
  }
}

/** Parse Retry-After; supports integer seconds and HTTP-date. Returns ms. */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return 0;
}

/**
 * WHATWG fetch rejects with TypeError for network-level failures (DNS, TLS,
 * connection reset). Application-level TypeErrors (malformed Request args)
 * would resurface deterministically, so retrying them is harmless.
 * https://fetch.spec.whatwg.org/#fetch-method
 */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function getMethod(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function unwrap(error: unknown): unknown {
  return error instanceof AbortError && error.originalError
    ? error.originalError
    : error;
}

export interface ThrottleInfo {
  /** How long the request waited in the limiter queue (ms). */
  waitMs: number;
  /** Number of requests still queued behind this one. */
  queued: number;
}

export interface RateLimitedClientOptions {
  /** Bottleneck instance for rate limiting / scheduling. */
  limiter: Bottleneck;
  /** Injectable fetch. Defaults to globalThis.fetch. */
  fetch?: FetchFn;
  /** Max retries for 5xx/network errors (default 5). */
  maxRetries?: number;
  /** Max 429 retries; separate from maxRetries so server-directed waits
   *  don't cannibalize the transient-error budget (default 5). */
  maxRateLimitRetries?: number;
  /** Total retry budget across both error types in ms (default 120_000). */
  maxRetryTime?: number;
  /** Initial backoff for 5xx/network retries in ms (default 1_000). */
  retryMinTimeout?: number;
  /** Max backoff for 5xx/network retries in ms (default 30_000). */
  retryMaxTimeout?: number;
  /** Per-attempt fetch timeout in ms. Aborts the underlying request so a
   *  single hung socket can't drain the whole retry budget (default 30_000). */
  perAttemptTimeoutMs?: number;
  /** Env-var name surfaced in RateLimitError messages (e.g. ASANA_RATE_LIMIT_RPM). */
  envVarHint?: string;
  /** Injectable sleep for testing. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Called when queue wait exceeds minThrottlePauseMs. */
  onThrottle?: (info: ThrottleInfo) => void;
  /** Queue-wait threshold before onThrottle fires (default 2_000). */
  minThrottlePauseMs?: number;
  /** Injectable clock for deterministic tests. Default: Date.now. */
  now?: () => number;
}

export interface RateLimitedClient {
  /**
   * Make an HTTP request through the rate limiter with retry logic.
   * Returns the Response on success. Throws `HttpError` for non-retryable
   * failures; throws `RateLimitError` when the retry budget is exhausted
   * by 429s. Honors `init.signal` if provided.
   */
  request(url: string, init?: RequestInit): Promise<Response>;
}

export function createRateLimitedClient(
  options: RateLimitedClientOptions
): RateLimitedClient {
  const {
    limiter,
    fetch: fetchFn = globalThis.fetch,
    maxRetries = 5,
    maxRateLimitRetries = 5,
    maxRetryTime = 120_000,
    retryMinTimeout = 1_000,
    retryMaxTimeout = 30_000,
    perAttemptTimeoutMs = 30_000,
    envVarHint,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    onThrottle,
    minThrottlePauseMs = 2_000,
    now = Date.now,
  } = options;

  return {
    async request(url: string, init?: RequestInit): Promise<Response> {
      const method = getMethod(init);
      const queuedAt = now();
      const deadline = queuedAt + maxRetryTime;
      let rateLimitAttempts = 0;

      const exhausted = (): RateLimitError => {
        const hint = envVarHint
          ? ` Try again later, or set ${envVarHint} to adjust the rate limit.`
          : " Try again later.";
        return new RateLimitError(`Rate limit exceeded for ${url}.${hint}`);
      };

      return limiter.schedule(async () => {
        if (onThrottle) {
          const waitMs = now() - queuedAt;
          if (waitMs >= minThrottlePauseMs) {
            onThrottle({ waitMs, queued: limiter.counts().QUEUED });
          }
        }

        // Two-layer design:
        // • Inner pRetry handles 5xx GETs and network errors with exponential
        //   + jittered backoff (AWS "Exponential Backoff and Jitter" 2015).
        // • Outer loop handles 429 with exact Retry-After timing. Stacking
        //   p-retry's backoff on top of server-directed waits would overshoot
        //   the hint, so 429s abort pRetry and are replayed here.
        while (true) {
          try {
            return await pRetry(
              () =>
                attemptOnce({
                  url,
                  init,
                  method,
                  fetchFn,
                  perAttemptTimeoutMs,
                }),
              {
                retries: maxRetries,
                minTimeout: retryMinTimeout,
                maxTimeout: retryMaxTimeout,
                randomize: true,
                maxRetryTime,
              }
            );
          } catch (error) {
            const inner = unwrap(error);

            if (inner instanceof RetryAfterSignal) {
              rateLimitAttempts++;
              const remaining = deadline - now();
              if (
                rateLimitAttempts > maxRateLimitRetries ||
                remaining <= 0 ||
                inner.waitMs > remaining
              ) {
                throw exhausted();
              }
              if (inner.waitMs > 0) await sleep(inner.waitMs);
              continue;
            }

            throw inner instanceof Error ? inner : error;
          }
        }
      });
    },
  };
}

async function attemptOnce(params: {
  url: string;
  init: RequestInit | undefined;
  method: string;
  fetchFn: FetchFn;
  perAttemptTimeoutMs: number;
}): Promise<Response> {
  const { url, init, method, fetchFn, perAttemptTimeoutMs } = params;

  // Combine the caller's signal (if any) with a per-attempt timeout.
  // Either abort trigger cancels the in-flight fetch.
  const controller = new AbortController();
  const userSignal = init?.signal;
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener(
        "abort",
        () => controller.abort(userSignal.reason),
        { once: true }
      );
    }
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`per-attempt timeout after ${perAttemptTimeoutMs}ms`)
      ),
    perAttemptTimeoutMs
  );

  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    // A caller-initiated abort is terminal; timeout + network errors are
    // retryable. Discriminate by inspecting the shared controller.
    if (userSignal?.aborted) {
      throw new AbortError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
    if (isNetworkError(error) || isAbortError(error)) throw error;
    throw new AbortError(
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return response;

  if (response.status === 429) {
    const waitMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new AbortError(new RetryAfterSignal(waitMs));
  }

  const body = await safeReadBody(response);

  if (response.status >= 500) {
    if (method === "POST") {
      // POST idempotency rule: Asana/Jira don't support idempotency keys,
      // so retrying a 5xx on POST risks duplicate tasks/comments.
      throw new AbortError(
        new HttpError(
          `HTTP ${response.status}: server error (POST not retried)`,
          response.status,
          body
        )
      );
    }
    throw new HttpError(
      `HTTP ${response.status}: server error`,
      response.status,
      body
    );
  }

  throw new AbortError(
    new HttpError(`HTTP ${response.status}`, response.status, body)
  );
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
