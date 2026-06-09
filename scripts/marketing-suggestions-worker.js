#!/usr/bin/env node
// Marketing Suggestions worker for multi-tenant-portal.
// Polls the DB for enqueued runs, gathers per-project community signals
// (top posts, top creators, today's marketing briefing), and asks the
// configured OpenClaw agent to draft posts.
//
// Sister to repo-to-social-worker.js — same loop shape, different inputs.
// Run: npm run worker:marketing-suggestions

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
const OPENCLAW_AGENT_ID =
  process.env.MARKETING_SUGGESTIONS_AGENT_ID ??
  process.env.OPENCLAW_AGENT_ID ??
  "skatehive-marketing";
const OPENCLAW_ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");
const OPENCLAW_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 120_000);
const SCHEDULER_BASE_URL = process.env.SCHEDULER_BASE_URL ?? "http://localhost:3030";
const SCHEDULER_SECRET = process.env.SCHEDULER_TICK_SECRET;
const HIVE_API = process.env.HIVE_API_URL || "https://api.hive.blog";
// Fallback agentSlug for briefing lookups when config.agentId is not set.
const BRIEFING_AGENT_SLUG = "skatehive-marketing";

const prisma = new PrismaClient({ log: ["error"] });

// ---------------------------------------------------------------------------
// Gateway token + agent call (identical shape to repo-to-social-worker).
// ---------------------------------------------------------------------------

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

async function callAgent(input, agentId = OPENCLAW_AGENT_ID) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENCLAW_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OPENCLAW_GATEWAY_URL.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: `openclaw/${agentId}`, input }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`OpenClaw call timed out after ${OPENCLAW_TIMEOUT_MS}ms`);
    }
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
    throw new Error(
      `Failed to parse posts from agent output: ${err.message}. Raw: ${text.slice(0, 500)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hive signal collection — top posts + derived top creators.
// Direct JS port of src/lib/skatehive-content.ts + skatehive-creators.ts so
// this script runs without bundling Next.
// ---------------------------------------------------------------------------

async function callHiveJsonRpc(method, params) {
  const res = await fetch(HIVE_API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`Hive JSON-RPC ${method} -> HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Hive JSON-RPC ${method}: ${data.error.message ?? "unknown"}`);
  return data.result;
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function extractFirstImage(post) {
  const meta = parseMetadata(post.json_metadata);
  if (meta.image && meta.image.length > 0) return meta.image[0];
  const body = post.body ?? "";
  const md = body.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  if (md) return md[1];
  const raw = body.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/i);
  return raw ? raw[0] : null;
}

function extractExcerpt(body, max = 200) {
  const stripped = (body || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max).trim() + "…";
}

function isThinPermlink(permlink) {
  if (/^snap-/.test(permlink)) return true;
  if (/^[a-f0-9]{6,12}$/.test(permlink)) return true;
  return false;
}

function buildPostUrl(author, permlink, frontend) {
  if (frontend) return `${frontend.replace(/\/$/, "")}/post/${author}/${permlink}`;
  return `https://peakd.com/@${author}/${permlink}`;
}

async function fetchTopPosts({ daysBack = 8, minVotes = 5, minBody = 250, community, frontend } = {}) {
  const tag = community || "hive-173115";
  const ranked = await callHiveJsonRpc("bridge.get_ranked_posts", {
    sort: "trending",
    tag,
    limit: 20,
  });
  const cutoff = Date.now() - daysBack * 86_400_000;
  const out = [];
  for (const post of ranked) {
    if (!post.created || !post.author || !post.permlink) continue;
    if (post.parent_author) continue;
    const createdMs = new Date(post.created + (post.created.endsWith("Z") ? "" : "Z")).getTime();
    if (Number.isNaN(createdMs) || createdMs < cutoff) continue;
    const title = (post.title ?? "").trim();
    if (!title || title.toLowerCase() === "removed") continue;
    if (isThinPermlink(post.permlink)) continue;
    const body = post.body ?? "";
    if (body.length < minBody) continue;
    const votes = post.stats?.total_votes ?? 0;
    if (votes < minVotes) continue;
    out.push({
      author: post.author,
      permlink: post.permlink,
      title,
      url: buildPostUrl(post.author, post.permlink, frontend),
      createdAt: post.created,
      excerpt: extractExcerpt(body),
      firstImage: extractFirstImage(post),
      netVotes: votes,
      payoutHbd: typeof post.payout === "number" ? post.payout : 0,
    });
  }
  out.sort((a, b) => b.netVotes - a.netVotes || b.payoutHbd - a.payoutHbd);
  return out;
}

