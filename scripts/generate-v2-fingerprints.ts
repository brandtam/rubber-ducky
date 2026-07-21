/**
 * Regenerates src/lib/v2-fingerprints.ts from the legacy v2 checkout.
 *
 * v2 had no managed-files manifest, so the v3 `adopt` verb recognizes
 * v2-shipped files by content hash. This script harvests those hashes from
 * the legacy repo:
 *
 *  - File-based assets (skills, agents, examples): every historical blob of
 *    `src/skills/**`, `src/agents/**`, `src/examples/**` across the legacy
 *    repo's full git history, so any v2 release's byte-exact copy matches.
 *  - Generated content (CLAUDE.md, settings, references, context pages,
 *    Obsidian config, generated ingest skills): evaluated by importing the
 *    legacy generator modules directly (HEAD versions only — earlier
 *    generated variants are a documented recognition gap; unrecognized
 *    files degrade to a conflict prompt, never a silent overwrite).
 *
 * The emitted module is checked in — CI and the compiled binary never need
 * the legacy repo. Re-run with:
 *
 *   RUBBER_DUCKY_LEGACY=/path/to/rubber-ducky-legacy bun scripts/generate-v2-fingerprints.ts
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LEGACY =
  process.env.RUBBER_DUCKY_LEGACY ??
  path.join(os.homedir(), "codes", "brandtam", "rubber-ducky-legacy");

if (!fs.existsSync(path.join(LEGACY, "src", "lib", "templates.ts"))) {
  console.error(
    `Legacy repo not found at ${LEGACY} — set RUBBER_DUCKY_LEGACY to the v2 checkout.`,
  );
  process.exit(1);
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", LEGACY, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// 1. Historical file-based assets: skills, agents, examples.
// ---------------------------------------------------------------------------

const ASSET_RE = /^src\/(skills|agents|examples)\/(.+)$/;

const assetHashes = new Set<string>();
const skillDirs = new Set<string>();

for (const line of git(["rev-list", "--objects", "--all"]).split("\n")) {
  const spaceIdx = line.indexOf(" ");
  if (spaceIdx === -1) continue;
  const oid = line.slice(0, spaceIdx);
  const objPath = line.slice(spaceIdx + 1);
  const match = objPath.match(ASSET_RE);
  if (!match) continue;
  const [, kind, rel] = match;
  // Directory tree objects also appear in --objects output; only hash blobs.
  const type = git(["cat-file", "-t", oid]).trim();
  if (type !== "blob") continue;
  const content = execFileSync("git", ["-C", LEGACY, "cat-file", "blob", oid], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assetHashes.add(sha256(content));
  if (kind === "skills") {
    skillDirs.add(rel.split("/")[0]);
  }
}

// ---------------------------------------------------------------------------
// 2. Generated content from the legacy HEAD generators.
// ---------------------------------------------------------------------------

const legacyTemplates = await import(path.join(LEGACY, "src", "lib", "templates.ts"));
const legacyBundled = await import(path.join(LEGACY, "src", "lib", "bundled-assets.ts"));

// CLAUDE.md is parameterized by workspace name in its first line only
// (`# <name>` — silent v2 init collected no purpose). Fingerprint the
// constant tail after the first newline so any vault name matches.
const claudeMd: string = legacyTemplates.generateClaudeMd({ name: "__V2_PROBE__" });
const claudeMdTail = claudeMd.slice(claudeMd.indexOf("\n") + 1);
const claudeMdTailHashes = new Set<string>([sha256(claudeMdTail)]);

// Path-keyed managed/removable generated files.
const managedFileHashes = new Map<string, Set<string>>();
function addManaged(rel: string, content: string): void {
  const set = managedFileHashes.get(rel) ?? new Set<string>();
  set.add(sha256(content));
  managedFileHashes.set(rel, set);
}

addManaged(".claude/settings.json", legacyTemplates.generateClaudeSettings());
addManaged(".claude/settings.json", legacyTemplates.generateClaudeSettings([]));
addManaged(".gitignore", legacyTemplates.generateGitignore());
addManaged("settings.json", legacyTemplates.VAULT_SETTINGS_TEMPLATE);

for (const ref of legacyTemplates.generateReferenceFiles(undefined) as Array<{
  path: string;
  content: string;
}>) {
  addManaged(ref.path, ref.content);
}

for (const page of legacyTemplates.generateContextPageTemplates() as Array<{
  relativePath: string;
  content: string;
}>) {
  addManaged(page.relativePath, page.content);
}

for (const cfg of legacyBundled.getBundledObsidianConfig() as Array<{
  relativePath: string;
  content: string;
}>) {
  addManaged(cfg.relativePath, cfg.content);
}

// Generated ingest skills. Only the GitHub one is fully static; Asana/Jira
// ingest skills embed per-workspace config and are a documented gap.
for (const skill of legacyTemplates.generateBackendSkills([{ type: "github" }]) as Array<{
  path: string;
  content: string;
}>) {
  assetHashes.add(sha256(skill.content));
  skillDirs.add(skill.path.split("/")[2]);
}

// ---------------------------------------------------------------------------
// 3. Emit the module.
// ---------------------------------------------------------------------------

function emitSet(values: Iterable<string>): string {
  return [...values]
    .sort()
    .map((v) => `  ${JSON.stringify(v)},`)
    .join("\n");
}

const managedEntries = [...managedFileHashes.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(
    ([rel, hashes]) =>
      `  [${JSON.stringify(rel)}, [\n${[...hashes]
        .sort()
        .map((h) => `    ${JSON.stringify(h)},`)
        .join("\n")}\n  ]],`,
  )
  .join("\n");

const out = `/**
 * Known-v2 content fingerprints — GENERATED FILE, do not edit by hand.
 *
 * Regenerate with:
 *   RUBBER_DUCKY_LEGACY=/path/to/rubber-ducky-legacy bun scripts/generate-v2-fingerprints.ts
 *
 * v2 shipped skills, agents, examples, references, Obsidian config, and
 * settings directly into vaults with no manifest. The adopt verb uses these
 * sha256 hashes to claim byte-identical v2-shipped files (refresh or remove
 * them) while treating anything unrecognized as user-owned or hand-modified.
 *
 * Coverage: file-based assets are hashed across the legacy repo's full git
 * history; generated content is hashed from the legacy HEAD generators only.
 * A v2 file from an intermediate release whose generated bytes differ will
 * surface as a conflict (explicit prompt / --force) instead of matching —
 * the failure mode is always "ask", never "silently overwrite".
 */

