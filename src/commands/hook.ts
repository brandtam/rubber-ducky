import * as fs from "node:fs";
import { Command } from "commander";
import { runConfirmGate } from "../lib/confirm-gate.js";

/**
 * `rubber-ducky hook ...` — hidden verbs backing the plugin's Claude Code
 * hooks (hooks/hooks.json). These are machine-facing: Claude Code pipes the
 * hook payload on stdin and interprets stdout/exit-code per the hooks
 * contract. They are hidden from `--help` because no human workflow calls
 * them directly.
 *
 * `hook pre-tool-use` is the confirm gate (docs/adr/confirm-gate-single-hook.md):
 * it reads a PreToolUse payload from stdin and either prints a permission
 * decision JSON envelope or prints nothing. It ALWAYS exits 0 — under the
 * Claude Code hooks contract exit 0 with empty stdout means "defer to the
 * normal permission flow", which is exactly the gate's fail-open posture.
 * Exit 2 (blocking error) is never used: unregistered or unparseable input
 * must pass through untouched.
 */
export function registerHookCommand(program: Command): void {
  const hook = program
    .command("hook", { hidden: true })
    .description("Machine-facing hook endpoints used by the Claude Code plugin");

  hook
    .command("pre-tool-use")
    .description("Confirm gate: read a PreToolUse payload on stdin, emit a permission decision (or nothing)")
    .action(() => {
      try {
        // fd 0 — synchronous stdin read; hook payloads are small by contract.
        const raw = fs.readFileSync(0, "utf-8");
        const decision = runConfirmGate(raw);
        if (decision) {
          console.log(JSON.stringify(decision));
        }
      } catch {
        // Fail-open: no output, exit 0 — the tool call proceeds through
        // Claude Code's native permission system.
      }
    });
}
