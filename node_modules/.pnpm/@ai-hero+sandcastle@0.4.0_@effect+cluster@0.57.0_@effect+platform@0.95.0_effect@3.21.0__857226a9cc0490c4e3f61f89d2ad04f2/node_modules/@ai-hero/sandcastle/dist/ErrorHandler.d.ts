import { Effect } from "effect";
import { Display } from "./Display.js";
import type { SandboxError } from "./errors.js";
/**
 * Formats a tagged SandboxError into a user-friendly message with
 * context-specific hints about what went wrong and how to recover.
 */
export declare const formatErrorMessage: (error: SandboxError) => string;
/**
 * Wraps an effect so that any SandboxError is caught, displayed via the
 * Display service as an error-severity status message, then exits the process
 * with code 1. Non-SandboxError errors pass through unchanged.
 */
export declare const withFriendlyErrors: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, Exclude<E, SandboxError>, R | Display>;
//# sourceMappingURL=ErrorHandler.d.ts.map