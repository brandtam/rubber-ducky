import Bottleneck from "bottleneck";

/**
 * Per-backend Bottleneck limiter factory.
 *
 * Defaults pace at 80% of the documented per-minute ceiling (the 20% headroom
 * rule from PRD #74): cooperative co-tenancy with other API consumers on the
 * same token, and faster on average than running full-throttle-then-recover
 * because 429 round-trips cost more than the headroom saves.
 *
 * Jira Cloud adapts its reservoir live from X-RateLimit-* response headers
 * via rate-limit-hints.ts; Asana has no equivalent signal and relies on
 * defaults + env-var overrides.
 */

function parseEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

interface LimiterConfig {
  /** Requests per minute ceiling — default reservoir and refill amount. */
  defaultRpm: number;
  /** Default concurrency cap, well under the backend's documented limit. */
  defaultMaxConcurrent: number;
  /** Env var that overrides `defaultRpm`. */
  rpmEnvVar: string;
  /** Env var that overrides `defaultMaxConcurrent`. */
  maxConcurrentEnvVar: string;
}

const ASANA: LimiterConfig = {
  defaultRpm: 120, // 80% of Asana free tier's 150 req/min
  defaultMaxConcurrent: 5,
  rpmEnvVar: "ASANA_RATE_LIMIT_RPM",
  maxConcurrentEnvVar: "ASANA_MAX_CONCURRENT",
};

const JIRA: LimiterConfig = {
  defaultRpm: 60, // Static floor; Jira Cloud adapts upward via server hints
  defaultMaxConcurrent: 5,
  rpmEnvVar: "JIRA_RATE_LIMIT_RPM",
  maxConcurrentEnvVar: "JIRA_MAX_CONCURRENT",
};

function createLimiter(config: LimiterConfig): Bottleneck {
  const reservoir = parseEnvInt(config.rpmEnvVar) ?? config.defaultRpm;
  const maxConcurrent =
    parseEnvInt(config.maxConcurrentEnvVar) ?? config.defaultMaxConcurrent;

  return new Bottleneck({
    reservoir,
    reservoirRefreshAmount: reservoir,
    reservoirRefreshInterval: 60_000,
    maxConcurrent,
    // Smooths micro-bursts so a worker pool launching N tasks in the same
    // tick doesn't fire N requests in the same millisecond.
    minTime: 50,
  });
}

export function createAsanaLimiter(): Bottleneck {
  return createLimiter(ASANA);
}

export function createJiraLimiter(): Bottleneck {
  return createLimiter(JIRA);
}
