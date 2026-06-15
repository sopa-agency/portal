#!/usr/bin/env node
// Briefing worker for multi-tenant-portal.
// The portal (Vercel) can't reach the agent gateway over the Tailscale funnel
// (TLS handshake drops), so it enqueues BriefingJob rows with the full prompt
// already assembled. This worker runs on the Mac mini — where the gateway is
// a local 127.0.0.1 call that always works — picks up queued jobs, runs them,
// and writes the result into Briefing. Run: npm run worker:briefing
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

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
const STALE_LOCK_MS = Number(process.env.WORKER_STALE_LOCK_MS ?? 10 * 60_000);
// Always use the LOCAL gateway here — that's the whole point of this worker.
const GATEWAY_URL = process.env.BRIEFING_GATEWAY_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");
const TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 285_000);

const prisma = new PrismaClient({ log: ["error"] });

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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

async function callAgent(input, agentId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
    if (err?.name === "AbortError") throw new Error(`OpenClaw timed out after ${TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function claimJob() {
  // Reclaim stale running locks first.
  await prisma.briefingJob.updateMany({
    where: { status: "running", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "queued", lockedAt: null },
  });
  const job = await prisma.briefingJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;
  // Atomic claim: only succeed if still queued.
  const claimed = await prisma.briefingJob.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "running", lockedAt: new Date() },
  });
  if (claimed.count === 0) return null; // raced another worker
  return job;
}

async function processJob(job) {
  console.log(`[briefing-worker] running ${job.agentSlug} (${job.projectSlug}) job ${job.id}`);
  try {
    const text = await callAgent(job.prompt, job.agentSlug);
    const date = todayIsoDate();
    await prisma.briefing.upsert({
      where: { agentSlug_date: { agentSlug: job.agentSlug, date } },
      create: {
        agentSlug: job.agentSlug,
        date,
        language: job.language,
        body: text,
        generatedBy: "manual",
      },
      update: { body: text, language: job.language, generatedBy: "manual", generatedAt: new Date() },
    });
    await prisma.briefingJob.update({ where: { id: job.id }, data: { status: "done" } });
    console.log(`[briefing-worker] done ${job.agentSlug} job ${job.id} (${text.length} chars)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[briefing-worker] FAILED ${job.agentSlug} job ${job.id}: ${msg}`);
    await prisma.briefingJob
      .update({ where: { id: job.id }, data: { status: "error", error: msg.slice(0, 500) } })
      .catch(() => {});
  }
}

const CONCURRENCY = Number(process.env.BRIEFING_WORKER_CONCURRENCY ?? 3);
let active = 0;

async function loop() {
  console.log(
    `[briefing-worker] up — gateway ${GATEWAY_URL}, poll ${POLL_INTERVAL_MS}ms, concurrency ${CONCURRENCY}`,
  );
  for (;;) {
    try {
      // Claim up to CONCURRENCY jobs and run them in parallel so a project's
      // multiple agents (e.g. SkateHive dev + marketing) don't serialize.
      while (active < CONCURRENCY) {
        const job = await claimJob();
        if (!job) break;
        active++;
        processJob(job).finally(() => {
          active--;
        });
      }
    } catch (err) {
      console.error("[briefing-worker] loop error:", err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

loop();
