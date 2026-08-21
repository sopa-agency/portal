#!/usr/bin/env node
// Brain File Server — runs on minivlad where ~/.openclaw/workspace-* live.
//
// Purpose : Exposes the agent brain workspace files over HTTP so that the
//           portal (running on Vercel, serverless, no local FS) can read,
//           write, and delete agent workspace files through this service.
//
// Deployment notes:
//   - Runs on minivlad only (the machine that has ~/.openclaw/).
//   - Bind address: 127.0.0.1 only. NEVER exposed directly to the internet.
//   - Exposed externally via Tailscale Funnel at path /brain-fs → 127.0.0.1:18790.
//     Configure the funnel to prefix-strip /brain-fs before forwarding, or
//     add the prefix in BRAIN_FILE_SERVICE_URL on the Vercel side.
//   - Requires env var BRAIN_FILE_SERVICE_SECRET (shared secret).
//     The portal sets BRAIN_FILE_SERVICE_URL (the funnel URL) and
//     BRAIN_FILE_SERVICE_SECRET (the same shared secret).
//   - Start with pm2:  pm2 start scripts/brain-file-server.js --name brain-file-server
//   - Or: npm run worker:brain-file-server
//
// Security:
//   - Every request (except GET /health) requires header x-brain-secret.
//   - agentId validated against ^[a-z0-9][a-z0-9-]{0,63}$.
//   - Path safety mirrors brain-workspace.ts exactly (no traversal, no dot-dirs,
//     no sessions folder, same exclusions).
//   - Request body capped at 2 MB.
//   - File reads capped at 1 MB (same as brain-workspace.ts MAX_FILE_BYTES).

"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { Readable } = require("node:stream");

// Load .env.local / .env.development / .env — same pattern as other workers.
for (const f of [".env.local", ".env.development", ".env"]) {
  try {
    require("dotenv").config({ path: path.join(__dirname, "..", f), override: false });
  } catch {}
}

// ---------------------------------------------------------------------------
// Config / startup validation
// ---------------------------------------------------------------------------

const PORT = Number(process.env.BRAIN_FILE_SERVICE_PORT ?? 18790);
const HOST = "127.0.0.1";
const SECRET = process.env.BRAIN_FILE_SERVICE_SECRET;

if (!SECRET || !SECRET.trim()) {
  process.stderr.write(
    "[brain-file-server] FATAL: BRAIN_FILE_SERVICE_SECRET is not set.\n" +
      "Set it in .env.local before starting this service.\n",
  );
  process.exit(1);
}

const OPENCLAW_DIR = path.join(os.homedir(), ".openclaw");

// ---------------------------------------------------------------------------
// Safety constants — MUST match brain-workspace.ts exactly
// ---------------------------------------------------------------------------

const EXCLUDED_FOLDERS = new Set(["sessions"]);

const NOISE_NAMES = new Set([
  ".DS_Store",
  ".AppleDouble",
  ".LSOverride",
  ".Spotlight-V100",
  ".TemporaryItems",
  ".Trashes",
]);

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

const MAX_FILE_BYTES = 1_000_000; // 1 MB — matches brain-workspace.ts
const MAX_BODY_BYTES = 2_000_000; // 2 MB request body cap

const PINNED_BASENAMES = new Set(["playbook.md"]);

// Root-level agent boot files — editable but never deletable (deleting one
// breaks the agent's bootstrap). Mirrors isProtectedBrainFile() in
// brain-workspace.ts. Defense-in-depth: the portal blocks these too.
const PROTECTED_ROOT_BASENAMES = new Set(
  CORE_ORDER.map((n) => n.toLowerCase()),
);

function isProtectedBrainFile(relPath) {
  const norm = String(relPath).replace(/\\/g, "/");
  if (norm.includes("/")) return false;
  return PROTECTED_ROOT_BASENAMES.has(norm.toLowerCase());
}

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp", ".tif", ".tiff",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".mp4", ".mov", ".mp3", ".wav", ".woff", ".woff2", ".ttf",
]);

// agentId whitelist: same format as OpenClaw agent ids.
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Media proxy (/media) — PUBLIC, CORS-enabled, Range-passthrough IPFS proxy.
//
// This offloads the portal's same-origin video/image proxies (previously
// /api/studio/video-proxy + /api/brain/image-proxy on Vercel) so no media
// bytes stream through Vercel's bandwidth. The content is already public IPFS,
// so this needs no shared secret — but it IS strictly host-whitelisted to
// known IPFS gateways (no arbitrary-URL SSRF) and only proxies GET/HEAD.
//
// Exposed via Tailscale Funnel at /media → 127.0.0.1:18790 (funnel strips the
// /media prefix, so the dispatcher keys on the presence of ?url= instead of a
// fixed pathname). CORS is "*" (safe: anonymous, credential-less reads of
// already-public content) so the editor canvas doesn't taint.
// ---------------------------------------------------------------------------

