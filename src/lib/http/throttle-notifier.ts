import type { ThrottleInfo } from "./rate-limited-client.js";

export interface ThrottleNotifierOptions {
  /** Output sink. Defaults to process.stderr.write. */
  log?: (msg: string) => void;
}

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
