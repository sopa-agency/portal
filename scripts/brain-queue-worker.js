#!/usr/bin/env node
// Brain op-queue worker for multi-tenant-portal.
// Vercel can't reach the brain-file-server over the Tailscale funnel (TLS
// handshake drops), so the Brain page on Vercel enqueues BrainOpJob rows. This
// worker runs on the Mac mini and relays each op to the LOCAL brain-file-server
// (127.0.0.1:18790, which always works), then writes the JSON response back
// into BrainOpJob.result. Run: npm run worker:brain-queue
"use strict";

const path = require("node:path");

for (const f of [".env.local", ".env.development", ".env"]) {
  try {
    require("dotenv").config({ path: path.join(__dirname, "..", f), override: false });
  } catch {}
}

const { PrismaClient } = require("@prisma/client");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1_000);
const STALE_LOCK_MS = Number(process.env.WORKER_STALE_LOCK_MS ?? 60_000);
const CONCURRENCY = Number(process.env.BRAIN_WORKER_CONCURRENCY ?? 4);
const PORT = Number(process.env.BRAIN_FILE_SERVICE_PORT ?? 18790);
const LOCAL_BASE = process.env.BRAIN_LOCAL_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const SECRET = process.env.BRAIN_FILE_SERVICE_SECRET;
const REQUEST_TIMEOUT_MS = Number(process.env.BRAIN_REQUEST_TIMEOUT_MS ?? 15_000);

if (!SECRET || !SECRET.trim()) {
  process.stderr.write("[brain-queue-worker] FATAL: BRAIN_FILE_SERVICE_SECRET is not set.\n");
  process.exit(1);
}

const prisma = new PrismaClient({ log: ["error"] });

async function localFetch(pathAndQuery, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${LOCAL_BASE}${pathAndQuery}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.headers ?? {}), "x-brain-secret": SECRET },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Relay one op to the local brain-file-server. Returns the JSON payload to
// store in BrainOpJob.result (the meaningful part the portal expects back).
async function runOp(job) {
  const a = encodeURIComponent(job.agentId);
  const p = encodeURIComponent(job.relPath ?? "");
  switch (job.op) {
    case "tree": {
      const res = await localFetch(`/tree?agentId=${a}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `tree failed (${res.status})`);
      return data.tree;
    }
    case "read": {
      const res = await localFetch(`/file?agentId=${a}&path=${p}`);
      if (res.status === 404) throw new Error("File not found");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `read failed (${res.status})`);
      return { binary: data.binary, content: data.content };
    }
    case "write": {
      const res = await localFetch(`/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: job.agentId, path: job.relPath ?? "", content: job.content ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? `write failed (${res.status})`);
      return { ok: true };
    }
    case "delete": {
      const res = await localFetch(`/file?agentId=${a}&path=${p}`, { method: "DELETE" });
      if (res.status === 404) throw new Error("File not found.");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? `delete failed (${res.status})`);
      return { ok: true };
    }
    default:
      throw new Error(`Unknown op: ${job.op}`);
  }
}

async function claimJob() {
  await prisma.brainOpJob.updateMany({
    where: { status: "running", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "queued", lockedAt: null },
  });
  const job = await prisma.brainOpJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;
  const claimed = await prisma.brainOpJob.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "running", lockedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  return job;
}

async function processJob(job) {
  try {
    const payload = await runOp(job);
    await prisma.brainOpJob.update({
      where: { id: job.id },
      data: { status: "done", result: JSON.stringify(payload ?? null) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[brain-queue-worker] FAILED ${job.op} ${job.agentId} ${job.relPath ?? ""}: ${msg}`);
    await prisma.brainOpJob
      .update({ where: { id: job.id }, data: { status: "error", error: msg.slice(0, 500) } })
      .catch(() => {});
  }
}

let active = 0;

async function loop() {
  console.log(`[brain-queue-worker] up — local ${LOCAL_BASE}, poll ${POLL_INTERVAL_MS}ms, concurrency ${CONCURRENCY}`);
  for (;;) {
    try {
      while (active < CONCURRENCY) {
        const job = await claimJob();
        if (!job) break;
        active++;
        processJob(job).finally(() => {
          active--;
        });
      }
    } catch (err) {
      console.error("[brain-queue-worker] loop error:", err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
