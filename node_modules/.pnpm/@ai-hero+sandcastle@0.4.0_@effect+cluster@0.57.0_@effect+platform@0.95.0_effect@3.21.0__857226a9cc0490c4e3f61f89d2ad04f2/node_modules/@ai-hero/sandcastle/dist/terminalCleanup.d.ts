/**
 * Terminal cleanup for abrupt exits.
 *
 * @clack/prompts' spinner and taskLog call stdin.setRawMode(true) and hide
 * the cursor via escape sequences. When the process is killed by a signal
 * handler that calls process.exit() directly (e.g. during Ctrl-C cleanup in
 * SandboxFactory), clack's own cleanup is bypassed and the terminal is left
 * in raw mode with the cursor hidden.
 *
 * Registering a process 'exit' listener that restores these guarantees the
 * terminal is always left in a usable state.
 */
/** Escape sequence to show the cursor (DECTCEM). */
export declare const SHOW_CURSOR = "\u001B[?25h";
/**
 * Creates a synchronous exit handler that restores terminal state.
 * Extracted as a pure function so it can be unit-tested without side effects.
 */
export declare const makeTerminalCleanupHandler: (stdin: {
    isTTY?: boolean | undefined;
    setRawMode?: ((raw: boolean) => void) | undefined;
}, stdout: {
    write: (data: string) => boolean;
}) => () => void;
/**
 * Registers the terminal cleanup handler on process 'exit'.
 * Call once at program startup (main.ts).
 */
export declare const setupTerminalCleanup: () => void;
//# sourceMappingURL=terminalCleanup.d.ts.map