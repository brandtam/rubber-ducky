import * as crypto from "node:crypto";
import { writeFileAtomic } from "./fs-atomic.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CLAUDE_MD_SHIM,
  generateAgentsMd,
  generateBaseViews,
  generateClaudeSettings,
  generateContextPageTemplates,
  generateGitignore,
  generateReferenceFiles,
  generateWorkspaceMd,
  VAULT_SETTINGS_TEMPLATE,
} from "./templates.js";
import { SETTINGS_FILENAME } from "./settings.js";
import { summarizeArray, type ArrayEnvelope } from "./output.js";
import {
  V2_ASSET_HASHES,
  V2_CLAUDE_MD_TAIL_HASHES,
  V2_FILE_HASHES,
  V2_SKILL_DIRS,
} from "./v2-fingerprints.js";

/**
 * The universal adopt engine: layer rubber-ducky non-destructively into any
 * directory — empty, an existing Obsidian vault, or a legacy v2 vault.
 *
 * Safety model
 * ------------
 * Adopt may only ever write files it tracks in the managed-files manifest
 * (`.rubber-ducky/manifest.json`, content-hashed). Every candidate write is
 * classified before anything touches disk:
 *
 * - `managed` files (AGENTS.md, the CLAUDE.md shim, `.claude/settings.json`,
 *   reference schemas, Bases views) are refreshed on every adopt — but only
 *   when the on-disk copy is provably ours: byte-equal to the current
 *   template, to the hash recorded in the manifest, or to a known v2-shipped
 *   fingerprint. Anything else is a conflict, surfaced for an explicit
 *   decision — never silently overwritten.
 * - `seed` files (workspace.md, vault settings, .gitignore, context pages,
 *   .gitkeeps) are created when missing and never touched again — they are
 *   user-owned the moment they exist.
 * - v2-shipped vault copies of skills/agents/examples and the Dataview
 *   Obsidian config are removed when they byte-match a known v2 fingerprint
 *   (skills are plugin-resident in v3 and stale copies would shadow them).
 *   A hand-modified copy inside a known v2 skill directory is a conflict.
 *
 * Everything else in the directory is invisible to adopt: user notes are
 * untouchable by construction, not by convention.
 */

export const MANIFEST_RELPATH = ".rubber-ducky/manifest.json";

/** Directories every vault gets. Mirrored from the v2-era init layout. */
export const DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "wiki/meetings",
  "wiki/spikes",
  "wiki/weekly",
  "wiki/repos",
  "raw",
  "references",
  ".rubber-ducky/transactions",
];

// User-facing content dirs that start empty. Git doesn't track empty
// folders, so each gets a `.gitkeep` (seed-mode: created once, then owned
// by the vault).
const GITKEEP_DIRS = [
  "wiki/daily",
  "wiki/tasks",
  "wiki/projects",
  "wiki/meetings",
  "wiki/spikes",
  "wiki/weekly",
  "wiki/repos",
  "raw",
];

export type AdoptRole = "managed" | "seed" | "v2";

export type AdoptActionKind = "create" | "refresh" | "keep" | "remove" | "conflict";

export interface AdoptAction {
  /** Vault-relative posix path. */
  path: string;
  action: AdoptActionKind;
  role: AdoptRole;
  reason: string;
  /**
   * Content to write for create/refresh (and for a conflict whose forced
   * resolution is an overwrite). Undefined for remove and for conflicts
   * whose forced resolution is a removal (v2 skill copies).
   */
  content?: string;
  /**
   * A conflict that no resolution can clear: a file occupies a path adopt
   * needs as a directory. Reported and left untouched even under --force —
   * never overwritten or removed. The user must move their file first.
   */
  blocking?: boolean;
}

export interface AdoptPlan {
  workspacePath: string;
  name: string;
  /** Vault-relative dirs that would be created (missing today). */
  dirs: string[];
  actions: AdoptAction[];
}

export interface AdoptApplyResult {
  workspacePath: string;
  created: string[];
  refreshed: string[];
  removed: string[];
  kept: string[];
  /** Conflicts left unresolved (files untouched). */
  conflicts: Array<{ path: string; reason: string }>;
  dirsCreated: string[];
}

