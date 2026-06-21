#!/usr/bin/env node
// Cross-account curation trail worker — Farcaster + Hive.
//
// Watches our brand accounts on BOTH platforms. When one posts a NEW top-level
// post, the OTHER accounts auto-engage (Farcaster like / Hive upvote), drained
// one at a time with a RANDOM pause so it looks human. A pending "reply"
// (Farcaster) / "comment" (Hive) action is recorded for the HITL Curadoria UI —
// comments are NEVER posted automatically. Run: npm run worker:farcaster-trail
//
// Safety: only ORIGINAL top-level posts trigger (our HITL replies have a parent,
// so they never re-trigger). Freshness window avoids mass back-engagement on
// first run. Gated by FARCASTER_TRAIL_ENABLED (dry run still detects/records).

"use strict";

const path = require("node:path");
for (const f of [".env.local", ".env.development", ".env"]) {
  try { require("dotenv").config({ path: path.join(__dirname, "..", f), override: false }); } catch {}
}
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({ log: ["error"] });
const POLL_INTERVAL_MS = Number(process.env.FARCASTER_TRAIL_POLL_MS ?? 180_000); // 3 min
const FRESH_HOURS = Number(process.env.TRAIL_FRESH_HOURS ?? 6);
const ENABLED = /^(1|true|yes)$/i.test(process.env.FARCASTER_TRAIL_ENABLED ?? "");
const PER_ACCOUNT_LIMIT = 10;
// Auto-likes/upvotes are queued and drained with a RANDOM pause between each.
const LIKE_MIN_MS = Number(process.env.TRAIL_LIKE_MIN_MS ?? 20_000); // 20s
const LIKE_MAX_MS = Number(process.env.TRAIL_LIKE_MAX_MS ?? 120_000); // 2 min
const LIKE_BATCH_PER_TICK = Number(process.env.TRAIL_LIKE_BATCH ?? 6);
const rand = Math.random;
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];

// Brand accounts. Each may act on Farcaster (signer+apiKey) and/or Hive (account+key).
const PARTICIPANTS = [
  { slug: "skatehive", fid: 538839, apiKeyEnv: "NEYNAR_API_KEY", signerEnv: "NEYNAR_SIGNER_UUID", hiveAccount: "skatehive", hiveKeyEnv: "HIVE_POSTING_KEY" },
  { slug: "gnars", fid: 2808368, apiKeyEnv: "GNARS_NEYNAR_API_KEY", signerEnv: "GNARS_NEYNAR_SIGNER_UUID", hiveAccount: "gnars", hiveKeyEnv: "GNARS_HIVE_POSTING_KEY" },
  { slug: "reelflip", fid: 3338092, apiKeyEnv: "NEYNAR_API_KEY", signerFromDb: true, hiveAccount: "reelflip", hiveKeyEnv: "REELFLIP_HIVE_POSTING_KEY" },
];

async function resolveParticipants() {
  const out = [];
  for (const p of PARTICIPANTS) {
    const apiKey = process.env[p.apiKeyEnv] || process.env.NEYNAR_API_KEY;
    let signer = p.signerEnv ? process.env[p.signerEnv] : null;
    if (!signer && p.signerFromDb) {
      const row = await prisma.farcasterSigner.findUnique({ where: { projectSlug: p.slug } }).catch(() => null);
      if (row && row.status === "approved") signer = row.signerUuid;
    }
    const hiveKey = p.hiveKeyEnv ? process.env[p.hiveKeyEnv] : null;
    out.push({
      slug: p.slug,
      fid: p.fid,
      fc: apiKey && signer ? { apiKey, signer } : null,
      hive: p.hiveAccount && hiveKey ? { account: p.hiveAccount, key: hiveKey } : (p.hiveAccount ? { account: p.hiveAccount, key: null } : null),
    });
  }
  return out;
}

