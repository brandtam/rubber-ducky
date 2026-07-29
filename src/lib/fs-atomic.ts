import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Shared atomic-write primitive for every vault (and config) write.
 *
 * Write-to-temp-then-rename. Same-filesystem rename is atomic on POSIX
 * (and on Windows when both paths sit on the same volume), so a crash
 * mid-write leaves the original file intact instead of half-written.
 *
 * Hardening:
 *   - The temp filename mixes PID and a random suffix so two processes
 *     (or a forked child) can't collide.
 *   - We open the temp with `O_WRONLY|O_CREAT|O_EXCL` so we never overwrite
 *     an existing dropped temp from a crashed prior run by accident.
 *   - We `fsync` the file before rename so a power loss in the rename
 *     window leaves either the old content or the new — not zeros.
 *   - On any failure between open and rename, the temp is unlinked so the
 *     directory doesn't accumulate stale files.
 *
 * This is not a substitute for a real lock when multiple writers race:
 * vault writes are a low-frequency surface, but anyone reusing this
 * primitive for higher-frequency state should add `proper-lockfile` around
 * the read-modify-write cycle in the caller.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const suffix = crypto.randomBytes(8).toString("hex");
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${suffix}.tmp`);

  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw error;
  }
  fs.closeSync(fd);

  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw error;
  }
}
