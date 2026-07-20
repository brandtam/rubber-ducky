import { Command } from "commander";
import * as path from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import {
  applyAdopt,
  applyResultToJson,
  planAdopt,
  planToJson,
  summarizePlan,
  type AdoptAction,
  type AdoptPlan,
} from "../lib/adopt.js";
import { ExitCode, formatOutput, resolveOutputOptions } from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

function formatPlanHuman(plan: AdoptPlan): string {
  const summary = summarizePlan(plan);
  const lines: string[] = [
    chalk.bold(`Adopt plan for ${plan.workspacePath}`),
    "",
  ];

  const groups: Array<{ kind: AdoptAction["action"]; label: string; color: (s: string) => string }> = [
    { kind: "create", label: "create", color: chalk.green },
    { kind: "refresh", label: "refresh", color: chalk.cyan },
    { kind: "remove", label: "remove", color: chalk.yellow },
    { kind: "conflict", label: "conflict", color: chalk.red },
    { kind: "keep", label: "keep", color: chalk.dim },
  ];

  if (plan.dirs.length > 0) {
    lines.push(chalk.green(`  + ${plan.dirs.length} directories (${plan.dirs.join(", ")})`));
  }

  for (const group of groups) {
    const actions = plan.actions.filter((a) => a.action === group.kind);
    for (const action of actions) {
      const detail = group.kind === "keep" ? "" : ` — ${action.reason}`;
      lines.push(group.color(`  ${group.label.padEnd(8)} ${action.path}${detail}`));
    }
  }

  lines.push(
    "",
    `${summary.create} create, ${summary.refresh} refresh, ${summary.remove} remove, ` +
      `${summary.keep} keep, ${summary.conflict} conflict`,
  );
  return lines.join("\n");
}

export function registerAdoptCommand(program: Command): void {
  program
    .command("adopt")
    .description(
      "Layer rubber-ducky into any directory non-destructively. Dry-run by default — prints the full plan; --apply executes it.",
    )
    .argument("[directory]", "Target directory (defaults to the current directory)", ".")
    .option("--apply", "Execute the plan (default is a dry-run that writes nothing)")
    .option(
      "--force",
      "Resolve conflicts in adopt's favor: overwrite locally modified managed files and remove hand-modified v2 skill copies",
    )
    .action(async (directory: string, opts: { apply?: boolean; force?: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const out = resolveOutputOptions(globalOpts);

      const fullPath = path.resolve(process.cwd(), directory);

      try {
        const plan = planAdopt(fullPath);

        if (!opts.apply) {
          // Dry-run: print the complete plan, write nothing, exit 0.
          if (out.json) {
            console.log(formatOutput(planToJson(plan, out), out));
          } else {
            const summary = summarizePlan(plan);
            console.log(formatPlanHuman(plan));
            if (summary.conflict > 0) {
              console.log(
                chalk.yellow(
                  `\nConflicts require a decision: re-run with --apply to be prompted, or --apply --force to resolve them in adopt's favor.`,
                ),
              );
            }
            console.log(chalk.dim(`\nDry-run only — re-run with --apply to execute.`));
          }
          return;
        }

        // Interactive conflict resolution only when a human is attached on
        // both ends. JSON/piped mode never prompts — conflicts are reported
        // as requiring an explicit --force.
        const interactive =
          !out.json &&
          opts.force !== true &&
          process.stdout.isTTY === true &&
          process.stdin.isTTY === true;

        // clack prompts are async, so resolve conflicts up front and hand
        // applyAdopt a synchronous lookup.
        const resolvedPaths = new Set<string>();
        if (interactive) {
          for (const action of plan.actions) {
            if (action.action !== "conflict") continue;
            const verb = action.content !== undefined ? "Overwrite" : "Remove";
            const answer = await clack.confirm({
              message: `${action.path}: ${action.reason}. ${verb} it?`,
            });
            if (answer === true) resolvedPaths.add(action.path);
          }
        }

        const result = applyAdopt(plan, {
          force: opts.force === true,
          resolve: interactive
            ? (action: AdoptAction) => resolvedPaths.has(action.path)
            : undefined,
        });
        printApplyResult(plan, result, out);
        if (result.conflicts.length > 0) {
          process.exit(ExitCode.StateConflict);
        }
      } catch (error) {
        exitWithError(error, out, ExitCode.Unclassified);
      }
    });
}

function printApplyResult(
  plan: AdoptPlan,
  result: ReturnType<typeof applyAdopt>,
  out: ReturnType<typeof resolveOutputOptions>,
): void {
  if (out.json) {
    console.log(formatOutput(applyResultToJson(plan, result, out), out));
    return;
  }

  const lines: string[] = [
    chalk.green(`✓ Adopted ${chalk.bold(result.workspacePath)}`),
    "",
    `  created:   ${result.created.length}`,
    `  refreshed: ${result.refreshed.length}`,
    `  removed:   ${result.removed.length}`,
    `  kept:      ${result.kept.length}`,
  ];
  if (result.conflicts.length > 0) {
    lines.push("", chalk.red(`Unresolved conflicts (files left untouched):`));
    for (const conflict of result.conflicts) {
      lines.push(chalk.red(`  ${conflict.path}`) + chalk.dim(` — ${conflict.reason}`));
    }
    lines.push(chalk.yellow(`Re-run with --apply --force to resolve them in adopt's favor.`));
  }
  console.log(lines.join("\n"));
}
