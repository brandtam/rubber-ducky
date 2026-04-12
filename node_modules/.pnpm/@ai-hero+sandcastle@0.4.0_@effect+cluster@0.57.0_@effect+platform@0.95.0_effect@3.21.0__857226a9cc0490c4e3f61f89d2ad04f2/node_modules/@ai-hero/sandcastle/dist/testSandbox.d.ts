/**
 * Test helper: creates a local (filesystem-based) Sandbox layer for unit tests.
 * This replaces FilesystemSandbox which has been removed.
 */
import { Layer } from "effect";
import { Sandbox } from "./SandboxFactory.js";
export declare const makeLocalSandboxLayer: (sandboxDir: string) => Layer.Layer<Sandbox, never, never>;
//# sourceMappingURL=testSandbox.d.ts.map