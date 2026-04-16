import * as clack from "@clack/prompts";
import { formatOutput } from "../lib/output.js";
import {
  assertNoOrphanSentinel,
  OrphanSentinelError,
  EXIT_CODE_ORPHAN_TRANSACTION,
} from "../lib/merge-sentinel.js";

/**
 * Preflight guard: refuse to proceed if an orphan merge sentinel exists.
 * Formats the diagnostic for TTY or JSON mode and exits with code 2.
 *
 * Every vault-mutating command (merge, migrate, ingest) calls this at
 * the top of its action handler so the output shape is consistent and
 * new commands get the right guard by calling one function.
 */
export function guardOrphanSentinel(
  workspaceRoot: string,
  jsonMode: boolean,
): void {
  try {
    assertNoOrphanSentinel(workspaceRoot);
  } catch (error) {
    if (error instanceof OrphanSentinelError) {
      const { orphan } = error;
      const { sentinel } = orphan;
      if (jsonMode) {
        console.log(
          formatOutput(
            {
              success: false,
              error: "interrupted-transaction",
              operation: sentinel.operation,
              step: sentinel.step,
              asanaRef: sentinel.args.asanaRef,
              jiraRef: sentinel.args.jiraRef,
              resumeCommand: orphan.resumeCommand,
              abortCommand: orphan.abortCommand,
            },
            { json: true, humanReadable: error.message },
          ),
        );
      } else {
        clack.log.error(error.message);
        clack.log.info(`  Resume: ${orphan.resumeCommand}`);
        clack.log.info(`  Abort:  ${orphan.abortCommand}`);
      }
      process.exit(EXIT_CODE_ORPHAN_TRANSACTION);
    }
    throw error;
  }
}