interface ManifestEntry {
  hash: string;
  mode: "managed" | "seed";
}

interface Manifest {
  version: 1;
  updated: string;
  files: Record<string, ManifestEntry>;
}

export function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readManifest(targetDir: string): Manifest {
  const manifestPath = path.join(targetDir, MANIFEST_RELPATH);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, updated: "", files: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
    if (parsed && typeof parsed === "object" && parsed.files) return parsed;
  } catch {
    // Corrupt manifest: fall through to empty. Recognition degrades to
    // template/v2 matching, and unrecognized files become conflicts — the
    // safe direction.
  }
  return { version: 1, updated: "", files: {} };
}

/** Resolve the vault name: explicit > workspace.md frontmatter > basename. */
function resolveName(targetDir: string, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  const wsFile = path.join(targetDir, "workspace.md");
  if (fs.existsSync(wsFile)) {
    try {
      const match = fs.readFileSync(wsFile, "utf-8").match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const fm = parseYaml(match[1]) as { name?: unknown } | null;
        if (fm && typeof fm.name === "string" && fm.name.trim()) return fm.name;
      }
    } catch {
      // Unparsable workspace.md — fall back to the directory basename.
    }
  }
  return path.basename(path.resolve(targetDir));
}

interface TemplateFile {
  path: string;
  mode: "managed" | "seed";
  content: string;
}

/** The complete current-template set for a vault with the given name. */
function currentTemplates(name: string): TemplateFile[] {
  const files: TemplateFile[] = [
    // Seed files — created once, user-owned afterwards.
    { path: "workspace.md", mode: "seed", content: generateWorkspaceMd({ name }) },
    { path: SETTINGS_FILENAME, mode: "seed", content: VAULT_SETTINGS_TEMPLATE },
    { path: ".gitignore", mode: "seed", content: generateGitignore() },
    ...generateContextPageTemplates().map((p) => ({
      path: p.relativePath,
      mode: "seed" as const,
      content: p.content,
    })),
    ...GITKEEP_DIRS.map((dir) => ({
      path: `${dir}/.gitkeep`,
      mode: "seed" as const,
      content: "",
    })),
    // Managed files — refreshed by every adopt while provably unmodified.
    { path: "AGENTS.md", mode: "managed", content: generateAgentsMd({ name }) },
    { path: "CLAUDE.md", mode: "managed", content: CLAUDE_MD_SHIM },
    { path: ".claude/settings.json", mode: "managed", content: generateClaudeSettings() },
    ...generateReferenceFiles().map((r) => ({
      path: r.path,
      mode: "managed" as const,
      content: r.content,
    })),
    ...generateBaseViews().map((v) => ({
      path: v.relativePath,
      mode: "managed" as const,
      content: v.content,
    })),
  ];
  return files;
}

/** True when on-disk CLAUDE.md byte-matches a known v2 generation (its only name-parameterized part is the first `# <name>` line). */
function matchesV2ClaudeMd(diskContent: string): boolean {
  const firstNewline = diskContent.indexOf("\n");
  if (firstNewline === -1) return false;
  if (!diskContent.startsWith("# ")) return false;
  const tail = diskContent.slice(firstNewline + 1);
  return V2_CLAUDE_MD_TAIL_HASHES.has(sha256(tail));
}

/** True when the on-disk file at rel byte-matches a known v2-shipped generation of that path. */
function matchesV2File(rel: string, hash: string, diskContent: string): boolean {
  if (rel === "CLAUDE.md" && matchesV2ClaudeMd(diskContent)) return true;
  const known = V2_FILE_HASHES.get(rel);
  return known !== undefined && known.includes(hash);
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile()) out.push(child);
    }
  }
  return out.sort();
}

/**
 * Is there hard evidence this directory is (or was) a v2 vault? True only if
 * something in it byte-matches a known v2 fingerprint: the v2 CLAUDE.md, a
 * v2-shipped asset anywhere in the skill/command/agent/example namespaces, or
 * a v2-shipped generated file. Used to gate the by-name skill-conflict rule so
 * a generic directory name alone can never condemn a user-authored file.
 */
