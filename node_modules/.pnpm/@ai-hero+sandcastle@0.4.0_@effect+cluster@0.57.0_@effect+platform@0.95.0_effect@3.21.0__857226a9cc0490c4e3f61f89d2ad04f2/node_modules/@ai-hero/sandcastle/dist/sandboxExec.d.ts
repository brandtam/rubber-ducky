import type { IsolatedSandboxHandle } from "./SandboxProvider.js";
/** Execute a command on the host side, returning stdout. Throws on non-zero exit. */
export declare const execHost: (command: string, cwd: string) => Promise<string>;
/** Execute a command in the sandbox, throwing if it fails. */
export declare const execOk: (handle: IsolatedSandboxHandle, command: string, options?: {
    cwd?: string | undefined;
} | undefined) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
//# sourceMappingURL=sandboxExec.d.ts.map