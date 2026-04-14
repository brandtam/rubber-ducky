import type Bottleneck from "bottleneck";
import type { FetchFn } from "./rate-limited-client.js";

/**
 * Jira Cloud emits X-RateLimit-Remaining / X-RateLimit-Reset / Retry-After
 * on every response. Reflecting those hints into the limiter's reservoir
 * keeps us paced to what the server is actually reporting — the same pattern
 * Octokit's throttling plugin uses on GitHub and Shopify's SDKs on Shopify.
 *
 * No-op when headers are absent (self-hosted Jira / Data Center) or malformed.
 */

interface HintState {
  reservoir?: number;
  reservoirRefreshAmount?: number;
  reservoirRefreshInterval?: number;
}

export interface RateLimitHintsOptions {
  limiter: Bottleneck;
  /** Injectable clock for testing. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Apply hints from a single response. Idempotent and safe to call per-response.
 * Headers read:
 * - `Retry-After` on 429 → drain reservoir and delay the next refill
 * - `X-RateLimit-Remaining` → set current reservoir and next refill amount
 * - `X-RateLimit-Reset` (epoch seconds) → schedule the refill to match
 */
export function applyRateLimitHints(
  limiter: Bottleneck,
  response: Response,
  options?: { now?: () => number }
): void {
  applyHintsInternal(limiter, response, null, options?.now ?? Date.now);
}

/**
 * Wrap a fetch function so every response inspects Jira Cloud hints and
 * updates the limiter. The returned fetch has the same signature; fetch
 * errors propagate unchanged. Skips redundant `updateSettings` calls when
 * values haven't changed to avoid Bottleneck's event fan-out on a hot path.
 */
export function withRateLimitHints(
  fetchFn: FetchFn,
  options: RateLimitHintsOptions
): FetchFn {
  const { limiter } = options;
  const now = options.now ?? Date.now;
  const state: HintState = {};

  return async (url: string, init?: RequestInit): Promise<Response> => {
    const response = await fetchFn(url, init);
    applyHintsInternal(limiter, response, state, now);
    return response;
  };
}

/**
 * Shared implementation. When `state` is non-null, redundant updates are
 * skipped; when null (one-shot callers), every hint is written through.
 */
function applyHintsInternal(
  limiter: Bottleneck,
  response: Response,
  state: HintState | null,
  now: () => number
): void {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        const interval = Math.ceil(seconds * 1000);
        if (
          !state ||
          state.reservoir !== 0 ||
          state.reservoirRefreshAmount !== 0 ||
          state.reservoirRefreshInterval !== interval
        ) {
          limiter.updateSettings({
            reservoir: 0,
            reservoirRefreshAmount: 0,
            reservoirRefreshInterval: interval,
          });
          if (state) {
            state.reservoir = 0;
            state.reservoirRefreshAmount = 0;
            state.reservoirRefreshInterval = interval;
          }
        }
        return;
      }
    }
  }

  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    const n = Number(remaining);
    if (Number.isFinite(n) && n >= 0) {
      const floor = Math.floor(n);
      if (!state || state.reservoir !== floor) {
        // Update both so the next refill matches the server's view rather
        // than restoring the original static default.
        limiter.updateSettings({
          reservoir: floor,
          reservoirRefreshAmount: floor,
        });
        if (state) {
          state.reservoir = floor;
          state.reservoirRefreshAmount = floor;
        }
      }
    }
  }

  const reset = response.headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const resetEpoch = Number(reset);
    if (Number.isFinite(resetEpoch) && resetEpoch > 0) {
      const delayMs = Math.max(1000, resetEpoch * 1000 - now());
      if (!state || state.reservoirRefreshInterval !== delayMs) {
        limiter.updateSettings({ reservoirRefreshInterval: delayMs });
        if (state) state.reservoirRefreshInterval = delayMs;
      }
    }
  }
}