// ── Farcaster ───────────────────────────────────────────────────────────────
async function neynar(method, p, apiKey, body) {
  const res = await fetch(`https://api.neynar.com${p}`, {
    method,
    headers: { "x-api-key": apiKey, accept: "application/json", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

function isFcTrigger(c, authorFid) {
  if (!c || !c.hash) return false;
  if (c.parent_hash) return false;
  if (c.parent_author && c.parent_author.fid) return false;
  if (c.author && c.author.fid !== authorFid) return false;
  return true;
}

async function fcLike(actor, castHash) {
  return neynar("POST", "/v2/farcaster/reaction", actor.fc.apiKey, {
    signer_uuid: actor.fc.signer, reaction_type: "like", target: castHash,
  });
}

// ── Hive ──────────────────────────────────────────────────────────────────-
async function hiveCall(method, params) {
  for (const node of HIVE_NODES) {
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      if (j && j.result) return j.result;
    } catch { /* try next node */ }
  }
  return null;
}

async function fetchHivePosts(account, limit) {
  // bridge.get_account_posts sort "posts" = the account's own root posts (no reblogs).
  return (await hiveCall("bridge.get_account_posts", { sort: "posts", account, limit })) || [];
}

async function hiveUpvote(actor, author, permlink) {
  try {
    const { Client, PrivateKey } = require("@hiveio/dhive");
    const client = new Client(HIVE_NODES);
    const op = ["vote", { voter: actor.hive.account, author, permlink, weight: 10000 }];
    await client.broadcast.sendOperations([op], PrivateKey.fromString(actor.hive.key));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Detection ────────────────────────────────────────────────────────────--
async function recordTrigger(author, participants, { hash, platform, authorFid, authorHandle, text, url, postedAt, fresh }) {
  const exists = await prisma.farcasterTrailCast.findUnique({ where: { hash } }).catch(() => null);
  if (exists) return false;
  await prisma.farcasterTrailCast.create({
    data: { hash, platform, authorFid: authorFid ?? null, authorSlug: author.slug, authorHandle: authorHandle ?? null, text: text || "", url: url ?? null, postedAt },
  });
  const others = participants.filter((p) => p.slug !== author.slug);
  for (const actor of others) {
    const likeStatus = !fresh || !ENABLED ? "skipped" : "pending";
    await prisma.farcasterTrailAction.create({ data: { castHash: hash, actorSlug: actor.slug, kind: "like", status: likeStatus } });
    await prisma.farcasterTrailAction.create({ data: { castHash: hash, actorSlug: actor.slug, kind: "reply", status: fresh ? "pending" : "skipped" } });
  }
  console.log(`[trail/${platform}] ${author.slug} ${hash.slice(0, 16)} → ${others.length} actors ${fresh ? (ENABLED ? "(queued)" : "(dry)") : "(stale)"}`);
  return true;
}

async function tick(participants) {
  const freshCutoff = Date.now() - FRESH_HOURS * 3_600_000;

  for (const author of participants) {
    // Farcaster
    if (author.fc && author.fid) {
      const r = await neynar("GET", `/v2/farcaster/feed/user/casts?fid=${author.fid}&limit=${PER_ACCOUNT_LIMIT}`, author.fc.apiKey);
      if (r.ok) {
        for (const c of r.json.casts || []) {
          if (!isFcTrigger(c, author.fid)) continue;
          const postedAt = new Date(c.timestamp);
          await recordTrigger(author, participants, {
            hash: c.hash, platform: "farcaster", authorFid: author.fid,
            authorHandle: (c.author && c.author.username) || author.slug,
            text: c.text || "", url: `https://warpcast.com/${(c.author && c.author.username) || author.slug}/${c.hash.slice(0, 10)}`,
            postedAt, fresh: postedAt.getTime() >= freshCutoff,
          });
        }
      }
    }
    // Hive
    if (author.hive && author.hive.account) {
      const posts = await fetchHivePosts(author.hive.account, PER_ACCOUNT_LIMIT);
      for (const post of posts) {
        if (!post || post.depth !== 0 || (post.parent_author && post.parent_author !== "")) continue; // top-level only
        if (post.author !== author.hive.account) continue; // own post (not a reblog)
        const hash = `hive:${post.author}/${post.permlink}`;
        const postedAt = new Date((post.created || "") + "Z");
        await recordTrigger(author, participants, {
          hash, platform: "hive", authorFid: null, authorHandle: post.author,
          text: post.title || (post.body || "").slice(0, 140),
          url: `https://peakd.com/@${post.author}/${post.permlink}`,
          postedAt, fresh: postedAt.getTime() >= freshCutoff,
        });
      }
    }
  }
}

// ── Drain queued likes/upvotes with a random pause ──────────────────────────-
async function processPendingLikes(participants) {
  if (!ENABLED) return;
  const bySlug = new Map(participants.map((p) => [p.slug, p]));
  const pending = await prisma.farcasterTrailAction.findMany({
    where: { kind: "like", status: "pending" },
    orderBy: { createdAt: "asc" }, take: LIKE_BATCH_PER_TICK, include: { cast: true },
  }).catch(() => []);
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i++) {
    const a = pending[i];
    const actor = bySlug.get(a.actorSlug);
    if (!actor) continue;
    let res, ref = null;
    if (a.cast.platform === "hive") {
      if (!actor.hive || !actor.hive.key) { res = { ok: false, error: "no hive key" }; }
      else {
        const [author, permlink] = a.cast.hash.replace(/^hive:/, "").split("/");
        res = await hiveUpvote(actor, author, permlink);
        ref = res.ok ? "upvoted" : null;
      }
    } else {
      if (!actor.fc) { res = { ok: false, error: "no fc signer" }; }
      else {
        const lr = await fcLike(actor, a.cast.hash);
        res = lr.ok ? { ok: true } : { ok: false, error: `HTTP ${lr.status}: ${JSON.stringify(lr.json).slice(0, 120)}` };
        ref = lr.ok ? ((lr.json.reaction && lr.json.reaction.hash) || "liked") : null;
      }
    }
    await prisma.farcasterTrailAction.update({
      where: { id: a.id },
      data: res.ok ? { status: "done", resultRef: ref, error: null } : { status: "failed", error: res.error },
    }).catch(() => {});
    console.log(`[trail] ${a.cast.platform} ${a.cast.platform === "hive" ? "upvote" : "like"} ${a.actorSlug} → ${a.castHash.slice(0, 16)} ${res.ok ? "ok" : "FAIL " + res.error}`);

    if (i < pending.length - 1) {
      await new Promise((r) => setTimeout(r, LIKE_MIN_MS + Math.floor(rand() * (LIKE_MAX_MS - LIKE_MIN_MS))));
    }
  }
}

async function main() {
  const participants = await resolveParticipants();
  const fc = participants.filter((p) => p.fc).map((p) => p.slug);
  const hv = participants.filter((p) => p.hive && p.hive.key).map((p) => p.slug);
  console.log(`[trail] enabled=${ENABLED} | poll=${POLL_INTERVAL_MS}ms | fresh=${FRESH_HOURS}h | FC actors: ${fc.join(",")} | Hive actors: ${hv.join(",")}`);
  if (participants.length < 2) { console.error("[trail] need >=2 participants. Exiting."); process.exit(1); }
  const once = process.argv.includes("--once");
  for (;;) {
    try { await tick(participants); } catch (e) { console.error("[trail] tick error:", e.message); }
    try { await processPendingLikes(participants); } catch (e) { console.error("[trail] drain error:", e.message); }
    if (once) { await prisma.$disconnect(); return; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