function vaultHasV2Fingerprint(targetDir: string): boolean {
  const claudeMd = path.join(targetDir, "CLAUDE.md");
  if (fs.existsSync(claudeMd) && matchesV2ClaudeMd(fs.readFileSync(claudeMd, "utf-8"))) {
    return true;
  }
  for (const root of [".claude/skills", ".claude/commands", ".claude/agents", "examples"]) {
    const abs = path.join(targetDir, root);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs)) {
      if (V2_ASSET_HASHES.has(sha256(fs.readFileSync(path.join(abs, rel))))) return true;
    }
  }
  for (const [rel] of V2_FILE_HASHES) {
    const abs = path.join(targetDir, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf-8");
    if (matchesV2File(rel, sha256(content), content)) return true;
  }
  return false;
}

/**
 * Sweep the v2-era namespaces for shipped copies to claim. Returns remove
 * and conflict actions; files that match nothing are left invisible to the
 * plan (user-owned).
 */
function planV2Sweep(targetDir: string): AdoptAction[] {
  const actions: AdoptAction[] = [];

  // Only claim hand-modified skill copies by name when the vault is provably a
  // v2 vault. A skill directory name (help, close, start, …) is far too
  // generic to condemn a file on its own — a user's own `.claude/skills/help/`
  // in a never-was-v2 folder must stay invisible. See docs/adr for the
  // evidence rule.
  const vaultLooksV2 = vaultHasV2Fingerprint(targetDir);

  // Vault-level skill copies (dir-based `.claude/skills/<name>/**` and the
  // older flat `.claude/commands/<name>.md`). Skills are plugin-resident in
  // v3 — stale copies would shadow the plugin's versions.
  const skillsRoot = path.join(targetDir, ".claude", "skills");
  if (fs.existsSync(skillsRoot)) {
    for (const rel of walkFiles(skillsRoot)) {
      const vaultRel = `.claude/skills/${rel}`;
      const skillDir = rel.split("/")[0];
      const hash = sha256(fs.readFileSync(path.join(skillsRoot, rel)));
      if (V2_ASSET_HASHES.has(hash)) {
        actions.push({
          path: vaultRel,
          action: "remove",
          role: "v2",
          reason:
            "v2-shipped skill copy — skills are plugin-resident in v3 and a stale vault copy would shadow them",
        });
      } else if (vaultLooksV2 && V2_SKILL_DIRS.has(skillDir)) {
        actions.push({
          path: vaultRel,
          action: "conflict",
          role: "v2",
          reason:
            `hand-modified copy of the v2 "${skillDir}" skill — remove it so it cannot shadow the plugin-resident skill, or keep your local copy`,
        });
      }
      // Anything else under .claude/skills/ is a user-authored skill: invisible.
    }
  }

  const commandsRoot = path.join(targetDir, ".claude", "commands");
  if (fs.existsSync(commandsRoot)) {
    for (const rel of walkFiles(commandsRoot)) {
      const hash = sha256(fs.readFileSync(path.join(commandsRoot, rel)));
      if (V2_ASSET_HASHES.has(hash)) {
        actions.push({
          path: `.claude/commands/${rel}`,
          action: "remove",
          role: "v2",
          reason: "v2-era flat command copy of a bundled skill — plugin-resident in v3",
        });
      }
    }
  }

  // Bundled agents and worked examples.
  for (const [root, label] of [
    [".claude/agents", "v2-shipped agent copy — plugin-resident in v3"],
    ["examples", "v2-bundled worked example — plugin-resident in v3"],
  ] as const) {
    const abs = path.join(targetDir, root);
    if (!fs.existsSync(abs)) continue;
    for (const rel of walkFiles(abs)) {
      const hash = sha256(fs.readFileSync(path.join(abs, rel)));
      if (V2_ASSET_HASHES.has(hash)) {
        actions.push({
          path: `${root}/${rel}`,
          action: "remove",
          role: "v2",
          reason: label,
        });
      }
    }
  }

  // v2's Dataview bootstrap. Bases views retire the Dataview dependency, so
  // byte-identical shipped config is removed. A user-modified Obsidian
  // config is their own and is left alone entirely.
  for (const rel of [".obsidian/community-plugins.json", ".obsidian/plugins/dataview/data.json"]) {
    const abs = path.join(targetDir, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf-8");
    if (matchesV2File(rel, sha256(content), content)) {
      actions.push({
        path: rel,
        action: "remove",
        role: "v2",
        reason: "v2-shipped Dataview bootstrap — Bases views (.base files) replace Dataview in v3",
      });
    }
  }

  return actions;
}

export interface PlanAdoptOptions {
  /** Override the vault name (init passes the validated basename). */
  name?: string;
}

/**
 * Compute the full adopt plan for a directory. Pure inspection — reads the
 * target but writes nothing.
 */
export function planAdopt(targetDir: string, opts: PlanAdoptOptions = {}): AdoptPlan {
  const resolved = path.resolve(targetDir);
  const exists = fs.existsSync(resolved);
  const name = exists ? resolveName(resolved, opts.name) : (opts.name ?? path.basename(resolved));
  const manifest = exists ? readManifest(resolved) : { version: 1 as const, updated: "", files: {} };

  const templates = currentTemplates(name);

  // A regular file sitting where adopt needs a directory (e.g. a file named
  // `raw` or `wiki`) would make apply throw ENOTDIR partway through, leaving a
  // half-written vault with no manifest. Detect it up front so the dry-run
  // shows it and apply reports it instead of crashing.
  const blockedActions = exists ? planCollisions(resolved, templates.map((t) => t.path)) : [];
  const blockedPaths = new Set(blockedActions.map((a) => a.path));
  const underBlocked = (rel: string): boolean => {
    let cur = "";
    for (const part of rel.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (blockedPaths.has(cur)) return true;
    }
    return false;
  };

  const dirs = DIRS.filter(
    (d) => !fs.existsSync(path.join(resolved, d)) && !underBlocked(d),
  );

  const actions: AdoptAction[] = [...blockedActions];

  for (const tmpl of templates) {
    if (underBlocked(tmpl.path)) continue;
    const abs = path.join(resolved, tmpl.path);
    if (!fs.existsSync(abs)) {
      actions.push({
        path: tmpl.path,
        action: "create",
        role: tmpl.mode,
        reason: tmpl.mode === "seed" ? "seeded once; yours to edit afterwards" : "managed file",
        content: tmpl.content,
      });
      continue;
    }

    if (tmpl.mode === "seed") {
      actions.push({
        path: tmpl.path,
        action: "keep",
        role: "seed",
        reason: "existing file preserved (seed-only — adopt never rewrites it)",
      });
      continue;
    }

    const diskContent = fs.readFileSync(abs, "utf-8");
    const diskHash = sha256(diskContent);
    const templateHash = sha256(tmpl.content);

    if (diskHash === templateHash) {
      actions.push({
        path: tmpl.path,
        action: "keep",
        role: "managed",
        reason: "up to date",
        // Carry the plan-time content so apply records this hash rather than
        // re-reading disk at apply time (which would claim an edit slipped in
        // between plan and apply, then silently overwrite it on a later run).
        content: tmpl.content,
      });
    } else if (manifest.files[tmpl.path]?.hash === diskHash) {
      actions.push({
        path: tmpl.path,
        action: "refresh",
        role: "managed",
        reason: "unmodified since last adopt — refreshed to the current template",
        content: tmpl.content,
      });
    } else if (matchesV2File(tmpl.path, diskHash, diskContent)) {
      actions.push({
        path: tmpl.path,
        action: "refresh",
        role: "managed",
        reason: "recognized v2-shipped file — claimed and refreshed to the v3 template",
        content: tmpl.content,
      });
    } else {
      actions.push({
        path: tmpl.path,
        action: "conflict",
        role: "managed",
        reason:
          "locally modified managed file — overwrite with the current template, or keep your local copy",
        content: tmpl.content,
      });
    }
  }

  if (exists) {
    actions.push(...planV2Sweep(resolved));
  }

  return { workspacePath: resolved, name, dirs, actions };
}

/**
 * Detect paths that already exist as regular files where adopt needs a
 * directory — the scaffold dirs and every template file's parent. Each is
 * returned as a blocking conflict: apply reports it and moves on rather than
 * throwing ENOTDIR mid-run, and no --force can overwrite or remove it.
 */
function planCollisions(resolved: string, templatePaths: string[]): AdoptAction[] {
  const requiredDirs = new Set<string>(DIRS);
  for (const p of templatePaths) {
    const slash = p.lastIndexOf("/");
    if (slash > 0) requiredDirs.add(p.slice(0, slash));
  }

  const blocked = new Set<string>();
  for (const rel of requiredDirs) {
    let cur = "";
    for (const part of rel.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      const abs = path.join(resolved, cur);
      if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) blocked.add(cur);
    }
  }

  return [...blocked].sort().map((rel) => ({
    path: rel,
    action: "conflict" as const,
    role: "seed" as const,
    reason: "a file exists where adopt needs a directory — rename or remove it, then re-run",
    blocking: true,
  }));
}

