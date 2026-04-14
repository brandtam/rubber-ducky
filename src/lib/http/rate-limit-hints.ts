/**
 * Rate-limit hints adapter for Jira Cloud.
 *
 * Inspects X-RateLimit-Remaining / X-RateLimit-Reset response headers and
 * updates the bound Bottleneck limiter's reservoir so the client paces to
 * what the server reports.
 *
 * When headers are absent (self-hosted Jira / Data Center), this is a no-op —
 * the static reservoir floor from createJiraLimiter() continues to govern.
 *
 * Handles malformed header values gracefully (no throw).
 */

import type Bottleneck from "bottleneck";
import type { FetchFn } from "./rate-limited-client.js";

/* ------------------------------------------------------------------ */
/*  Core: inspect one response and update the limiter                 */
/* ------------------------------------------------------------------ */

/**
 * Inspect response headers and update the limiter's reservoir when
 * Jira Cloud rate-limit hints are present.
 *
 * Handles:
 * - X-RateLimit-Remaining → sets reservoir to the server's count.
 * - X-RateLimit-Reset → adjusts reservoirRefreshInterval to the
 *   time-until-reset so the bucket refills on the server's schedule.
 * - Retry-After on 429 → sets reservoir to 0 and adjusts refresh interval.
 * - Missing or malformed headers → no-op, no throw.
 */
export function applyRateLimitHints(
  limiter: Bottleneck,
  response: Response,
  options?: { now?: () => number }
): void {
  const now = options?.now ?? Date.now;

  // X-RateLimit-Remaining → update reservoir
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    const n = Number(remaining);
    if (Number.isFinite(n) && n >= 0) {
      limiter.updateSettings({ reservoir: Math.floor(n) });
    }
  }

  // X-RateLimit-Reset → adjust reservoir refresh interval
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const resetEpoch = Number(reset);
    if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
      const delayMs = Math.max(1000, resetEpoch * 1000 - now());
      limiter.updateSettings({ reservoirRefreshInterval: delayMs });
    }
  }

  // Retry-After on 429 → drain reservoir, schedule refresh
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        limiter.updateSettings({
          reservoir: 0,
          reservoirRefreshInterval: Math.ceil(seconds * 1000),
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience: wrap a fetch function with hint inspection           */
/* ------------------------------------------------------------------ */

export interface RateLimitHintsOptions {
  /** Bottleneck instance whose reservoir will be updated. */
  limiter: Bottleneck;
  /** Injectable clock for testing. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Wrap a fetch function so that every response is inspected for
 * Jira Cloud rate-limit headers and the limiter is updated accordingly.
 *
 * The returned FetchFn has the same signature and passes url/init
 * through unchanged. Fetch errors propagate without modification.
 */
export function withRateLimitHints(
  fetchFn: FetchFn,
  options: RateLimitHintsOptions
): FetchFn {
  const { limiter, now } = options;

  return async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await fetchFn(url, init);
    applyRateLimitHints(limiter, response, { now });
    return response;
  };
}
