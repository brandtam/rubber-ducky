/**
 * Factory for the throttle notification callback used by the rate-limited
 * client's `onThrottle` option.
 *
 * Formats the standard message:
 *   ⏸ <backend> rate limit — waiting <N>s (<M> requests queued)
 */

import type { ThrottleInfo } from "./rate-limited-client.js";

export interface ThrottleNotifierOptions {
  /** Output sink. Defaults to process.stderr.write. */
  log?: (msg: string) => void;
}

/**
 * Create a callback suitable for `RateLimitedClientOptions.onThrottle`.
 *
 * @param backendName  Human-readable backend label (e.g. "Asana", "Jira").
 * @param options      Optional overrides (injectable log sink for testing).
 */
export function createThrottleNotifier(
  backendName: string,
  options?: ThrottleNotifierOptions,
): (info: ThrottleInfo) => void {
  const log =
    options?.log ?? ((msg: string) => process.stderr.write(msg + "\n"));

  return (info: ThrottleInfo) => {
    const waitSeconds = Math.ceil(info.waitMs / 1000);
    log(
      `\u23F8 ${backendName} rate limit \u2014 waiting ${waitSeconds}s (${info.queued} requests queued)`,
    );
  };
}