const MEDIA_HOSTS = new Set([
  "ipfs.skatehive.app",
  "gateway.pinata.cloud",
  "magic.decentralized-content.com",
  "ipfs.io",
  "cloudflare-ipfs.com",
  "w3s.link",
]);

// Fallback chain (matches lib/ipfs.ts): if the requested gateway 4xx/5xx/errors
// on an /ipfs/<cid> URL, retry the same CID+path through these in order.
const MEDIA_GATEWAYS = [
  "https://magic.decentralized-content.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

const MEDIA_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function isMediaHostAllowed(hostname) {
  return MEDIA_HOSTS.has(hostname) || hostname.endsWith(".mypinata.cloud");
}

// Everything after "/ipfs/" in a gateway URL — the CID plus any sub-path.
function ipfsPathFrom(parsed) {
  const m = parsed.pathname.match(/\/ipfs\/(.+)$/);
  return m ? m[1] + parsed.search : null;
}

// ---------------------------------------------------------------------------
// Safety helpers — ported 1:1 from brain-workspace.ts
// ---------------------------------------------------------------------------

function isEnvFile(name) {
  return name === ".env" || /^\.env(\..+)?$/.test(name);
}

function isHidden(name) {
  return NOISE_NAMES.has(name) || name.startsWith(".");
}

function isDisplayableFile(name) {
  if (isEnvFile(name)) return false;
  return !IMAGE_EXTS.has(path.extname(name).toLowerCase());
}

/**
 * Resolve a client-supplied relative path against the workspace, returning the
 * absolute path ONLY if it stays inside the workspace and is not under an
 * excluded folder. Returns null on any traversal / excluded attempt.
 * Mirrors resolveSafePath() in brain-workspace.ts exactly.
 */
function resolveSafePath(workspace, relInput) {
  if (!relInput || typeof relInput !== "string") return null;
  if (relInput.startsWith("/") || relInput.includes("\0")) return null;

  const wsRoot = path.resolve(workspace);
  const full = path.resolve(wsRoot, relInput);
  if (full !== wsRoot && !full.startsWith(wsRoot + path.sep)) return null;

  const relNorm = path.relative(wsRoot, full);
  const firstSegment = relNorm.split(path.sep)[0];
  if (EXCLUDED_FOLDERS.has(firstSegment) || firstSegment.startsWith(".")) return null;

  return full;
}

function listRecursive(dir, prefix) {
  prefix = prefix ?? "";
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile()) {
      if (!isDisplayableFile(entry.name)) continue;
      out.push(rel);
    } else if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      out.push(...listRecursive(path.join(dir, entry.name), rel));
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "en"));
}

