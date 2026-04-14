/**
 * Per-backend Bottleneck limiter factory.
 *
 * Exposes createAsanaLimiter() and createJiraLimiter() with sensible defaults
 * (80% of documented rate limits) and env-var overrides.
 *
 * Defaults (20% headroom rule):
 * - Asana: reservoir 120 (80% of 150 req/min), maxConcurrent 5, minTime 50ms
 * - Jira:  reservoir 60 (static floor), maxConcurrent 5, minTime 50ms
 */

import Bottleneck from "bottleneck";

/** Parse a positive integer from an env var, or return undefined. */
function parseEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n) || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/* ------------------------------------------------------------------ */
/*  Asana                                                             */
/* ------------------------------------------------------------------ */

const ASANA_DEFAULT_RESERVOIR = 120;     // 80% of 150 req/min free tier
const ASANA_DEFAULT_MAX_CONCURRENT = 5;
const ASANA_DEFAULT_MIN_TIME = 50;       // ms between requests

export function createAsanaLimiter(): Bottleneck {
  const reservoir = parseEnvInt("ASANA_RATE_LIMIT_RPM") ?? ASANA_DEFAULT_RESERVOIR;
  const maxConcurrent = parseEnvInt("ASANA_MAX_CONCURRENT") ?? ASANA_DEFAULT_MAX_CONCURRENT;

  return new Bottleneck({
    reservoir,
    reservoirRefreshAmount: reservoir,
    reservoirRefreshInterval: 60_000,  // refill every 60s
    maxConcurrent,
    minTime: ASANA_DEFAULT_MIN_TIME,
  });
}

/* ------------------------------------------------------------------ */
/*  Jira                                                              */
/* ------------------------------------------------------------------ */

const JIRA_DEFAULT_RESERVOIR = 60;
const JIRA_DEFAULT_MAX_CONCURRENT = 5;
const JIRA_DEFAULT_MIN_TIME = 50;

export function createJiraLimiter(): Bottleneck {
  const reservoir = parseEnvInt("JIRA_RATE_LIMIT_RPM") ?? JIRA_DEFAULT_RESERVOIR;
  const maxConcurrent = parseEnvInt("JIRA_MAX_CONCURRENT") ?? JIRA_DEFAULT_MAX_CONCURRENT;

  return new Bottleneck({
    reservoir,
    reservoirRefreshAmount: reservoir,
    reservoirRefreshInterval: 60_000,
    maxConcurrent,
    minTime: JIRA_DEFAULT_MIN_TIME,
  });
}
