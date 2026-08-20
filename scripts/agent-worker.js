#!/usr/bin/env node
// Generic agent-call worker for multi-tenant-portal.
// Vercel can't reach the agent gateway over the Tailscale funnel (TLS handshake
// drops), so callOpenClaw() on Vercel enqueues an AgentJob with the prompt and
// waits. This worker runs on the Mac mini — where the gateway is a local
// 127.0.0.1 call that always works — picks up queued jobs, runs them, and writes
// the reply into AgentJob.result. This backs Take Action, Improve prompt, kanban
// AI, campaigns, analytics insights, post-creator, etc. Run: npm run worker:agent
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

for (const f of [".env.local", ".env.development", ".env"]) {
  try {
    require("dotenv").config({ path: path.join(__dirname, "..", f), override: false });
  } catch {}
}

const { PrismaClient } = require("@prisma/client");

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2_000);
const STALE_LOCK_MS = Number(process.env.WORKER_STALE_LOCK_MS ?? 10 * 60_000);
// Always use the LOCAL gateway here — that's the whole point of this worker.
const GATEWAY_URL = process.env.AGENT_GATEWAY_URL ?? process.env.BRIEFING_GATEWAY_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");
const CONCURRENCY = Number(process.env.AGENT_WORKER_CONCURRENCY ?? 4);

const prisma = new PrismaClient({ log: ["error"] });

function loadGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  if (process.env.GATEWAY_TOKEN) return process.env.GATEWAY_TOKEN;
  let raw;
  try {
    raw = fs.readFileSync(OPENCLAW_ENV_FILE, "utf8");
  } catch (err) {
    throw new Error(`Cannot read OpenClaw env file at ${OPENCLAW_ENV_FILE}: ${err.message}`);
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    let val = m[1];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  throw new Error("GATEWAY_TOKEN not found");
}

const GATEWAY_TOKEN = loadGatewayToken();

function extractOutputText(payload) {
  const parts = [];
  for (const item of payload?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

// A long agent request (heavy/code tasks) can drop its connection mid-flight —
// surfaces as a bare "fetch failed" / ECONNRESET, not an HTTP status. That's a
// transport blip, not a real failure, so retry it once. We do NOT retry on a
// real timeout (AbortError) or an HTTP error body — those are terminal.
function isTransientFetchError(err) {
  if (err?.name === "AbortError") return false;
  const msg = String(err?.message ?? err);
  const code = String(err?.cause?.code ?? "");
  return (
    /fetch failed|terminated|socket hang up|network|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR/i.test(
      msg + " " + code,
    )
  );
}

async function callAgentOnce(input, agentId, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GATEWAY_URL.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: `openclaw/${agentId}`, input }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenClaw HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const text = extractOutputText(await res.json());
    if (!text) throw new Error("OpenClaw returned an empty response");
    return text;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`OpenClaw timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callAgent(input, agentId, timeoutMs) {
  try {
    return await callAgentOnce(input, agentId, timeoutMs);
  } catch (err) {
    if (!isTransientFetchError(err)) throw err;
    console.warn(`[agent-worker] transient gateway error (${err?.message}); retrying once`);
    await new Promise((r) => setTimeout(r, 2_000));
    return await callAgentOnce(input, agentId, timeoutMs);
  }
}

async function claimJob() {
  // Reclaim stale running locks first.
  await prisma.agentJob.updateMany({
    where: { status: "running", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "queued", lockedAt: null },
  });
  const job = await prisma.agentJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;
  // Atomic claim: only succeed if still queued.
  const claimed = await prisma.agentJob.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "running", lockedAt: new Date() },
  });
  if (claimed.count === 0) return null; // raced another worker
  return job;
}

async function processJob(job) {
  console.log(`[agent-worker] running ${job.agentSlug} job ${job.id}`);
  // Heartbeat: refresh lockedAt every 60s so a long heavy job (up to ~20min)
  // isn't seen as a stale lock (STALE_LOCK_MS) and re-claimed/double-run while
  // it's actively working. A truly dead worker stops refreshing → reclaimed.
  const heartbeat = setInterval(() => {
    prisma.agentJob
      .updateMany({ where: { id: job.id, status: "running" }, data: { lockedAt: new Date() } })
      .catch(() => {});
  }, 60_000);
  try {
    const text = await callAgent(job.prompt, job.agentSlug, job.timeoutMs ?? 285_000);
    await prisma.agentJob.update({
      where: { id: job.id },
      data: { status: "done", result: text },
    });
    console.log(`[agent-worker] done ${job.agentSlug} job ${job.id} (${text.length} chars)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent-worker] FAILED ${job.agentSlug} job ${job.id}: ${msg}`);
    await prisma.agentJob
      .update({ where: { id: job.id }, data: { status: "error", error: msg.slice(0, 500) } })
      .catch(() => {});
  } finally {
    clearInterval(heartbeat);
  }
}

let active = 0;

async function loop() {
  console.log(`[agent-worker] up — gateway ${GATEWAY_URL}, poll ${POLL_INTERVAL_MS}ms, concurrency ${CONCURRENCY}`);
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
      console.error("[agent-worker] loop error:", err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
