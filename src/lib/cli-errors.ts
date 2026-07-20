import * as clack from "@clack/prompts";
import { formatOutput, type ExitCode, type OutputOptions } from "./output.js";

/**
 * Canonical command-level error handler. Every command's catch block (and
 * any pre-flight failure that ends in `process.exit`) routes through here so
 * the CLI has exactly one shape for "print an error and exit with a typed
 * code."
 *
 * - In JSON mode, emits a `{success: false, error}` envelope on stdout. The
 *   JSON `error` field is always the plain machine-readable message — never
 *   the chalk-styled human form, so consumers don't have to strip ANSI.
 * - In human mode, prefers `options.humanReadable` (caller-supplied
 *   chalk-styled / multi-line text) and falls back to the plain message.
 * - `code` is required: every callsite declares its failure class. The
 *   compiler rejects calls that forget to classify, which is the
 *   enforcement mechanism for the typed-exit-code contract documented in
 *   `src/lib/output.ts`.
 *
 * Accepts `unknown` so catch blocks can pass the caught error directly
 * without narrowing first. Strings are accepted for the common case of a
 * literal pre-flight message ("Not inside a workspace…").
 */
export function exitWithError(
  error: unknown,
  options: OutputOptions,
  code: ExitCode,
): never {
  const message =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : "Unknown error";

  if (options.json) {
    console.log(
      formatOutput(
        { success: false, error: message },
        // Force the JSON-side humanReadable to the plain message: the
        // caller's `options.humanReadable` may carry ANSI codes for the
        // human path, and we don't want those leaking into JSON output.
        { json: true, humanReadable: `Error: ${message}` },
      ),
    );
  } else {
    clack.log.error(options.humanReadable ?? message);
  }

  process.exit(code);
}