/** sha256 hashes of every known v2-shipped skill/agent/example file. */
export const V2_ASSET_HASHES: ReadonlySet<string> = new Set([
${emitSet(assetHashes)}
]);

/** Skill directory names v2 ever shipped under \`.claude/skills/\`. */
export const V2_SKILL_DIRS: ReadonlySet<string> = new Set([
${emitSet(skillDirs)}
]);

/**
 * sha256 hashes of the constant tail of a v2-generated CLAUDE.md (everything
 * after the first \`# <name>\` line, which is the only name-parameterized
 * part of a silent-init v2 CLAUDE.md).
 */
export const V2_CLAUDE_MD_TAIL_HASHES: ReadonlySet<string> = new Set([
${emitSet(claudeMdTailHashes)}
]);

/** Path-keyed sha256 hashes of v2-generated files (settings, references, context pages, Obsidian config). */
export const V2_FILE_HASHES: ReadonlyMap<string, readonly string[]> = new Map([
${managedEntries}
]);
`;

const target = path.join(import.meta.dir, "..", "src", "lib", "v2-fingerprints.ts");
fs.writeFileSync(target, out, "utf-8");
console.log(
  `Wrote ${target}: ${assetHashes.size} asset hashes, ${skillDirs.size} skill dirs, ${managedFileHashes.size} path-keyed files.`,
);
