# ADR: Drift is a pure structural diff

- Status: accepted
- Date: 2026-07-20
- Relates to: issue #5 (part of #1)

## Context

v2 had a backend layer that fetched from external services, mapped their
statuses and field names, and reconciled them with wiki pages. That layer was
deliberately deleted in the v3 founding transplant: normalization knowledge
(which service, which bridge doc, which status maps to which) belongs to the
Agent, not to the CLI.

v3 still needs a way to answer "does this wiki page's frontmatter agree with
what the external service says right now?" — deterministically, so the Agent
can trust the verdict instead of eyeballing two blobs.

## Decision

`rubber-ducky drift <page>` is a **pure structural diff** and nothing more.

The Agent fetches from the external service and normalizes field names and
values per the bridge doc **before** calling drift. Drift receives the
already-normalized payload as a JSON object (stdin by default, or
`--incoming <file>`) and emits a typed per-field disagreement report.

Hard boundary — drift never:

- parses bridge docs,
- maps statuses or any other service vocabulary,
- touches the network,
- reads any file beyond the target page (and, when `--incoming` is used, the
  payload file the caller explicitly names).

The Agent owns normalization; drift owns deterministic comparison. The
implementation is deliberately small (`src/lib/drift.ts`) so there is no
seam for service-specific logic to accrete. If a change to drift needs to
know what "Linear" or "in review" means, that change belongs in the Agent's
bridge doc, not here — this ADR exists so the deleted v2 backend layer
cannot quietly grow back.

## Comparison rule

Only fields **present in the incoming payload** are compared. Wiki fields
absent from the payload are ignored — the wiki is allowed to know more than
the external service, and the Agent controls the comparison surface by
choosing which fields it sends. An empty payload compares nothing and is
vacuously in sync.

Equality is type-strict and structural: scalars by identity (no coercion —
YAML `1` never equals JSON `"1"`), arrays element-wise in order, objects
key-by-key. Reports are deterministic: fields are compared and reported in
sorted field-name order, so identical inputs yield byte-identical reports
regardless of payload key order.

## Report shape and exit codes

JSON envelope (auto-JSON on pipe, per the repo's output conventions):

```json
{
  "success": false,
  "drift": true,
  "page": "wiki/task.md",
  "compared": ["priority", "status"],
  "disagreements": [
    { "field": "priority", "kind": "missing", "incoming": "high" },
    { "field": "status", "kind": "mismatch", "wiki": "in-progress", "incoming": "done" }
  ]
}
```

- `kind: "mismatch"` — both sides have the field, values differ; `wiki`
  carries the page's value.
- `kind: "missing"` — the field is absent from the wiki frontmatter; `wiki`
  is omitted so a genuine wiki `null` stays distinguishable from absence.
- `disagreements` is bounded by the payload's field count, so it is emitted
  in full (no `{count, sample}` envelope).

Exit codes reuse the typed `ExitCode` enum (`src/lib/output.ts`):

| Code | Meaning |
| ---- | ------- |
| 0 (Success) | No drift; empty `disagreements`. |
| 7 (StateConflict) | Drift found — the wiki state conflicts with the incoming state. Mirrors `frontmatter validate`'s pattern: structured `success: false` payload on stdout, typed non-zero exit. |
| 2 (InvalidInput) | Payload is malformed JSON or not a JSON object. |
| 3 (NotFound) | Page missing, page has no frontmatter, or `--incoming` file missing. |

## Consequences

- The Agent must normalize before calling; drift gives no leniency (a raw
  service status that the wiki spells differently reports as drift — that is
  the Agent's bug to fix in its normalization step, not drift's to absorb).
- Scripts can key on exit code 7 like `diff`'s non-zero: "something to
  reconcile," distinct from an error.
- Any future pressure to make drift "smarter" (fuzzy matching, per-service
  aliases) is a signal the normalization boundary is being violated and
  should be pushed back to the Agent/bridge-doc layer.
