export type FailedStep = "commits" | "diff" | "untracked";
export interface RecoveryInput {
    readonly patchDir: string;
    readonly failedStep: FailedStep;
    readonly hasCommits: boolean;
    readonly hasDiff: boolean;
    readonly hasUntracked: boolean;
    readonly branch?: string;
}
/**
 * Build copy-pastable recovery commands for a failed sync-out.
 * Pure function: takes failure state, returns formatted terminal output.
 */
export declare const buildRecoveryMessage: (input: RecoveryInput) => string;
//# sourceMappingURL=RecoveryMessage.d.ts.map