function buildBrainTree(workspace) {
  const core = [];
  const folders = {};
  let entries;
  try {
    entries = fs.readdirSync(workspace, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    if (entry.isFile()) {
      if (!isDisplayableFile(entry.name)) continue;
      core.push(entry.name);
    } else if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || EXCLUDED_FOLDERS.has(entry.name)) continue;
      folders[entry.name] = listRecursive(path.join(workspace, entry.name));
    }
  }

  core.sort((a, b) => {
    const ai = CORE_ORDER.indexOf(a);
    const bi = CORE_ORDER.indexOf(b);
    const av = ai === -1 ? 999 : ai;
    const bv = bi === -1 ? 999 : bi;
    return av - bv || a.localeCompare(b, "en");
  });

  const pinned = [];
  for (const [folder, files] of Object.entries(folders)) {
    const keep = [];
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

// ---------------------------------------------------------------------------
// Request body reader (with cap)
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

function log(method, urlPath, agentId, status) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  process.stdout.write(`[${ts}] brain-file-server: ${method} ${urlPath} agent=${agentId ?? "-"} -> ${status}\n`);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHealth(req, res) {
  send(res, 200, { ok: true });
  log(req.method, "/health", null, 200);
}

function handleTree(req, res, url, agentId) {
  const workspace = path.join(OPENCLAW_DIR, `workspace-${agentId}`);
  const tree = buildBrainTree(workspace);
  send(res, 200, { ok: true, tree });
  log(req.method, url.pathname, agentId, 200);
}

async function handleFileGet(req, res, url, agentId) {
  const relPath = url.searchParams.get("path") ?? "";
  const workspace = path.join(OPENCLAW_DIR, `workspace-${agentId}`);
  const abs = resolveSafePath(workspace, relPath);
  if (!abs) {
    send(res, 400, { ok: false, error: "Invalid path" });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    send(res, 404, { ok: false, error: "File not found" });
    log(req.method, url.pathname, agentId, 404);
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    send(res, 200, { ok: true, binary: true, content: `(binary ${ext} file — preview unavailable)` });
    log(req.method, url.pathname, agentId, 200);
    return;
  }
  if (stat.size > MAX_FILE_BYTES) {
    send(res, 200, {
      ok: true,
      binary: true,
      content: `(file too large to preview: ${(stat.size / 1024).toFixed(0)} KB)`,
    });
    log(req.method, url.pathname, agentId, 200);
    return;
  }

  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (err) {
    send(res, 500, { ok: false, error: err.message });
    log(req.method, url.pathname, agentId, 500);
    return;
  }

  // Heuristic: NUL byte in first 8 KB → binary.
  if (buf.subarray(0, 8192).includes(0)) {
    send(res, 200, { ok: true, binary: true, content: "(binary file — preview unavailable)" });
    log(req.method, url.pathname, agentId, 200);
    return;
  }

  send(res, 200, { ok: true, binary: false, content: buf.toString("utf8") });
  log(req.method, url.pathname, agentId, 200);
}

async function handleFilePut(req, res, url) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    send(res, 400, { ok: false, error: "Invalid JSON body" });
    log(req.method, url.pathname, null, 400);
    return;
  }

  const agentId = typeof body?.agentId === "string" ? body.agentId : "";
  if (!AGENT_ID_RE.test(agentId)) {
    send(res, 400, { ok: false, error: "Invalid agentId" });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  const relPath = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : null;
  if (content === null) {
    send(res, 400, { ok: false, error: "Missing content" });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    send(res, 400, { ok: false, error: "File too large to save." });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  const workspace = path.join(OPENCLAW_DIR, `workspace-${agentId}`);
  const abs = resolveSafePath(workspace, relPath);
  if (!abs) {
    send(res, 400, { ok: false, error: "Invalid path" });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  // Refuse to write over a directory.
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    send(res, 400, { ok: false, error: "Refusing to write over a directory." });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  try {
    fs.writeFileSync(abs, content, "utf8");
  } catch (err) {
    send(res, 500, { ok: false, error: err.message });
    log(req.method, url.pathname, agentId, 500);
    return;
  }

  send(res, 200, { ok: true });
  log(req.method, url.pathname, agentId, 200);
}

async function handleFileDelete(req, res, url, agentId) {
  const relPath = url.searchParams.get("path") ?? "";
  const workspace = path.join(OPENCLAW_DIR, `workspace-${agentId}`);
  const abs = resolveSafePath(workspace, relPath);
  if (!abs) {
    send(res, 400, { ok: false, error: "Invalid path" });
    log(req.method, url.pathname, agentId, 400);
    return;
  }
  if (isProtectedBrainFile(relPath)) {
    send(res, 403, { ok: false, error: "This is a protected boot file and cannot be deleted." });
    log(req.method, url.pathname, agentId, 403);
    return;
  }

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    send(res, 404, { ok: false, error: "File not found." });
    log(req.method, url.pathname, agentId, 404);
    return;
  }
  if (stat.isDirectory()) {
    send(res, 400, { ok: false, error: "Refusing to delete a directory." });
    log(req.method, url.pathname, agentId, 400);
    return;
  }

  try {
    fs.unlinkSync(abs);
  } catch (err) {
    send(res, 500, { ok: false, error: err.message });
    log(req.method, url.pathname, agentId, 500);
    return;
  }

  send(res, 200, { ok: true });
  log(req.method, url.pathname, agentId, 200);
}

async function handleMedia(req, res, url) {
  // Preflight — media elements with crossOrigin="anonymous" usually skip this,
  // but answer it anyway so a fetch() with a Range header works too.
  if (req.method === "OPTIONS") {
    res.writeHead(204, MEDIA_CORS);
    res.end();
    log(req.method, "/media", null, 204);
    return;
  }

  const target = url.searchParams.get("url");
  if (!target) {
    res.writeHead(400, { ...MEDIA_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "url required" }));
    log(req.method, "/media", null, 400);
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400, { ...MEDIA_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid url" }));
    log(req.method, "/media", null, 400);
    return;
  }

  if (parsed.protocol !== "https:" || !isMediaHostAllowed(parsed.hostname)) {
    res.writeHead(400, { ...MEDIA_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "host not allowed" }));
    log(req.method, "/media", null, 400);
    return;
  }

  // Try the requested URL first, then the gateway fallback chain by CID+path.
  const tries = [parsed.toString()];
  const ipfsPath = ipfsPathFrom(parsed);
  if (ipfsPath) {
    for (const g of MEDIA_GATEWAYS) {
      const alt = g + ipfsPath;
      if (!tries.includes(alt)) tries.push(alt);
    }
  }

  const range = req.headers["range"];
  let upstream = null;
  let lastStatus = 0;
  for (const t of tries) {
    try {
      const r = await fetch(t, {
        headers: range ? { range } : undefined,
        cache: "no-store",
      });
      if (r.ok || r.status === 206) {
        upstream = r;
        break;
      }
      lastStatus = r.status;
    } catch {
      lastStatus = 502;
    }
  }

  if (!upstream) {
    res.writeHead(502, { ...MEDIA_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `upstream ${lastStatus}` }));
    log(req.method, "/media", null, 502);
    return;
  }

  const outHeaders = { ...MEDIA_CORS };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  if (!outHeaders["content-type"]) outHeaders["content-type"] = "application/octet-stream";
  // IPFS is content-addressed — bytes behind a CID never change; cache hard.
  outHeaders["cache-control"] = "public, max-age=31536000, immutable";

  res.writeHead(upstream.status, outHeaders);
  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    log(req.method, "/media", null, upstream.status);
    return;
  }
  res.on("finish", () => log(req.method, "/media", null, upstream.status));
  Readable.fromWeb(upstream.body).pipe(res);
}

