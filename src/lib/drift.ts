/**
 * Drift — a PURE structural diff between a wiki page's frontmatter and an
 * already-normalized incoming payload.
 *
 * Hard boundary (see docs/adr/drift-pure-structural-diff.md): this module
 * never parses bridge docs, never maps statuses, and never touches the
 * network. The Agent fetches from the external service and normalizes field
 * names/values BEFORE calling drift; drift's only job is deterministic
 * comparison. Keeping this file free of any service-specific knowledge is
 * what stops the deleted v2 backend layer from quietly growing back.
 *
 * Comparison rule: only fields present in the incoming payload are compared.
 * Fields that exist in the wiki frontmatter but not in the payload are
 * ignored — the wiki is allowed to know more than the external service, and
 * the Agent controls the comparison surface by choosing which fields it
 * sends.
 */

/**
 * One per-field disagreement.
 *
 * - `kind: "mismatch"` — the field exists on both sides with unequal values;
 *   `wiki` carries the page's value.
 * - `kind: "missing"` — the field is absent from the wiki frontmatter
 *   (`undefined`); `wiki` is omitted so a genuine wiki value of `null` stays
 *   distinguishable from absence.
 */
export type DriftKind = "mismatch" | "missing";

export interface FieldDrift {
  field: string;
  kind: DriftKind;
  /** The wiki page's value. Omitted when `kind` is "missing". */
  wiki?: unknown;
  /** The normalized incoming value the Agent supplied. */
  incoming: unknown;
}

export interface DriftReport {
  /** Field names compared (= keys of the incoming payload), sorted. */
  compared: string[];
  /** Per-field disagreements, sorted by field name. Empty when in sync. */
  disagreements: FieldDrift[];
  /** True when `disagreements` is non-empty. */
  drift: boolean;
}

/**
 * Thrown when the incoming payload isn't a JSON object. Distinct class so
 * the CLI layer can map it to `ExitCode.InvalidInput` without string
 * matching.
 */
export class DriftPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftPayloadError";
  }
}

/**
 * Parse the raw incoming payload (stdin or `--incoming` file contents) into
 * a field record. The payload must be a single JSON object mapping field
 * names to normalized values; anything else — malformed JSON, arrays,
 * scalars, `null` — is a `DriftPayloadError`.
 */
export function parseIncomingPayload(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DriftPayloadError(`Incoming payload is not valid JSON: ${detail}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DriftPayloadError(
      "Incoming payload must be a JSON object mapping field names to normalized values",
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Compute the drift report. Pure and deterministic: same inputs, same
 * report, byte for byte — fields are compared in sorted key order and the
 * comparison is type-strict structural equality (no coercion: `"1"` and `1`
 * disagree; arrays and objects compare element-by-element / key-by-key).
 */
export function computeDrift(
  wiki: Record<string, unknown>,
  incoming: Record<string, unknown>,
): DriftReport {
  const compared = Object.keys(incoming).sort();
  const disagreements: FieldDrift[] = [];

  for (const field of compared) {
    const incomingValue = incoming[field];
    if (!(field in wiki)) {
      disagreements.push({ field, kind: "missing", incoming: incomingValue });
      continue;
    }
    const wikiValue = wiki[field];
    if (!deepEqual(wikiValue, incomingValue)) {
      disagreements.push({
        field,
        kind: "mismatch",
        wiki: wikiValue,
        incoming: incomingValue,
      });
    }
  }

  return { compared, disagreements, drift: disagreements.length > 0 };
}

/**
 * Type-strict structural equality over JSON-ish values (the intersection of
 * what YAML frontmatter and a JSON payload can carry): scalars by `===`,
 * arrays element-wise in order, plain objects key-by-key. No coercion —
 * a YAML `1` never equals a JSON `"1"`.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (
    a !== null && b !== null &&
    typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]),
    );
  }

  return false;
}
