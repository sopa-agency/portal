// Brain workspace access — multi-tenant safe.
//
// Each project is pinned to one OpenClaw agent (project.agent.id). That agent's
// "brain" lives in ~/.openclaw/workspace-<agentId>. These helpers resolve the
// workspace for the ACTIVE project only and refuse any path that escapes it or
// touches the `sessions` folder — so a tenant can never read another tenant's
// (or the global) files by passing a crafted path.
//
// Remote mode: when BRAIN_FILE_SERVICE_URL is set (e.g. on Vercel), all
// workspace operations are proxied to the brain-file-server running on minivlad
// via that URL, authenticated with BRAIN_FILE_SERVICE_SECRET. The secret is a
// server-to-server guard and is NEVER sent to the browser. When the env var is
// unset the existing local-fs behaviour is unchanged.

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

// Agent boot/identity files at the workspace ROOT. Deleting one of these breaks
// the agent (it can't bootstrap), so the portal refuses to delete them — they
// can still be edited. Matched by basename (case-insensitive) at root level
// only; a same-named file inside a folder (e.g. docs/MEMORY.md) is "soft" and
// stays deletable.
const PROTECTED_ROOT_BASENAMES = new Set(
  CORE_ORDER.map((n) => n.toLowerCase()),
);

/**
 * Whether a workspace-relative path is a protected boot file (root-level
 * SOUL.md / IDENTITY.md / USER.md / AGENTS.md / TOOLS.md / HEARTBEAT.md /
 * MEMORY.md / BOOTSTRAP.md). Used to block deletion across every transport.
 */
export function isProtectedBrainFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.includes("/")) return false; // only root-level boot files are protected
  return PROTECTED_ROOT_BASENAMES.has(norm.toLowerCase());
}

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

// ---------------------------------------------------------------------------
// Remote mode — used when BRAIN_FILE_SERVICE_URL is set (e.g. on Vercel).
// The secret is only sent in server-to-server calls; it never reaches the client.
// ---------------------------------------------------------------------------

const REMOTE_BASE_URL = process.env.BRAIN_FILE_SERVICE_URL
  ? process.env.BRAIN_FILE_SERVICE_URL.replace(/\/$/, "")
  : null;

const REMOTE_SECRET = process.env.BRAIN_FILE_SERVICE_SECRET ?? "";

const REMOTE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Queue mode — used when BRAIN_TRANSPORT=queue (default on Vercel). Vercel
// can't reach the brain-file-server over the Tailscale funnel (TLS handshake
// drops), so workspace ops are enqueued as BrainOpJob rows; the Mac
// brain-queue-worker relays them to the local server and writes the result
// back. Ops are local fs (fast), so this drains in well under a second.
// ---------------------------------------------------------------------------

function useBrainQueue(): boolean {
  const t = (process.env.BRAIN_TRANSPORT ?? "").trim();
  if (t === "queue") return true;
  if (t === "funnel" || t === "direct") return false;
  return !!process.env.VERCEL;
}

const BRAIN_QUEUE_TIMEOUT_MS = 30_000;

/** Enqueue a brain file-op and poll until the Mac worker fills in the result. */
async function brainOpViaQueue<T>(
  op: "tree" | "read" | "write" | "delete",
  agentId: string,
  relPath?: string,
  content?: string,
): Promise<T> {
  const { prisma } = await import("@/lib/prisma");
  const job = await prisma.brainOpJob.create({
    data: { op, agentId, relPath: relPath ?? null, content: content ?? null },
  });
  const deadline = Date.now() + BRAIN_QUEUE_TIMEOUT_MS;
  let delay = 400;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.3, 1_500);
    let row;
    try {
      row = await prisma.brainOpJob.findUnique({ where: { id: job.id } });
    } catch {
      continue;
    }
    if (!row) continue;
    if (row.status === "done") return JSON.parse(row.result ?? "null") as T;
    if (row.status === "error") throw new Error(row.error || "Brain op failed");
  }
  throw new Error("Brain file service request timed out");
}

/** Extract the agentId from a workspace path (`workspace-<agentId>`). */
function agentIdFromWorkspace(workspace: string): string {
  const base = path.basename(workspace);
  // base is "workspace-<agentId>"
  return base.replace(/^workspace-/, "");
}

