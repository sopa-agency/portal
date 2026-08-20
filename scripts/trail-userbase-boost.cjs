// Pool B — community-key boost. When a COMPANY posts on Hive, a random rotating
// subset of the SkateHive userbase posting keys upvotes it at a low weight,
// spread over time. Decrypts userbase_hive_keys with USERBASE_KEY_ENCRYPTION_SECRET
// (replicating skatehive3.0 lib/userbase/encryption.decryptHivePostingKey).
//
// Inert unless USERBASE_KEY_ENCRYPTION_SECRET + SUPABASE_USERBASE_* are set and
// TRAIL_BOOST_ENABLED is truthy. Only company posts are boosted; never members.
"use strict";

const crypto = require("node:crypto");

const SUBSET = Number(process.env.TRAIL_BOOST_SUBSET ?? 40); // mag posts budget (full pool)
const SNAP_SUBSET = Number(process.env.TRAIL_BOOST_SNAP_SUBSET ?? 15); // snaps budget (smaller)
const WEIGHT = Math.max(1, Math.min(10000, Number(process.env.TRAIL_BOOST_WEIGHT ?? 1000))); // ~10%
const MIN_MS = Number(process.env.TRAIL_BOOST_MIN_MS ?? 60_000); // 1 min
const MAX_MS = Number(process.env.TRAIL_BOOST_MAX_MS ?? 300_000); // 5 min
// Proportional pacing: release boosts as REAL upvotes arrive, so growth feels organic.
const RATIO = Number(process.env.TRAIL_BOOST_RATIO ?? 0.5); // boosts per real new vote
const SEED = Number(process.env.TRAIL_BOOST_SEED ?? 2); // initial kickstart boosts
const PER_TICK = Number(process.env.TRAIL_BOOST_PER_TICK ?? 3); // max releases per post per tick
const TTL_H = Number(process.env.TRAIL_BOOST_TTL_H ?? 48); // stop releasing after this
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];

// Count current upvotes on a Hive post (no dhive needed).
async function countVotes(author, permlink) {
  for (const node of HIVE_NODES) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_active_votes", params: [author, permlink], id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (Array.isArray(j.result)) return j.result.length;
    } catch { /* next node */ }
  }
  return null;
}

function enabled() {
  return /^(1|true|yes)$/i.test(process.env.TRAIL_BOOST_ENABLED ?? "") &&
    !!process.env.USERBASE_KEY_ENCRYPTION_SECRET &&
    !!process.env.SUPABASE_USERBASE_URL &&
    !!process.env.SUPABASE_USERBASE_SERVICE_ROLE_KEY;
}