// ---------------------------------------------------------------------------
// Main request dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  // Parse URL (host is irrelevant here; just need pathname + searchParams).
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    send(res, 400, { ok: false, error: "Bad request URL" });
    return;
  }

  const pathname = url.pathname;

  // Health check — no secret required.
  if (req.method === "GET" && pathname === "/health") {
    handleHealth(req, res);
    return;
  }

  // Media proxy — PUBLIC (no secret), keyed on the ?url= param rather than a
  // fixed pathname because Tailscale Funnel strips the /media mount prefix
  // before forwarding. SSRF-safe: handleMedia host-whitelists to IPFS gateways.
  if (
    (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") &&
    url.searchParams.has("url")
  ) {
    await handleMedia(req, res, url);
    return;
  }

  // All other routes require the shared secret.
  const suppliedSecret = req.headers["x-brain-secret"];
  if (!suppliedSecret || suppliedSecret !== SECRET) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    log(req.method, pathname, null, 401);
    return;
  }

  // For GET/DELETE routes, agentId comes from the query string.
  // For PUT it comes from the body (parsed inside the handler).
  let agentId = null;
  if (req.method !== "PUT" || pathname !== "/file") {
    agentId = url.searchParams.get("agentId") ?? "";
    if (!AGENT_ID_RE.test(agentId)) {
      send(res, 400, { ok: false, error: "Invalid agentId" });
      log(req.method, pathname, agentId, 400);
      return;
    }
  }

  if (req.method === "GET" && pathname === "/tree") {
    handleTree(req, res, url, agentId);
    return;
  }

  if (req.method === "GET" && pathname === "/file") {
    await handleFileGet(req, res, url, agentId);
    return;
  }

  if (req.method === "PUT" && pathname === "/file") {
    await handleFilePut(req, res, url);
    return;
  }

  if (req.method === "DELETE" && pathname === "/file") {
    await handleFileDelete(req, res, url, agentId);
    return;
  }

  send(res, 404, { ok: false, error: "Not found" });
  log(req.method, pathname, agentId, 404);
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    process.stderr.write(`[${ts}] brain-file-server: unhandled error: ${err?.message ?? err}\n`);
    try {
      send(res, 500, { ok: false, error: "Internal server error" });
    } catch {}
  });
});

server.listen(PORT, HOST, () => {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  process.stdout.write(`[${ts}] brain-file-server: listening on ${HOST}:${PORT}\n`);
});

server.on("error", (err) => {
  process.stderr.write(`[brain-file-server] Server error: ${err.message}\n`);
  process.exit(1);
});
