/**
 * Date-flag validation for the command layer.
 *
 * `--date` (and friends) flow into vault file paths (`wiki/daily/<date>.md`)
 * and markdown content, so a malformed value is both a path-traversal vector
 * and silent corruption. Commands validate before calling into the lib layer
 * and reject with the typed `InvalidInput` exit code.
 */

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is shaped `YYYY-MM-DD` AND names a real calendar date
 * (rejects 2026-02-30, month 13, day 00, etc.).
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;

  // Round-trip through Date at UTC noon (no DST edge) — JS Date rolls
  // invalid days forward (Feb 30 → Mar 2), so a changed month/day means
  // the input wasn't a real date.
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Standard rejection message for an invalid date flag. Kept in one place so
 * every command reports the same shape.
 */
export function invalidDateMessage(flagName: string, value: string): string {
  return `Invalid ${flagName}: "${value}" — expected a real calendar date in YYYY-MM-DD format`;
}