function userbaseClient() {
  const { createClient } = require("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_USERBASE_URL, process.env.SUPABASE_USERBASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Mirror of skatehive3.0 decryptHivePostingKey (scrypt salt per user_id, AES-256-GCM).
function decryptPostingKey(row) {
  const secret = process.env.USERBASE_KEY_ENCRYPTION_SECRET;
  const key = crypto.scryptSync(secret, `skatehive-hive-key-${row.user_id}`, 32);
  const iv = Buffer.from(row.encryption_iv, "base64");
  const tag = Buffer.from(row.encryption_auth_tag, "base64");
  const enc = Buffer.from(row.encrypted_posting_key, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Queue a random subset of userbase voters for a fresh COMPANY Hive post.
// Snaps get a smaller budget than mag posts (very different vote scales).
async function queueBoosts(prisma, castHash, opts = {}) {
  if (!enabled()) return 0;
  const budgetCap = opts.isSnap ? SNAP_SUBSET : SUBSET;
  const ub = userbaseClient();
  // Respect consent: exclude anyone who opted OUT of supporting official posts.
  // Default (column null/false) = opted in. Falls back gracefully if the
  // trail_opt_out column doesn't exist yet (pre-migration).
  let data;
  const filtered = await ub
    .from("userbase_hive_keys")
    .select("hive_username, trail_vote_weight")
    .or("trail_opt_out.is.null,trail_opt_out.eq.false")
    .limit(2000);
  if (filtered.error) {
    const all = await ub.from("userbase_hive_keys").select("hive_username").limit(2000);
    data = all.data;
    console.warn("[boost] trail_opt_out/weight columns missing — using all keys at default weight (run the skatehive3.0 migration).");
  } else {
    data = filtered.data;
  }
  const pick = shuffle((data || []).filter((r) => r.hive_username)).slice(0, budgetCap);
  if (!pick.length) return 0;
  await prisma.trailUserbaseBoost.createMany({
    // Each voter's own weight (default 50% once migrated); WEIGHT is the fallback.
    data: pick.map((r) => ({
      castHash,
      hiveUsername: r.hive_username,
      weight: typeof r.trail_vote_weight === "number" ? r.trail_vote_weight : WEIGHT,
      status: "pending",
    })),
    skipDuplicates: true,
  });
  // Record the pacing target with the post's CURRENT real-vote baseline.
  const [author, permlink] = castHash.replace(/^hive:/, "").split("/");
  const baseline = (await countVotes(author, permlink)) ?? 0;
  await prisma.trailBoostTarget
    .upsert({
      where: { castHash },
      create: { castHash, baselineVotes: baseline, budget: pick.length, released: 0, status: "active" },
      update: {},
    })
    .catch(() => {});
  return pick.length;
}

// Cast a single boost vote for a pending row. Returns true on success.
async function castOne(prisma, ub, client, b, log) {
  const { PrivateKey } = require("@hiveio/dhive");
  const [author, permlink] = b.castHash.replace(/^hive:/, "").split("/");
  let status = "done", err = null;
  try {
    const { data } = await ub
      .from("userbase_hive_keys")
      .select("user_id, hive_username, encrypted_posting_key, encryption_iv, encryption_auth_tag")
      .eq("hive_username", b.hiveUsername).limit(1);
    const row = data && data[0];
    if (!row) throw new Error("no key row");
    const wif = decryptPostingKey(row);
    await client.broadcast.sendOperations(
      [["vote", { voter: b.hiveUsername, author, permlink, weight: b.weight }]],
      PrivateKey.fromString(wif),
    );
  } catch (e) {
    status = "failed"; err = (e && e.message ? e.message : String(e)).slice(0, 160);
  }
  await prisma.trailUserbaseBoost.update({ where: { id: b.id }, data: { status, error: err } }).catch(() => {});
  if (log) log(`[boost] ${b.hiveUsername} → ${b.castHash.slice(0, 18)} ${status}${err ? " " + err : ""}`);
  return status === "done";
}

// Proportional drain: for each active post, release boosts so the running total
// tracks REAL upvote growth (SEED kickstart + RATIO per real new vote), capped
// per tick, spaced randomly. Posts older than TTL_H stop and are marked done.
async function drainBoosts(prisma, log) {
  if (!enabled()) return;
  const targets = await prisma.trailBoostTarget.findMany({
    where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 12,
  }).catch(() => []);
  if (!targets.length) return;

  const ub = userbaseClient();
  const { Client } = require("@hiveio/dhive");
  const client = new Client(HIVE_NODES);
  const now = Date.now();

  for (const t of targets) {
    // Expire old targets.
    if (now - new Date(t.createdAt).getTime() > TTL_H * 3_600_000) {
      await prisma.trailBoostTarget.update({ where: { castHash: t.castHash }, data: { status: "done" } }).catch(() => {});
      continue;
    }
    const [author, permlink] = t.castHash.replace(/^hive:/, "").split("/");
    const direct = t.mode === "direct";
    const total = await countVotes(author, permlink);
    if (total == null && !direct) continue; // organic needs the live count; direct doesn't
    const realGrowth = total == null ? 0 : Math.max(0, total - t.released - t.baselineVotes); // exclude our own boosts
    // direct: release the whole budget over random intervals, independent of likes.
    // organic: pace the release to real upvote growth (SEED kickstart + RATIO/vote).
    const allowed = direct ? t.budget : Math.min(t.budget, SEED + Math.floor(realGrowth * RATIO));
    const toRelease = Math.min(Math.max(0, allowed - t.released), PER_TICK);
    if (toRelease <= 0) {
      if (t.released >= t.budget) {
        await prisma.trailBoostTarget.update({ where: { castHash: t.castHash }, data: { status: "done" } }).catch(() => {});
      }
      continue;
    }
    const batch = await prisma.trailUserbaseBoost.findMany({
      where: { castHash: t.castHash, status: "pending" }, orderBy: { createdAt: "asc" }, take: toRelease,
    }).catch(() => []);
    let releasedNow = 0;
    for (let i = 0; i < batch.length; i++) {
      if (await castOne(prisma, ub, client, batch[i], log)) releasedNow++;
      if (i < batch.length - 1) await new Promise((r) => setTimeout(r, MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS))));
    }
    if (releasedNow) {
      const released = t.released + releasedNow;
      await prisma.trailBoostTarget
        .update({ where: { castHash: t.castHash }, data: { released, status: released >= t.budget ? "done" : "active" } })
        .catch(() => {});
      if (log) log(`[boost] ${t.castHash.slice(0, 18)} ${direct ? "direct" : "organic"} released ${releasedNow} (total ${released}/${t.budget}${total == null ? "" : `, real≈${total - released}`})`);
    }
  }
}

module.exports = { enabled, queueBoosts, drainBoosts, SUBSET, WEIGHT };
