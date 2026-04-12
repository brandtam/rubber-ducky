import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
/**
 * Resolve all env vars from .env files with process.env fallback.
 *
 * Precedence: .sandcastle/.env > process.env
 * Only keys declared in .sandcastle/.env are resolved from process.env.
 * Repo root .env is not part of the resolution chain.
 */
export declare const resolveEnv: (repoDir: string) => Effect.Effect<Record<string, string>, never, FileSystem.FileSystem>;
//# sourceMappingURL=EnvResolver.d.ts.map