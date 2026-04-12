import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer, Ref } from "effect";
export type Severity = "info" | "success" | "warn" | "error";
export type DisplayEntry = {
    readonly _tag: "intro";
    readonly title: string;
} | {
    readonly _tag: "status";
    readonly message: string;
    readonly severity: Severity;
} | {
    readonly _tag: "spinner";
    readonly message: string;
} | {
    readonly _tag: "summary";
    readonly title: string;
    readonly rows: Record<string, string>;
} | {
    readonly _tag: "taskLog";
    readonly title: string;
    readonly messages: ReadonlyArray<string>;
} | {
    readonly _tag: "text";
    readonly message: string;
} | {
    readonly _tag: "toolCall";
    readonly name: string;
    readonly formattedArgs: string;
};
export interface DisplayService {
    readonly intro: (title: string) => Effect.Effect<void>;
    readonly status: (message: string, severity: Severity) => Effect.Effect<void>;
    readonly spinner: <A, E, R>(message: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    readonly summary: (title: string, rows: Record<string, string>) => Effect.Effect<void>;
    readonly taskLog: <A, E, R>(title: string, effect: (message: (msg: string) => void) => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    readonly text: (message: string) => Effect.Effect<void>;
    readonly toolCall: (name: string, formattedArgs: string) => Effect.Effect<void>;
}
declare const Display_base: Context.TagClass<Display, "Display", DisplayService>;
export declare class Display extends Display_base {
}
export declare const SilentDisplay: {
    layer: (ref: Ref.Ref<readonly DisplayEntry[]>) => Layer.Layer<Display, never, never>;
};
export declare const FileDisplay: {
    layer: (filePath: string) => Layer.Layer<Display, never, FileSystem.FileSystem>;
};
export declare const terminalStyle: {
    status: (message: string) => string;
    summaryTitle: (title: string) => string;
    summaryRow: (key: string, value: string) => string;
    toolCall: (text: string) => string;
};
export declare const ClackDisplay: {
    layer: Layer.Layer<Display, never, never>;
};
export {};
//# sourceMappingURL=Display.d.ts.map