function deriveTopCreators(posts, limit = 10) {
  const byAuthor = new Map();
  for (const post of posts) {
    const entry = byAuthor.get(post.author) ?? { posts: [] };
    entry.posts.push(post);
    byAuthor.set(post.author, entry);
  }
  const creators = [];
  for (const [author, { posts: ps }] of byAuthor) {
    const totalVotes = ps.reduce((s, p) => s + p.netVotes, 0);
    const totalPayout = ps.reduce((s, p) => s + p.payoutHbd, 0);
    const topPost = ps.reduce((best, p) => (p.netVotes > best.netVotes ? p : best));
    creators.push({
      author,
      postsCount: ps.length,
      totalVotes,
      totalPayoutHbd: totalPayout,
      topPost: {
        title: topPost.title,
        url: topPost.url,
        netVotes: topPost.netVotes,
        payoutHbd: topPost.payoutHbd,
      },
    });
  }
  creators.sort(
    (a, b) =>
      b.totalVotes - a.totalVotes ||
      b.totalPayoutHbd - a.totalPayoutHbd ||
      b.postsCount - a.postsCount,
  );
  return creators.slice(0, limit);
}

function formatPostsForPrompt(posts) {
  if (posts.length === 0) {
    return "(no qualifying posts found — fall back to evergreen community angles.)";
  }
  return posts
    .map(
      (p, i) =>
        `${i + 1}. **${p.title}** — @${p.author}\n` +
        `   URL: ${p.url}\n` +
        `   ${p.createdAt.slice(0, 10)} · ${p.netVotes} votes · ${p.payoutHbd.toFixed(2)} HBD\n` +
        `   Excerpt: ${p.excerpt}\n`,
    )
    .join("\n");
}

