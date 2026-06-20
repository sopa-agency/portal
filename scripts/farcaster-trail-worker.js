#!/usr/bin/env node
// Farcaster cross-account curation trail worker.
//
// Watches our brand accounts. When one posts a NEW top-level cast, the OTHER
// accounts auto-LIKE it, and a pending "reply" action is recorded for the
// human-in-the-loop UI (AI draft → review → post). Sister to the other
// pollers; same loop shape. Run: npm run worker:farcaster-trail
//
// Safety:
//   - Only ORIGINAL top-level casts trigger the trail (no parent, no recast),
//     so our own HITL replies (which have a parent) never re-trigger it.
//   - Freshness window: on first sight, only casts newer than TRAIL_FRESH_HOURS
//     are actioned; older ones are recorded as skipped (no mass back-liking).
//   - Likes only fire when FARCASTER_TRAIL_ENABLED is truthy; otherwise the
//     worker still DETECTS + records (dry run) so the UI can be built/tested.

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
// Auto-likes are queued and drained with a RANDOM pause between each, so they
// look human instead of a burst.
const LIKE_MIN_MS = Number(process.env.TRAIL_LIKE_MIN_MS ?? 20_000); // 20s
const LIKE_MAX_MS = Number(process.env.TRAIL_LIKE_MAX_MS ?? 120_000); // 2 min
const LIKE_BATCH_PER_TICK = Number(process.env.TRAIL_LIKE_BATCH ?? 6);
const rand = Math.random;

// Participating brand accounts (each must have an approved signer).
const PARTICIPANTS = [
  { slug: "skatehive", fid: 538839, apiKeyEnv: "NEYNAR_API_KEY", signerEnv: "NEYNAR_SIGNER_UUID" },
  { slug: "gnars", fid: 2808368, apiKeyEnv: "GNARS_NEYNAR_API_KEY", signerEnv: "GNARS_NEYNAR_SIGNER_UUID" },
  { slug: "reelflip", fid: 3338092, apiKeyEnv: "NEYNAR_API_KEY", signerFromDb: true },
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
    if (apiKey && signer) out.push({ ...p, apiKey, signer });
    else console.warn(`[trail] skipping ${p.slug}: missing ${!apiKey ? "apiKey" : "signer"}`);
  }
  return out;
}

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

// A trail-worthy cast: original, top-level, authored by the account itself.
function isTriggerCast(c, authorFid) {
  if (!c || !c.hash) return false;
  if (c.parent_hash) return false; // replies never trigger (loop guard)
  if (c.parent_author && c.parent_author.fid) return false;
  if (c.author && c.author.fid !== authorFid) return false; // recast of someone else
  return true;
}

async function likeAs(actor, castHash) {
  return neynar("POST", "/v2/farcaster/reaction", actor.apiKey, {
    signer_uuid: actor.signer,
    reaction_type: "like",
    target: castHash,
  });
}

async function tick(participants) {
  const freshCutoff = Date.now() - FRESH_HOURS * 3_600_000;
  for (const author of participants) {
    const r = await neynar("GET", `/v2/farcaster/feed/user/casts?fid=${author.fid}&limit=${PER_ACCOUNT_LIMIT}`, author.apiKey);
    if (!r.ok) { console.warn(`[trail] feed ${author.slug} HTTP ${r.status}`); continue; }
    const casts = r.json.casts || [];
    for (const c of casts) {
      if (!isTriggerCast(c, author.fid)) continue;
      const exists = await prisma.farcasterTrailCast.findUnique({ where: { hash: c.hash } }).catch(() => null);
      if (exists) continue;

      const postedAt = new Date(c.timestamp);
      const fresh = postedAt.getTime() >= freshCutoff;

      await prisma.farcasterTrailCast.create({
        data: {
          hash: c.hash, authorFid: author.fid, authorSlug: author.slug,
          text: c.text || "", embedsJson: c.embeds ? JSON.stringify(c.embeds) : null, postedAt,
        },
      });

      const others = participants.filter((p) => p.slug !== author.slug);
      for (const actor of others) {
        // LIKE — queued as pending; executed later, spaced out with a random
        // interval (anti-spam / human-like). Stale or dry → skipped.
        const likeStatus = !fresh || !ENABLED ? "skipped" : "pending";
        await prisma.farcasterTrailAction.create({
          data: { castHash: c.hash, actorSlug: actor.slug, kind: "like", status: likeStatus },
        });
        // REPLY — HITL: always pending (UI fills the draft + posts). Never auto.
        await prisma.farcasterTrailAction.create({
          data: { castHash: c.hash, actorSlug: actor.slug, kind: "reply", status: fresh ? "pending" : "skipped" },
        });
      }
      console.log(`[trail] ${author.slug} cast ${c.hash.slice(0, 10)} → ${others.length} actors queued ${fresh ? (ENABLED ? "(likes pending)" : "(dry)") : "(stale)"}`);
    }
  }
}

// Executes queued likes ONE at a time, with a random pause between each, so the
// trail's auto-likes look human instead of a burst. Capped per tick; the rest
// stay pending for the next cycle.
async function processPendingLikes(participants) {
  if (!ENABLED) return;
  const bySlug = new Map(participants.map((p) => [p.slug, p]));
  const pending = await prisma.farcasterTrailAction.findMany({
    where: { kind: "like", status: "pending" },
    orderBy: { createdAt: "asc" },
    take: LIKE_BATCH_PER_TICK,
  }).catch(() => []);
  if (!pending.length) return;

  for (let i = 0; i < pending.length; i++) {
    const a = pending[i];
    const actor = bySlug.get(a.actorSlug);
    if (!actor) { continue; }
    const lr = await likeAs(actor, a.castHash);
    if (lr.ok) {
      await prisma.farcasterTrailAction.update({
        where: { id: a.id },
        data: { status: "done", resultRef: (lr.json.reaction && lr.json.reaction.hash) || "liked", error: null },
      }).catch(() => {});
      console.log(`[trail] like ${a.actorSlug} → ${a.castHash.slice(0, 10)} ok`);
    } else {
      await prisma.farcasterTrailAction.update({
        where: { id: a.id },
        data: { status: "failed", error: `HTTP ${lr.status}: ${JSON.stringify(lr.json).slice(0, 140)}` },
      }).catch(() => {});
      console.log(`[trail] like ${a.actorSlug} → ${a.castHash.slice(0, 10)} FAILED ${lr.status}`);
    }
    // Random pause before the next like (skip after the last one).
    if (i < pending.length - 1) {
      const wait = LIKE_MIN_MS + Math.floor(rand() * (LIKE_MAX_MS - LIKE_MIN_MS));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  const participants = await resolveParticipants();
  console.log(`[trail] participants: ${participants.map((p) => p.slug).join(", ")} | enabled=${ENABLED} | poll=${POLL_INTERVAL_MS}ms | fresh=${FRESH_HOURS}h`);
  if (participants.length < 2) { console.error("[trail] need >=2 participants with signers. Exiting."); process.exit(1); }
  const once = process.argv.includes("--once");
  // run once immediately, then loop (unless --once)
  for (;;) {
    try { await tick(participants); } catch (e) { console.error("[trail] tick error:", e.message); }
    try { await processPendingLikes(participants); } catch (e) { console.error("[trail] like-drain error:", e.message); }
    if (once) { await prisma.$disconnect(); return; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