/** Write a file atomically — shared temp-file + rename primitive. */
function atomicWrite(abs: string, content: string): void {
  writeFileAtomic(abs, content);
}

/** Remove a file, then prune any directories the removal left empty. */
function removeAndPrune(targetDir: string, rel: string): void {
  const abs = path.join(targetDir, rel);
  fs.rmSync(abs, { force: true });
  let dir = path.dirname(abs);
  const root = path.resolve(targetDir);
  while (dir.startsWith(root) && dir !== root) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    } else {
      break;
    }
  }
}

export interface ApplyAdoptOptions {
  /** Resolve every conflict in favor of adopt (overwrite / remove). */
  force?: boolean;
  /**
   * Interactive resolver: called per conflict, returns true to resolve in
   * favor of adopt. Unused when `force` is set. When neither is provided,
   * conflicts are skipped and reported.
   */
  resolve?: (action: AdoptAction) => boolean;
}

/**
 * Execute a plan. Writes are per-file atomic (temp + rename); the manifest
 * is updated last so a crash mid-apply degrades to re-runnable refreshes,
 * never data loss. Only files in the plan — and therefore in the manifest —
 * are ever written or removed.
 */
export function applyAdopt(plan: AdoptPlan, opts: ApplyAdoptOptions = {}): AdoptApplyResult {
  const targetDir = plan.workspacePath;
  fs.mkdirSync(targetDir, { recursive: true });

  const manifest = readManifest(targetDir);
  const manifestBefore = JSON.stringify(manifest.files);
  const result: AdoptApplyResult = {
    workspacePath: targetDir,
    created: [],
    refreshed: [],
    removed: [],
    kept: [],
    conflicts: [],
    dirsCreated: [],
  };

  for (const dir of plan.dirs) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
    result.dirsCreated.push(dir);
  }

  const record = (action: AdoptAction, content: string): void => {
    manifest.files[action.path] = {
      hash: sha256(content),
      mode: action.role === "seed" ? "seed" : "managed",
    };
  };

  for (const action of plan.actions) {
    switch (action.action) {
      case "create": {
        atomicWrite(path.join(targetDir, action.path), action.content ?? "");
        record(action, action.content ?? "");
        result.created.push(action.path);
        break;
      }
      case "refresh": {
        atomicWrite(path.join(targetDir, action.path), action.content ?? "");
        record(action, action.content ?? "");
        result.refreshed.push(action.path);
        break;
      }
      case "keep": {
        // Managed keep: record the plan-time template content (which the plan
        // proved byte-equal to disk) so the manifest tracks the file even if
        // it predates the manifest. Recording a fresh disk read instead would
        // claim any edit made between plan and apply and silently overwrite it
        // next run. Seed keep: the file is user-owned — leave its record alone.
        if (action.role === "managed") {
          record(action, action.content ?? "");
        }
        result.kept.push(action.path);
        break;
      }
      case "remove": {
        removeAndPrune(targetDir, action.path);
        delete manifest.files[action.path];
        result.removed.push(action.path);
        break;
      }
      case "conflict": {
        // A blocking conflict (a file where a directory must go) can't be
        // resolved by overwriting or removing — report it untouched, even
        // under --force.
        if (action.blocking) {
          result.conflicts.push({ path: action.path, reason: action.reason });
          break;
        }
        const resolveInFavor = opts.force === true || opts.resolve?.(action) === true;
        if (!resolveInFavor) {
          result.conflicts.push({ path: action.path, reason: action.reason });
          break;
        }
        if (action.content !== undefined) {
          atomicWrite(path.join(targetDir, action.path), action.content);
          record(action, action.content);
          result.refreshed.push(action.path);
        } else {
          removeAndPrune(targetDir, action.path);
          delete manifest.files[action.path];
          result.removed.push(action.path);
        }
        break;
      }
    }
  }

  // Write the manifest only when this run changed something (or the
  // manifest is missing/stale). A true no-op run leaves every byte in the
  // vault untouched — including the manifest's `updated` stamp.
  const changedSomething =
    result.created.length > 0 || result.refreshed.length > 0 || result.removed.length > 0;
  const manifestPath = path.join(targetDir, MANIFEST_RELPATH);
  if (
    changedSomething ||
    !fs.existsSync(manifestPath) ||
    JSON.stringify(manifest.files) !== manifestBefore
  ) {
    manifest.version = 1;
    manifest.updated = new Date().toISOString();
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  return result;
}

