import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Integration suite for the plugin's binary bootstrap wrapper
 * (`bin/rubber-ducky`) and the SessionStart pre-warm hook script
 * (`scripts/prewarm.sh`). Asserts external behavior only: what got
 * downloaded (request log of a mocked release server), what ended up in the
 * cache, what the exec'd binary received, and exit codes.
 *
 * The release source is mocked via RUBBER_DUCKY_DOWNLOAD_BASE — the real
 * GitHub Releases fetch is exercised in the launch slice once the first tag
 * exists. The mock serves a shell script as the "binary": the wrapper's
 * contract (download, chmod, exec with args passed through) is identical
 * regardless of what the asset is.
 *
 * The wrapper is spawned asynchronously on purpose: the mock server runs on
 * this process's event loop, so a sync spawn would deadlock waiting on a
 * response the blocked loop can never serve.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");
const WRAPPER_SRC = path.join(REPO_ROOT, "bin", "rubber-ducky");
const PREWARM_SRC = path.join(REPO_ROOT, "scripts", "prewarm.sh");

// Release assets are named by platform, mirroring release.yml's matrix.
const PLATFORM =
  process.platform === "darwin"
    ? process.arch === "arm64"
      ? "darwin-arm64"
      : "darwin-x64"
    : "linux-x64";

let server: ReturnType<typeof Bun.serve>;
let requests: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      requests.push(pathname);
      // A version containing "missing" simulates an asset that does not
      // exist on the release (e.g. plugin published before the tag).
      if (pathname.includes("missing")) {
        return new Response("Not Found", { status: 404 });
      }
      // The served "binary" reports which asset it came from and prints each
      // argument on its own line, so tests can assert argv boundaries.
      const body = `#!/bin/sh\necho "served:${pathname}"\nfor a in "$@"; do printf 'arg:%s\\n' "$a"; done\nexit 0\n`;
      return new Response(body);
    },
  });
});

afterAll(() => {
  server.stop(true);
});