/** Fetch helper for remote calls with secret header + timeout. */
async function remoteFetch(
  urlStr: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(urlStr, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "x-brain-secret": REMOTE_SECRET,
      },
    });
    return res;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Brain file service request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
  if (useBrainQueue()) {
    return brainOpViaQueue<BrainTree>("tree", agentIdFromWorkspace(workspace));
  }
  if (REMOTE_BASE_URL) {
    const agentId = agentIdFromWorkspace(workspace);
    const url = `${REMOTE_BASE_URL}/tree?agentId=${encodeURIComponent(agentId)}`;
    const res = await remoteFetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Brain file service error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { ok: boolean; tree: BrainTree; error?: string };
    if (!data.ok) throw new Error(data.error ?? "Brain file service returned ok:false");
    return data.tree;
  }

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

/**
 * Extract the workspace root from an absolute path that lives inside a
 * `workspace-<agentId>` directory. Returns null if the path doesn't match.
 */
function workspaceFromAbsPath(absPath: string): string | null {
  // Walk up from the file until we find a segment matching workspace-<id>.
  let p = absPath;
  while (true) {
    const parent = path.dirname(p);
    if (parent === p) return null; // reached fs root
    const base = path.basename(parent);
    if (/^workspace-[a-z0-9][a-z0-9-]{0,63}$/.test(base)) return parent;
    p = parent;
  }
}

export async function readBrainFile(absPath: string): Promise<BrainFile> {
  if (useBrainQueue()) {
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in queue mode");
    return brainOpViaQueue<BrainFile>("read", agentIdFromWorkspace(ws), path.relative(ws, absPath));
  }
  if (REMOTE_BASE_URL) {
    // Derive workspace and relative path from the absolute path so callers
    // don't need to change — absPath is always inside workspace-<agentId>.
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in remote mode");
    const agentId = agentIdFromWorkspace(ws);
    const rel = path.relative(ws, absPath);
    const url = `${REMOTE_BASE_URL}/file?agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(rel)}`;
    const res = await remoteFetch(url);
    if (res.status === 404) throw new Error("File not found");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Brain file service error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { ok: boolean; binary: boolean; content: string; error?: string };
    if (!data.ok) throw new Error(data.error ?? "Brain file service returned ok:false");
    return { binary: data.binary, content: data.content };
  }

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
  if (useBrainQueue()) {
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in queue mode");
    await brainOpViaQueue("write", agentIdFromWorkspace(ws), path.relative(ws, absPath), content);
    return;
  }
  if (REMOTE_BASE_URL) {
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in remote mode");
    const agentId = agentIdFromWorkspace(ws);
    const rel = path.relative(ws, absPath);
    const url = `${REMOTE_BASE_URL}/file`;
    const res = await remoteFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, path: rel, content }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const errData = (() => { try { return JSON.parse(body); } catch { return null; } })() as { error?: string } | null;
      throw new Error(errData?.error ?? `Brain file service error ${res.status}: ${body.slice(0, 200)}`);
    }
    return;
  }

  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("File too large to save.");
  }
  const stat = await fs.stat(absPath).catch(() => null);
  if (stat?.isDirectory()) throw new Error("Refusing to write over a directory.");
  await fs.writeFile(absPath, content, "utf8");
}

export async function deleteBrainFile(absPath: string): Promise<void> {
  // Authoritative guard — applies to every transport. Protected boot files can
  // be edited but never deleted, so the agent always keeps its bootstrap.
  const wsForGuard = workspaceFromAbsPath(absPath);
  if (wsForGuard && isProtectedBrainFile(path.relative(wsForGuard, absPath))) {
    throw new Error("This is a protected boot file and cannot be deleted.");
  }

  if (useBrainQueue()) {
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in queue mode");
    await brainOpViaQueue("delete", agentIdFromWorkspace(ws), path.relative(ws, absPath));
    return;
  }
  if (REMOTE_BASE_URL) {
    const ws = workspaceFromAbsPath(absPath);
    if (!ws) throw new Error("Cannot derive workspace from path in remote mode");
    const agentId = agentIdFromWorkspace(ws);
    const rel = path.relative(ws, absPath);
    const url = `${REMOTE_BASE_URL}/file?agentId=${encodeURIComponent(agentId)}&path=${encodeURIComponent(rel)}`;
    const res = await remoteFetch(url, { method: "DELETE" });
    if (res.status === 404) throw new Error("File not found.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const errData = (() => { try { return JSON.parse(body); } catch { return null; } })() as { error?: string } | null;
      throw new Error(errData?.error ?? `Brain file service error ${res.status}: ${body.slice(0, 200)}`);
    }
    return;
  }

  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) throw new Error("File not found.");
  if (stat.isDirectory()) throw new Error("Refusing to delete a directory.");
  await fs.unlink(absPath);
}