// ---------------------------------------------------------------------------
// JSON contracts
// ---------------------------------------------------------------------------

export interface AdoptActionJson {
  path: string;
  action: AdoptActionKind;
  reason: string;
}

export interface AdoptSummaryJson {
  create: number;
  refresh: number;
  keep: number;
  remove: number;
  conflict: number;
}

export interface AdoptPlanJson {
  success: true;
  mode: "plan";
  workspacePath: string;
  summary: AdoptSummaryJson;
  actions: AdoptActionJson[] | ArrayEnvelope<AdoptActionJson>;
  dirsCreated: string[] | ArrayEnvelope<string>;
  /** Always the full list — conflicts are the part a consumer must act on. */
  conflicts: AdoptActionJson[];
}

export interface AdoptApplyJson {
  success: true;
  mode: "apply";
  workspacePath: string;
  summary: AdoptSummaryJson;
  created: string[] | ArrayEnvelope<string>;
  refreshed: string[] | ArrayEnvelope<string>;
  removed: string[] | ArrayEnvelope<string>;
  kept: string[] | ArrayEnvelope<string>;
  dirsCreated: string[] | ArrayEnvelope<string>;
  /** Always the full list — unresolved conflicts require an explicit flag. */
  conflicts: Array<{ path: string; reason: string }>;
}

