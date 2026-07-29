import * as path from "node:path";

/**
 * Thrown when a user-supplied file argument resolves outside the workspace
 * root. Identity-based so command handlers can map it to the typed
 * `InvalidInput` exit code without parsing message strings.
 */
export class PathOutsideWorkspaceError extends Error {
  readonly requestedPath: string;

  constructor(requestedPath: string) {
    super(
      `Path escapes the workspace: ${requestedPath}. ` +
      `File arguments must resolve inside the workspace root.`
    );
    this.name = "PathOutsideWorkspaceError";
    this.requestedPath = requestedPath;
  }
}

/**
 * Resolve a user-supplied relative path against the workspace root and
 * require the result to stay inside it. Rejects `../../outside.md` style
 * escapes and absolute paths pointing elsewhere.
 *
 * Returns the absolute resolved path.
 */
export function resolveInsideWorkspace(
  workspaceRoot: string,
  requestedPath: string
): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, requestedPath);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PathOutsideWorkspaceError(requestedPath);
  }

  return resolved;
}

/** True when `resolvedPath` (absolute) sits inside `workspaceRoot`. */
export function isInsideWorkspace(
  workspaceRoot: string,
  resolvedPath: string
): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(resolvedPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}
