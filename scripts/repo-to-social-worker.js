#!/usr/bin/env node
// Repo-to-Social worker for portal-skatehive.
// Polls the DB for manually-enqueued runs and asks the local OpenClaw gateway's
// `skatehive-marketing` agent to turn commits into tweet drafts.
//
// Run: npm run worker:repo-to-social

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

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 10_000);
const STALE_LOCK_MS = Number(process.env.WORKER_STALE_LOCK_MS ?? 10 * 60_000);
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID ?? "skatehive-marketing";
const OPENCLAW_ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");
const OPENCLAW_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 120_000);
const SCHEDULER_BASE_URL = process.env.SCHEDULER_BASE_URL ?? "http://localhost:3030";
const SCHEDULER_SECRET = process.env.SCHEDULER_TICK_SECRET;

const prisma = new PrismaClient({ log: ["error"] });

// ---------------------------------------------------------------------------
// Tweet generation — calls the local OpenClaw gateway's skatehive-marketing
// agent via its OpenResponses-compatible HTTP endpoint.
// ---------------------------------------------------------------------------

// Resolves GATEWAY_TOKEN at process start so we surface a clear error before
// claiming any run, instead of failing mid-job.
function loadGatewayToken() {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) return process.env.OPENCLAW_GATEWAY_TOKEN;
  let raw;
  try {
    raw = fs.readFileSync(OPENCLAW_ENV_FILE, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read OpenClaw env file at ${OPENCLAW_ENV_FILE}: ${err.message}. ` +
        `Set OPENCLAW_GATEWAY_TOKEN in .env.local to skip this lookup.`,
    );
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    let val = m[1];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) return val;
  }
  throw new Error(
    `GATEWAY_TOKEN not found in ${OPENCLAW_ENV_FILE}. ` +
      `Set OPENCLAW_GATEWAY_TOKEN in .env.local as a fallback.`,
  );
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

function parseTweetsJson(text) {
  // Strip ```json ... ``` or ``` ... ``` fences if the model added them.
  const stripped = text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  const slice = start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped;
  const parsed = JSON.parse(slice);
  if (!Array.isArray(parsed)) throw new Error("agent response was not a JSON array");
  return parsed
    .map((t) => (typeof t === "string" ? t.trim() : null))
    .filter((t) => t && t.length > 0);
}

async function generateTweets(prompt, commits) {
  const commitsForModel = commits.slice(0, 15).map((c) => ({
    sha: c.sha,
    message: c.message,
    author: c.author,
    date: c.date,
    repo: c.repo,
    url: c.url,
  }));

  const input =
    `${prompt.trim()}\n\n` +
    `Recent commits (JSON):\n${JSON.stringify(commitsForModel, null, 2)}\n\n` +
    `Return ONLY a JSON array of tweet strings (no code fences, no commentary).`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENCLAW_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OPENCLAW_GATEWAY_URL.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: `openclaw/${OPENCLAW_AGENT_ID}`, input }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`OpenClaw call timed out after ${OPENCLAW_TIMEOUT_MS}ms`);
    throw new Error(`OpenClaw call failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenClaw HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const payload = await res.json();
  const text = extractOutputText(payload);
  if (!text) throw new Error("OpenClaw returned an empty response");

  try {
    return parseTweetsJson(text);
  } catch (err) {
    throw new Error(`Failed to parse tweets from agent output: ${err.message}. Raw output: ${text.slice(0, 500)}`);
  }
}

// ---------------------------------------------------------------------------
// Poll + claim
// ---------------------------------------------------------------------------

async function claimNextPendingRun() {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);

  const run = await prisma.repoToSocialRun.findFirst({
    where: {
      OR: [
        { jobStatus: "pending" },
        { jobStatus: "running", claimedAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { startedAt: "asc" },
  });
  if (!run) return null;

  const claimed = await prisma.repoToSocialRun.updateMany({
    where: {
      id: run.id,
      OR: [
        { jobStatus: "pending" },
        { jobStatus: "running", claimedAt: { lt: staleCutoff } },
      ],
    },
    data: { jobStatus: "running", claimedAt: new Date(), status: "running" },
  });
  if (claimed.count === 0) return null;
  return run;
}

async function setStatus(runId, message) {
  try {
    await prisma.repoToSocialRun.update({
      where: { id: runId },
      data: { statusMessage: message, claimedAt: new Date() },
    });
  } catch (err) {
    log(`Failed to update statusMessage for ${runId}: ${err.message}`);
  }
}

async function processRun(run) {
  const startedAt = Date.now();
  log(`Claimed run ${run.id} — queued ${formatAge(run.startedAt)}`);

  try {
    await setStatus(run.id, "Loading configuration…");
    const config = await prisma.repoToSocialConfig.findUnique({ where: { id: "singleton" } });
    if (!config?.repoUrl) throw new Error("No repository URL in config.");
    if (!config.prompt) throw new Error("No generation prompt in config.");

    const commits = Array.isArray(run.commits) ? run.commits : [];
    if (commits.length === 0) throw new Error("No commits stored on this run.");

    await setStatus(run.id, `Generating drafts for ${commits.length} commit(s)…`);
    const tweets = await generateTweets(config.prompt, commits);

    await setStatus(run.id, `Saving ${tweets.length} tweet${tweets.length === 1 ? "" : "s"}…`);
    await prisma.repoToSocialRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        jobStatus: "done",
        tweets,
        statusMessage: null,
        durationMs: Date.now() - startedAt,
      },
    });

    log(`Run ${run.id} done — ${tweets.length} tweet(s) in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Run ${run.id} FAILED: ${msg}`);

    await prisma.repoToSocialRun.update({
      where: { id: run.id },
      data: {
        status: "error",
        jobStatus: "failed",
        error: msg,
        statusMessage: null,
        durationMs: Date.now() - startedAt,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let shuttingDown = false;
let processingNow = false;

async function heartbeat() {
  try {
    await prisma.repoToSocialConfig.update({
      where: { id: "singleton" },
      data: { lastWorkerHeartbeat: new Date() },
    });
  } catch (err) {
    if (err && err.code === "P2025") {
      try {
        await prisma.repoToSocialConfig.create({
          data: { id: "singleton", lastWorkerHeartbeat: new Date() },
        });
      } catch (createErr) {
        log(`Heartbeat error: ${createErr.message}`);
      }
    } else {
      log(`Heartbeat error: ${err.message}`);
    }
  }
}

async function pollOnce() {
  await heartbeat();
  await schedulerTick();
  const run = await claimNextPendingRun();
  if (!run) return;

  processingNow = true;
  const heartbeatTimer = setInterval(heartbeat, 8_000);
  try {
    await processRun(run);
  } finally {
    clearInterval(heartbeatTimer);
    processingNow = false;
  }
}

async function schedulerTick() {
  try {
    const headers = { "content-type": "application/json" };
    if (SCHEDULER_SECRET) headers["x-scheduler-secret"] = SCHEDULER_SECRET;
    const res = await fetch(`${SCHEDULER_BASE_URL}/api/scheduler/tick`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      // 404 → portal not running yet; quiet on that. Otherwise log.
      if (res.status !== 404) {
        log(`Scheduler tick HTTP ${res.status}`);
      }
      return;
    }
    const json = await res.json().catch(() => null);
    if (json?.processed?.length) {
      for (const r of json.processed) {
        log(
          `Scheduler ${r.ok ? "published" : "FAILED"} ${r.platform} tweet ` +
            `${r.tweetIndex} of run ${r.runId}` +
            (r.error ? ` — ${r.error}` : ""),
        );
      }
    }
  } catch (err) {
    // Connection refused while dev server is restarting is common — log thin.
    if (err && err.code !== "ECONNREFUSED") {
      log(`Scheduler tick error: ${err.message}`);
    }
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function loop() {
  log(`Worker started — polling every ${POLL_INTERVAL_MS / 1000}s, stale lock ${STALE_LOCK_MS / 60_000}min`);
  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (err) {
      log(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!shuttingDown) await sleep(POLL_INTERVAL_MS);
  }
  log("Worker stopped.");
  await prisma.$disconnect();
  process.exit(0);
}

async function shutdown(signal) {
  log(`Received ${signal} — waiting for current job to finish…`);
  shuttingDown = true;
  if (!processingNow) {
    await prisma.$disconnect();
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  process.stdout.write(`[${ts}] repo-to-social-worker: ${msg}\n`);
}

function formatAge(date) {
  const secs = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

if (!process.env.DATABASE_URL?.trim()) {
  process.stderr.write(
    `[repo-to-social-worker] FATAL: DATABASE_URL is not set.\n` +
      `Copy .env.example to .env.local and fill it in.\n`,
  );
  process.exit(1);
}

loop().catch(async (err) => {
  process.stderr.write(`Worker fatal error: ${err?.message ?? err}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