export function summarizePlan(plan: AdoptPlan): AdoptSummaryJson {
  const summary: AdoptSummaryJson = { create: 0, refresh: 0, keep: 0, remove: 0, conflict: 0 };
  for (const action of plan.actions) summary[action.action] += 1;
  return summary;
}

export function planToJson(plan: AdoptPlan, opts: { verbose?: boolean }): AdoptPlanJson {
  const toJson = (a: AdoptAction): AdoptActionJson => ({
    path: a.path,
    action: a.action,
    reason: a.reason,
  });
  return {
    success: true,
    mode: "plan",
    workspacePath: plan.workspacePath,
    summary: summarizePlan(plan),
    actions: summarizeArray(plan.actions.map(toJson), opts),
    dirsCreated: summarizeArray(plan.dirs, opts),
    conflicts: plan.actions.filter((a) => a.action === "conflict").map(toJson),
  };
}

export function applyResultToJson(
  plan: AdoptPlan,
  result: AdoptApplyResult,
  opts: { verbose?: boolean },
): AdoptApplyJson {
  return {
    success: true,
    mode: "apply",
    workspacePath: result.workspacePath,
    summary: {
      create: result.created.length,
      refresh: result.refreshed.length,
      keep: result.kept.length,
      remove: result.removed.length,
      conflict: result.conflicts.length,
    },
    created: summarizeArray(result.created, opts),
    refreshed: summarizeArray(result.refreshed, opts),
    removed: summarizeArray(result.removed, opts),
    kept: summarizeArray(result.kept, opts),
    dirsCreated: summarizeArray(result.dirsCreated, opts),
    conflicts: result.conflicts,
  };
}
