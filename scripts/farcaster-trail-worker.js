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
        // LIKE — auto. Skipped when not fresh, or recorded-only in dry mode.
        let likeStatus = "pending", ref = null, err = null;
        if (!fresh) likeStatus = "skipped";
        else if (!ENABLED) likeStatus = "skipped"; // dry run
        else {
          const lr = await likeAs(actor, c.hash);
          if (lr.ok) { likeStatus = "done"; ref = (lr.json.reaction && lr.json.reaction.hash) || "liked"; }
          else { likeStatus = "failed"; err = `HTTP ${lr.status}: ${JSON.stringify(lr.json).slice(0, 140)}`; }
        }
        await prisma.farcasterTrailAction.create({
          data: { castHash: c.hash, actorSlug: actor.slug, kind: "like", status: likeStatus, resultRef: ref, error: err },
        });
        // REPLY — HITL: always a pending action (UI fills the draft + posts).
        await prisma.farcasterTrailAction.create({
          data: { castHash: c.hash, actorSlug: actor.slug, kind: "reply", status: fresh ? "pending" : "skipped" },
        });
      }
      console.log(`[trail] ${author.slug} cast ${c.hash.slice(0, 10)} → ${others.length} actors ${fresh ? (ENABLED ? "(liked)" : "(dry)") : "(stale, skipped)"}`);
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
    if (once) { await prisma.$disconnect(); return; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