function formatCreatorsForPrompt(creators) {
  if (creators.length === 0) {
    return "(no creators surfaced this week — skip the creator-spotlight angle.)";
  }
  return creators
    .map(
      (c, i) =>
        `${i + 1}. @${c.author} — ${c.postsCount} post${c.postsCount === 1 ? "" : "s"} · ${c.totalVotes} votes · ${c.totalPayoutHbd.toFixed(2)} HBD\n` +
        `   Top: "${c.topPost.title}" — ${c.topPost.url}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Briefing preamble — first ~600 chars of today's marketing briefing.
// ---------------------------------------------------------------------------

async function fetchBriefingPreamble(agentSlug) {
  const slug = agentSlug || BRIEFING_AGENT_SLUG;
  const today = new Date().toISOString().slice(0, 10);
  void today; // available for future date-scoped filtering
  const briefing = await prisma.briefing.findFirst({
    where: { agentSlug: slug },
    orderBy: [{ date: "desc" }, { generatedAt: "desc" }],
  });
  if (!briefing) return null;
  // Pull the body up to the first section header (### / ## / **) so we get
  // the lead paragraph without dragging in every section.
  const body = briefing.body || "";
  const headerIdx = body.search(/^\s*(?:#{2,}|\*\*[A-Z])/m);
  const slice = (headerIdx > 0 ? body.slice(0, headerIdx) : body).trim().slice(0, 800);
  return slice ? { date: briefing.date, text: slice } : null;
}

// ---------------------------------------------------------------------------
// Dedup — pulls recent published/approved posts so the agent doesn't repeat.
// ---------------------------------------------------------------------------

const DEDUP_LOOKBACK_DAYS = Number(process.env.MARKETING_DEDUP_DAYS ?? 30);
const DEDUP_MAX = Number(process.env.MARKETING_DEDUP_MAX ?? 40);

async function fetchRecentPostsForDedup(currentRunId) {
  const since = new Date(Date.now() - DEDUP_LOOKBACK_DAYS * 86_400_000);
  const runs = await prisma.marketingSuggestionRun.findMany({
    where: {
      id: { not: currentRunId },
      startedAt: { gte: since },
      status: "success",
    },
    orderBy: { startedAt: "desc" },
    select: { tweets: true, tweetStates: true },
    take: 30,
  });
  const out = [];
  for (const r of runs) {
    const tweets = Array.isArray(r.tweets) ? r.tweets : [];
    const states = r.tweetStates && typeof r.tweetStates === "object" ? r.tweetStates : {};
    tweets.forEach((t, i) => {
      if (typeof t !== "string" || !t.trim()) return;
      const status = states[i]?.status;
      if (status === "published" || status === "approved") out.push(t.trim());
    });
  }
  return out.slice(0, DEDUP_MAX);
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

async function claimNextPendingRun() {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);
  const run = await prisma.marketingSuggestionRun.findFirst({
    where: {
      OR: [
        { jobStatus: "pending" },
        { jobStatus: "running", claimedAt: { lt: staleCutoff } },
      ],
    },
    orderBy: { startedAt: "asc" },
  });
  if (!run) return null;
  const claimed = await prisma.marketingSuggestionRun.updateMany({
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
    await prisma.marketingSuggestionRun.update({
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
    const config = await prisma.marketingSuggestionConfig.findUnique({
      where: { id: run.configId },
    });
    if (!config) throw new Error("Marketing suggestions config missing.");

    const enabledAny = config.useTopPosts || config.useTopCreators || config.useBriefing;
    if (!enabledAny && !run.freePrompt) {
      throw new Error("No sources enabled and no theme provided — nothing to feed the agent.");
    }

    let posts = [];
    let creators = [];
    let briefing = null;

    if (config.useTopPosts || config.useTopCreators) {
      await setStatus(run.id, "Fetching trending community posts…");
      posts = await fetchTopPosts({
        community: config.hiveCommunity,
        frontend: config.hiveFrontend,
      });
      if (config.useTopCreators) creators = deriveTopCreators(posts);
    }
    if (config.useBriefing) {
      await setStatus(run.id, "Loading today's marketing briefing…");
      briefing = await fetchBriefingPreamble(config.agentId);
    }

    await setStatus(run.id, "Loading recent posts for dedup…");
    const recentPosts = await fetchRecentPostsForDedup(run.id);
    log(`Run ${run.id} — dedup context: ${recentPosts.length} prior post(s)`);

    const sections = [];
    sections.push(config.prompt.trim());

    if (run.freePrompt && run.freePrompt.trim()) {
      sections.push(`User-supplied theme / focus for this batch:\n${run.freePrompt.trim()}`);
    }

    if (config.useTopPosts && posts.length > 0) {
      sections.push(`Top community posts this week (use real titles, @handles, URLs):\n${formatPostsForPrompt(posts)}`);
    }

    if (config.useTopCreators && creators.length > 0) {
      sections.push(`Top community creators this week (use @handles in posts when you spotlight them):\n${formatCreatorsForPrompt(creators)}`);
    }

    if (config.useBriefing && briefing) {
      sections.push(`Today's marketing briefing preamble (${briefing.date}):\n${briefing.text}`);
    }

    if (recentPosts.length) {
      sections.push(
        `Posts we have ALREADY shared in the last ${DEDUP_LOOKBACK_DAYS} days — do NOT repeat or paraphrase:\n` +
          recentPosts.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      );
    }

    sections.push("Return ONLY a JSON array of post strings (no code fences, no commentary).");

    const input = sections.join("\n\n");

    await setStatus(run.id, "Generating drafts…");
    const agentId = config.agentId || OPENCLAW_AGENT_ID;
    const tweets = await callAgent(input, agentId);

    await setStatus(run.id, `Saving ${tweets.length} post${tweets.length === 1 ? "" : "s"}…`);
    await prisma.marketingSuggestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        jobStatus: "done",
        tweets,
        statusMessage: null,
        inputs: {
          topPosts: posts,
          topCreators: creators,
          briefingPreamble: briefing?.text ?? null,
          freePrompt: run.freePrompt ?? null,
        },
        durationMs: Date.now() - startedAt,
      },
    });

    log(`Run ${run.id} done — ${tweets.length} post(s) in ${Date.now() - startedAt}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Run ${run.id} FAILED: ${msg}`);
    await prisma.marketingSuggestionRun.update({
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
// Loop + heartbeat + scheduler tick
// ---------------------------------------------------------------------------

let shuttingDown = false;
let processingNow = false;

async function heartbeat() {
  try {
    const result = await prisma.marketingSuggestionConfig.updateMany({
      data: { lastWorkerHeartbeat: new Date() },
    });
    if (result.count === 0) {
      // No config rows yet — skip; the UI will create them on first access.
    }
  } catch (err) {
    log(`Heartbeat error: ${err.message}`);
  }
}

async function schedulerTick() {
  try {
    const headers = { "content-type": "application/json", "x-scheduler-source": "mac" };
    if (SCHEDULER_SECRET) headers["x-scheduler-secret"] = SCHEDULER_SECRET;
    const res = await fetch(`${SCHEDULER_BASE_URL}/api/scheduler/tick`, {
      method: "POST",
      headers,
    });
    if (!res.ok) {
      if (res.status !== 404) log(`Scheduler tick HTTP ${res.status}`);
      return;
    }
    const json = await res.json().catch(() => null);
    if (json?.processed?.length) {
      for (const r of json.processed) {
        log(
          `Scheduler ${r.ok ? "published" : "FAILED"} ${r.platform} post ` +
            `${r.tweetIndex} of run ${r.runId}` +
            (r.error ? ` — ${r.error}` : ""),
        );
      }
    }
  } catch (err) {
    if (err && err.code !== "ECONNREFUSED") log(`Scheduler tick error: ${err.message}`);
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
  process.stdout.write(`[${ts}] marketing-suggestions-worker: ${msg}\n`);
}

function formatAge(date) {
  const secs = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

if (!process.env.DATABASE_URL?.trim()) {
  process.stderr.write(
    `[marketing-suggestions-worker] FATAL: DATABASE_URL is not set.\n` +
      `Copy .env.example to .env.local and fill it in.\n`,
  );
  process.exit(1);
}

loop().catch(async (err) => {
  process.stderr.write(`Worker fatal error: ${err?.message ?? err}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
