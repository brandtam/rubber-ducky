import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { runDoctor } from "../lib/doctor.js";
import { runLinter } from "../lib/linter.js";

export function registerDoctorCommand(program: Command): void {
  const doctor = program
    .command("doctor")
    .description("Run workspace health checks")
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
        const result = await runDoctor(workspaceRoot);

        if (jsonMode) {
          console.log(
            formatOutput(
              {
                success: result.healthy,
                healthy: result.healthy,
                checks: result.checks,
                passed: result.passed,
                total: result.total,
              },
              { json: true, humanReadable: "" }
            )
          );
        } else {
          clack.intro(chalk.bold("rubber-ducky doctor"));
          for (const check of result.checks) {
            if (check.pass) {
              clack.log.success(`${chalk.bold(check.name)}: ${check.message}`);
            } else {
              clack.log.error(`${chalk.bold(check.name)}: ${check.message}`);
            }
          }
          clack.outro(
            result.healthy
              ? chalk.green(`All ${result.total} checks passed.`)
              : chalk.red(`${result.passed}/${result.total} checks passed.`)
          );
        }

        if (!result.healthy) {
          process.exit(1);
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

  doctor
    .command("lint")
    .description("Run linter checks on workspace wiki pages")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
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
        const result = runLinter(workspaceRoot);

        if (jsonMode) {
          console.log(
            formatOutput(
              {
                success: true,
                findings: result.findings,
                summary: result.summary,
              },
              { json: true, humanReadable: "" }
            )
          );
        } else {
          clack.intro(chalk.bold("rubber-ducky doctor lint"));

          if (result.findings.length === 0) {
            clack.log.success("No issues found. Workspace is clean.");
          } else {
            // Group by severity
            const errors = result.findings.filter((f) => f.severity === "error");
            const warnings = result.findings.filter((f) => f.severity === "warning");
            const info = result.findings.filter((f) => f.severity === "info");

            if (errors.length > 0) {
              clack.log.error(chalk.bold(`Errors (${errors.length}):`));
              for (const f of errors) {
                clack.log.error(`  ${f.file ?? "—"}: ${f.message}`);
              }
            }
            if (warnings.length > 0) {
              clack.log.warning(chalk.bold(`Warnings (${warnings.length}):`));
              for (const f of warnings) {
                clack.log.warning(`  ${f.file ?? "—"}: ${f.message}`);
              }
            }
            if (info.length > 0) {
              clack.log.info(chalk.bold(`Info (${info.length}):`));
              for (const f of info) {
                clack.log.info(`  ${f.file ?? "—"}: ${f.message}`);
              }
            }
          }

          clack.outro(
            `${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.info} info`
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