describe("plugin binary bootstrap wrapper", () => {
  let tmpDir: string;
  let pluginDir: string;
  let cacheDir: string;

  beforeEach(() => {
    requests = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wrapper-test-"));
    pluginDir = path.join(tmpDir, "plugin");
    cacheDir = path.join(tmpDir, "cache");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Stage a copy of the real wrapper + pre-warm script under a manifest with a chosen version. */
  function stagePlugin(version: string): void {
    fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(pluginDir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(pluginDir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "rubber-ducky", version }, null, 2),
      "utf-8",
    );
    for (const [src, dest] of [
      [WRAPPER_SRC, path.join(pluginDir, "bin", "rubber-ducky")],
      [PREWARM_SRC, path.join(pluginDir, "scripts", "prewarm.sh")],
    ] as const) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  }

  interface RunResult {
    stdout: string;
    stderr: string;
    status: number;
  }

  function run(file: string, args: string[], extraEnv: Record<string, string> = {}): Promise<RunResult> {
    const env = {
      ...process.env,
      RUBBER_DUCKY_CACHE_DIR: cacheDir,
      RUBBER_DUCKY_DOWNLOAD_BASE: `http://127.0.0.1:${server.port}`,
      ...extraEnv,
    };
    return new Promise((resolve) => {
      execFile(file, args, { encoding: "utf-8", env }, (error, stdout, stderr) => {
        const code = error ? (error as { code?: unknown }).code : 0;
        resolve({ stdout, stderr, status: typeof code === "number" ? code : code == null ? 0 : 1 });
      });
    });
  }

  const wrapper = () => path.join(pluginDir, "bin", "rubber-ducky");
  const prewarm = () => path.join(pluginDir, "scripts", "prewarm.sh");
  const cachedBinary = (version: string) => path.join(cacheDir, version, "rubber-ducky");

  async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await Bun.sleep(25);
    }
    return predicate();
  }

  describe("download-on-first-use", () => {
    it("downloads the versioned platform asset exactly once, then serves from cache", async () => {
      stagePlugin("1.2.3");

      const first = await run(wrapper(), ["--version"]);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain(`served:/v1.2.3/rubber-ducky-${PLATFORM}`);
      expect(requests).toEqual([`/v1.2.3/rubber-ducky-${PLATFORM}`]);
      expect(fs.existsSync(cachedBinary("1.2.3"))).toBe(true);

      const second = await run(wrapper(), ["--version"]);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain(`served:/v1.2.3/rubber-ducky-${PLATFORM}`);
      // Still exactly one request — the second invocation hit the cache.
      expect(requests).toHaveLength(1);
    });

    it("passes all arguments through to the binary with boundaries intact", async () => {
      stagePlugin("1.2.3");
      const result = await run(wrapper(), ["task", "add", "two words", "--json"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("arg:task\narg:add\narg:two words\narg:--json\n");
    });

    it("fails with a clear error and caches nothing when the asset is unavailable", async () => {
      stagePlugin("0.0.0-missing");
      const result = await run(wrapper(), ["--version"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("download failed");
      expect(result.stderr).toContain(`/v0.0.0-missing/rubber-ducky-${PLATFORM}`);
      // No binary and no leftover temp file in the versioned cache dir.
      expect(fs.existsSync(cachedBinary("0.0.0-missing"))).toBe(false);
      const versionDir = path.join(cacheDir, "0.0.0-missing");
      const leftovers = fs.existsSync(versionDir) ? fs.readdirSync(versionDir) : [];
      expect(leftovers).toEqual([]);
    });
  });

  describe("cached binary", () => {
    it("execs the cached binary without touching the network", async () => {
      stagePlugin("2.0.0");
      fs.mkdirSync(path.join(cacheDir, "2.0.0"), { recursive: true });
      fs.writeFileSync(cachedBinary("2.0.0"), `#!/bin/sh\necho "cached-binary args:[$*]"\nexit 3\n`, "utf-8");
      fs.chmodSync(cachedBinary("2.0.0"), 0o755);

      const result = await run(wrapper(), ["doctor", "--json"]);
      expect(result.stdout).toContain("cached-binary args:[doctor --json]");
      // Exit code of the exec'd binary is the wrapper's exit code.
      expect(result.status).toBe(3);
      expect(requests).toHaveLength(0);
    });

    it("re-fetches when the plugin version diverges from the cached one, pruning the stale version", async () => {
      stagePlugin("1.1.0");
      // Cache holds the previous plugin version's binary.
      fs.mkdirSync(path.join(cacheDir, "1.0.0"), { recursive: true });
      fs.writeFileSync(cachedBinary("1.0.0"), `#!/bin/sh\necho "stale-binary"\nexit 0\n`, "utf-8");
      fs.chmodSync(cachedBinary("1.0.0"), 0o755);

      const result = await run(wrapper(), ["--version"]);
      expect(result.status).toBe(0);
      // The new version was fetched and executed — not the stale binary.
      expect(result.stdout).toContain(`served:/v1.1.0/rubber-ducky-${PLATFORM}`);
      expect(result.stdout).not.toContain("stale-binary");
      expect(requests).toEqual([`/v1.1.0/rubber-ducky-${PLATFORM}`]);
      // Lockstep cache: the stale version directory is gone.
      expect(fs.existsSync(path.join(cacheDir, "1.0.0"))).toBe(false);
      expect(fs.existsSync(cachedBinary("1.1.0"))).toBe(true);
    });
  });

  describe("bootstrap-only mode (pre-warm)", () => {
    it("caches the binary without executing it", async () => {
      stagePlugin("1.2.3");
      const result = await run(wrapper(), [], { RUBBER_DUCKY_BOOTSTRAP_ONLY: "1" });
      expect(result.status).toBe(0);
      // The fake binary never ran — no "served:" output.
      expect(result.stdout).toBe("");
      expect(requests).toEqual([`/v1.2.3/rubber-ducky-${PLATFORM}`]);
      expect(fs.existsSync(cachedBinary("1.2.3"))).toBe(true);
    });
  });

  describe("SessionStart pre-warm hook script", () => {
    it("exits 0 immediately and downloads the binary in the background", async () => {
      stagePlugin("1.2.3");
      const result = await run(prewarm(), []);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");

      // The backgrounded bootstrap finishes shortly after.
      expect(await waitFor(() => fs.existsSync(cachedBinary("1.2.3")))).toBe(true);
      expect(requests).toEqual([`/v1.2.3/rubber-ducky-${PLATFORM}`]);
    });

    it("is a fast no-op when the binary is already cached", async () => {
      stagePlugin("1.2.3");
      await run(wrapper(), [], { RUBBER_DUCKY_BOOTSTRAP_ONLY: "1" });
      expect(requests).toHaveLength(1);

      const result = await run(prewarm(), []);
      expect(result.status).toBe(0);
      // Give the backgrounded check time to (not) download anything.
      await Bun.sleep(300);
      expect(requests).toHaveLength(1);
    });

    it("never blocks or fails the session even when the download source is down", async () => {
      stagePlugin("0.0.0-missing");
      const result = await run(prewarm(), []);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      // The background attempt fails silently; nothing is cached.
      await waitFor(() => requests.length > 0, 2000);
      expect(fs.existsSync(cachedBinary("0.0.0-missing"))).toBe(false);
    });
  });

  describe("cache location", () => {
    it("defaults to XDG_CACHE_HOME/rubber-ducky when no explicit cache dir is set", async () => {
      stagePlugin("1.2.3");
      const xdgHome = path.join(tmpDir, "xdg-cache");
      const result = await run(wrapper(), ["--version"], {
        RUBBER_DUCKY_CACHE_DIR: "",
        XDG_CACHE_HOME: xdgHome,
      });
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(xdgHome, "rubber-ducky", "1.2.3", "rubber-ducky"))).toBe(true);
    });
  });
});
