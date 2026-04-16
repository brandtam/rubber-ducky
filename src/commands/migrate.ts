import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { runMigrate } from "../lib/migrate.js";
import {
  assertNoOrphanSentinel,
  OrphanSentinelError,
  EXIT_CODE_ORPHAN_TRANSACTION,
} from "../lib/merge-sentinel.js";

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description(
      "One-time vault upgrade: uppercase filenames, backend-scoped headers, wikilink rewrite"
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        const msg =
          "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.";
        if (jsonMode) {
          console.log(
            formatOutput(
              { success: false, error: msg },
              { json: true, humanReadable: msg }
            )
          );
        } else {
          clack.log.error(msg);
        }
        process.exit(1);
      }

      try {
        assertNoOrphanSentinel(workspaceRoot);
      } catch (error) {
        if (error instanceof OrphanSentinelError) {
          const { orphan } = error;
          if (jsonMode) {
            console.log(
              formatOutput(
                {
                  success: false,
                  error: "interrupted-transaction",
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

      try {
        const result = runMigrate(workspaceRoot);

        if (jsonMode) {
          console.log(
            formatOutput(
              {
                success: true,
                alreadyMigrated: result.alreadyMigrated,
                filesRenamed: result.filesRenamed,
                headersRewritten: result.headersRewritten,
                wikilinksRewritten: result.wikilinksRewritten,
                renames: result.renames,
              },
              { json: true, humanReadable: "" }
            )
          );
        } else {
          clack.intro(chalk.bold("rubber-ducky migrate"));

          if (result.alreadyMigrated) {
            clack.log.success(
              "Vault is already up to date — nothing to migrate."
            );
          } else {
            if (result.filesRenamed > 0) {
              clack.log.success(
                `Renamed ${result.filesRenamed} file${result.filesRenamed === 1 ? "" : "s"} to uppercase`
              );
              for (const r of result.renames) {
                clack.log.info(`  ${r.from} → ${r.to}`);
              }
            }
            if (result.headersRewritten > 0) {
              clack.log.success(
                `Rewrote section headers in ${result.headersRewritten} file${result.headersRewritten === 1 ? "" : "s"}`
              );
            }
          }

          clack.outro(
            result.alreadyMigrated
              ? "No changes needed."
              : chalk.green("Migration complete.")
          );
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        if (jsonMode) {
          console.log(
            formatOutput(
              { success: false, error: msg },
              { json: true, humanReadable: msg }
            )
          );
        } else {
          clack.log.error(msg);
        }
        process.exit(1);
      }
    });
}
