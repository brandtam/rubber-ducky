import { execFileSync } from "node:child_process";
import * as path from "node:path";

/**
 * Shared CLI test harness — the one place tests invoke the CLI from.
 *
 * By default the CLI runs from source (`bun src/cli.ts`). Set
 * `RUBBER_DUCKY_TEST_BINARY=/path/to/binary` to run the same suite against a
 * compiled single-file executable instead. CI's binary job uses this, and the
 * future release pipeline will use it to smoke-test every platform binary
 * before attaching it to a release.
 */
const BINARY = process.env.RUBBER_DUCKY_TEST_BINARY;
const CLI_PATH = path.resolve(import.meta.dir, "..", "cli.ts");

function command(): { file: string; prefixArgs: string[] } {
  if (BINARY) {
    return { file: path.resolve(BINARY), prefixArgs: [] };
  }
  // process.execPath is the bun executable running the test suite.
  return { file: process.execPath, prefixArgs: [CLI_PATH] };
}

/**
 * Run the CLI, returning stdout. Throws on non-zero exit (the thrown error
 * carries `stdout`, `stderr`, and `status` from execFileSync).
 */
export function runCli(args: string[], cwd?: string): string {
  const { file, prefixArgs } = command();
  return execFileSync(file, [...prefixArgs, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

export interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

/**
 * Run the CLI expecting (possible) failure — never throws; returns stdout,
 * stderr, and the exit status so tests can assert typed exit codes.
 */
export function runCliFail(args: string[], cwd?: string): CliResult {
  try {
    const stdout = runCli(args, cwd);
    return { stdout, stderr: "", status: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      status: err.status ?? 1,
    };
  }
}
