// Brain workspace access — multi-tenant safe.
//
// Each project is pinned to one OpenClaw agent (project.agent.id). That agent's
// "brain" lives in ~/.openclaw/workspace-<agentId>. These helpers resolve the
// workspace for the ACTIVE project only and refuse any path that escapes it or
// touches the `sessions` folder — so a tenant can never read another tenant's
// (or the global) files by passing a crafted path.

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { ProjectConfig } from "@/projects/types";

const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");

// Folders we never expose in the portal brain (per product decision).
const EXCLUDED_FOLDERS = new Set(["sessions"]);

const NOISE_NAMES = new Set([
  ".DS_Store",
  ".AppleDouble",
  ".LSOverride",
  ".Spotlight-V100",
  ".TemporaryItems",
  ".Trashes",
]);

// Root files surfaced first, in this order, when present.
const CORE_ORDER = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "BOOTSTRAP.md",
];

const MAX_FILE_BYTES = 1_000_000; // 1MB cap on previews/edits

// Files that, even when they live inside a folder, are surfaced at the TOP of
// the selector alongside the core boot files (matched by basename, case-insensitive).
const PINNED_BASENAMES = new Set(["playbook.md"]);

export type BrainTree = {
  /** Important files pulled to the top (e.g. docs/playbook.md). Full relative paths. */
  pinned: string[];
  /** Regular files at the workspace root. */
  core: string[];
  /** Subfolder -> recursive relative file paths (excludes `sessions`). */
  folders: Record<string, string[]>;
};

// Files we never surface in the tree: env files (secrets) and images.
const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp", ".tif", ".tiff",
]);

function isEnvFile(name: string): boolean {
  return name === ".env" || /^\.env(\..+)?$/.test(name);
}

function isHidden(name: string): boolean {
  // Hide OS noise and ALL dot-entries (.env, .openclaw, .DS_Store, .git, …).
  return NOISE_NAMES.has(name) || name.startsWith(".");
}

/** Whether a file should appear in the brain tree (excludes env files + images). */
function isDisplayableFile(name: string): boolean {
  if (isEnvFile(name)) return false;
  return !IMAGE_EXTS.has(path.extname(name).toLowerCase());
}

/** Absolute workspace dir for the active project's agent. */
export function workspaceForProject(project: ProjectConfig): string {
  return path.join(OPENCLAW_DIR, `workspace-${project.agent.id}`);
}

async function listRecursive(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile()) {
      if (!isDisplayableFile(entry.name)) continue;
      out.push(rel);
    } else if (entry.isDirectory()) {
      // Skip dot-directories (e.g. .openclaw with its workspace-state.json).
      if (entry.name.startsWith(".")) continue;
      out.push(...(await listRecursive(path.join(dir, entry.name), rel)));
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

export async function buildBrainTree(workspace: string): Promise<BrainTree> {
  const core: string[] = [];
  const folders: Record<string, string[]> = {};
  const entries = await fs.readdir(workspace, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    if (entry.isFile()) {
      if (!isDisplayableFile(entry.name)) continue;
      core.push(entry.name);
    } else if (entry.isDirectory()) {
      // Hide `sessions` (product decision) and any dot-directory such as
      // `.openclaw` (holds workspace-state.json and other internal state).
      if (entry.name.startsWith(".") || EXCLUDED_FOLDERS.has(entry.name)) continue;
      folders[entry.name] = await listRecursive(path.join(workspace, entry.name));
    }
  }

  core.sort((a, b) => {
    const ai = CORE_ORDER.indexOf(a);
    const bi = CORE_ORDER.indexOf(b);
    const av = ai === -1 ? 999 : ai;
    const bv = bi === -1 ? 999 : bi;
    return av - bv || a.localeCompare(b, "en");
  });

  // Pull pinned files (e.g. docs/playbook.md) out of their folder and surface
  // them at the top. They remain editable; they just don't double-list.
  const pinned: string[] = [];
  for (const [folder, files] of Object.entries(folders)) {
    const keep: string[] = [];
    for (const f of files) {
      const base = (f.split("/").pop() ?? "").toLowerCase();
      if (PINNED_BASENAMES.has(base)) pinned.push(`${folder}/${f}`);
      else keep.push(f);
    }
    folders[folder] = keep;
  }
  pinned.sort((a, b) => a.localeCompare(b, "en"));

  return { pinned, core, folders };
}

/**
 * Resolve a client-supplied relative path against the workspace, returning the
 * absolute path only if it stays inside the workspace and is not under an
 * excluded folder. Returns null on any traversal/excluded attempt.
 */
export function resolveSafePath(workspace: string, relInput: string): string | null {
  if (!relInput || typeof relInput !== "string") return null;
  // Reject absolute paths and obvious traversal up front.
  if (relInput.startsWith("/") || relInput.includes("\0")) return null;

  const wsRoot = path.resolve(workspace);
  const full = path.resolve(wsRoot, relInput);
  if (full !== wsRoot && !full.startsWith(wsRoot + path.sep)) return null;

  const relNorm = path.relative(wsRoot, full);
  const firstSegment = relNorm.split(path.sep)[0];
  // Block excluded folders and any dot-directory (e.g. .openclaw).
  if (EXCLUDED_FOLDERS.has(firstSegment) || firstSegment.startsWith(".")) return null;

  return full;
}

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".mp4", ".mov", ".mp3", ".wav", ".woff", ".woff2", ".ttf",
]);

export type BrainFile =
  | { binary: true; content: string }
  | { binary: false; content: string };

export async function readBrainFile(absPath: string): Promise<BrainFile> {
  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return { binary: true, content: `(binary ${ext} file — preview unavailable)` };
  }
  const stat = await fs.stat(absPath);
  if (stat.size > MAX_FILE_BYTES) {
    return { binary: true, content: `(file too large to preview: ${(stat.size / 1024).toFixed(0)} KB)` };
  }
  const buf = await fs.readFile(absPath);
  // Heuristic: a NUL byte in the first 8KB means binary.
  if (buf.subarray(0, 8192).includes(0)) {
    return { binary: true, content: "(binary file — preview unavailable)" };
  }
  return { binary: false, content: buf.toString("utf8") };
}

export async function writeBrainFile(absPath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("File too large to save.");
  }
  const stat = await fs.stat(absPath).catch(() => null);
  if (stat?.isDirectory()) throw new Error("Refusing to write over a directory.");
  await fs.writeFile(absPath, content, "utf8");
}

export async function deleteBrainFile(absPath: string): Promise<void> {
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) throw new Error("File not found.");
  if (stat.isDirectory()) throw new Error("Refusing to delete a directory.");
  await fs.unlink(absPath);
}
