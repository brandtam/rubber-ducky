/**
 * Rate-limited HTTP client that wraps fetch with Bottleneck scheduling
 * and p-retry for transient error recovery.
 *
 * Handles:
 * - 429 responses: reads Retry-After (seconds and HTTP-date), retries.
 * - 5xx GETs: retries with exponential backoff + full jitter.
 * - 5xx POSTs: does NOT retry (idempotency rule).
 * - Network errors on any method: retries.
 * - 4xx (non-429): fails fast, no retry.
 * - Retry budget ceiling: ~2 minutes total, max 5 attempts.
 */

import type Bottleneck from "bottleneck";
import pRetry, { AbortError } from "p-retry";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ */
/*  Error types                                                       */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class RateLimitError extends HttpError {
  constructor(message: string) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

/* ------------------------------------------------------------------ */
/*  Retry-After parsing                                               */
/* ------------------------------------------------------------------ */

/**
 * Parse the Retry-After header value.
 * Supports both seconds (integer) and HTTP-date formats.
 * Returns delay in milliseconds, minimum 0.
 */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;

  // Try parsing as integer seconds first
  const seconds = Number(value);
  if (!Number.isNaN(seconds) && Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  // Try parsing as HTTP-date
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return 0;
}

/* ------------------------------------------------------------------ */
/*  Request classification                                            */
/* ------------------------------------------------------------------ */

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function getMethod(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Client factory                                                    */
/* ------------------------------------------------------------------ */

export interface RateLimitedClientOptions {
  /** Bottleneck instance for rate limiting / scheduling. */
  limiter: Bottleneck;
  /** Injectable fetch function. Defaults to globalThis.fetch. */
  fetch?: FetchFn;
  /** Max retry attempts (default 5). */
  maxRetries?: number;
  /** Total retry budget in ms (default 120_000 = 2 minutes). */
  maxRetryTime?: number;
  /** Initial retry delay in ms (default 1000). */
  retryMinTimeout?: number;
  /** Max retry delay in ms (default 30_000). */
  retryMaxTimeout?: number;
  /** Env-var name to mention in rate-limit error messages. */
  envVarHint?: string;
  /** Injectable sleep for testing. Defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimitedClient {
  /**
   * Make an HTTP request through the rate limiter with retry logic.
   * Returns the raw Response on success.
   * Throws HttpError on non-retryable failures.
   * Throws RateLimitError when retry budget is exhausted due to 429s.
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
    maxRetryTime = 120_000,
    retryMinTimeout = 1_000,
    retryMaxTimeout = 30_000,
    envVarHint,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = options;

  return {
    async request(url: string, init?: RequestInit): Promise<Response> {
      const method = getMethod(init);

      // Track whether the last failure was a 429 for error classification
      let lastWas429 = false;

      const result = await limiter.schedule(() =>
        pRetry(
          async () => {
            let response: Response;
            try {
              response = await fetchFn(url, init);
            } catch (error) {
              // Network errors are retryable for all methods
              if (isNetworkError(error)) {
                lastWas429 = false;
                throw error; // p-retry retries TypeErrors that look like network errors
              }
              throw new AbortError(
                error instanceof Error ? error : new Error(String(error))
              );
            }

            // 2xx — success
            if (response.ok) {
              return response;
            }

            // 429 — rate limited, always retryable
            if (response.status === 429) {
              lastWas429 = true;
              const retryAfterMs = parseRetryAfter(
                response.headers.get("retry-after")
              );
              // If Retry-After specifies a wait, sleep for it.
              // The p-retry backoff will be in addition, but for 429 we
              // primarily want to honor the server hint.
              if (retryAfterMs > 0) {
                await sleep(retryAfterMs);
              }
              throw new HttpError(
                `HTTP 429: rate limited`,
                429
              );
            }

            // 5xx — retryable for GETs, not for POSTs
            if (response.status >= 500) {
              lastWas429 = false;
              if (method === "POST") {
                // POST idempotency rule: never retry 5xx on POST
                throw new AbortError(
                  new HttpError(
                    `HTTP ${response.status}: server error (POST not retried)`,
                    response.status
                  )
                );
              }
              throw new HttpError(
                `HTTP ${response.status}: server error`,
                response.status
              );
            }

            // 4xx (non-429) — fail fast
            lastWas429 = false;
            throw new AbortError(
              new HttpError(
                `HTTP ${response.status}`,
                response.status
              )
            );
          },
          {
            retries: maxRetries,
            minTimeout: retryMinTimeout,
            maxTimeout: retryMaxTimeout,
            randomize: true,
            maxRetryTime,
            // 429s should not consume the retry budget — they're server-directed waits
            shouldConsumeRetry: ({ error }) => {
              if (
                error instanceof HttpError &&
                error.statusCode === 429
              ) {
                return false;
              }
              return true;
            },
          }
        )
      ).catch((error: unknown) => {
        // Classify the final error
        if (lastWas429) {
          const hint = envVarHint
            ? ` Try again later, or set ${envVarHint} to adjust the rate limit.`
            : " Try again later.";
          throw new RateLimitError(
            `Rate limit exceeded for ${url}.${hint}`
          );
        }

        // If it's already our error type, re-throw as-is
        if (error instanceof HttpError) {
          throw error;
        }

        // AbortError wraps the original — unwrap if it's ours
        if (
          error instanceof AbortError &&
          error.originalError instanceof HttpError
        ) {
          throw error.originalError;
        }

        // Network or unknown errors
        throw error;
      });

      return result;
    },
  };
}
