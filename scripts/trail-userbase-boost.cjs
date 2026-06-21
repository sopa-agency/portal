// Pool B — community-key boost. When a COMPANY posts on Hive, a random rotating
// subset of the SkateHive userbase posting keys upvotes it at a low weight,
// spread over time. Decrypts userbase_hive_keys with USERBASE_KEY_ENCRYPTION_SECRET
// (replicating skatehive3.0 lib/userbase/encryption.decryptHivePostingKey).
//
// Inert unless USERBASE_KEY_ENCRYPTION_SECRET + SUPABASE_USERBASE_* are set and
// TRAIL_BOOST_ENABLED is truthy. Only company posts are boosted; never members.
"use strict";

const crypto = require("node:crypto");

const SUBSET = Number(process.env.TRAIL_BOOST_SUBSET ?? 40);
const WEIGHT = Math.max(1, Math.min(10000, Number(process.env.TRAIL_BOOST_WEIGHT ?? 1000))); // ~10%
const BATCH = Number(process.env.TRAIL_BOOST_BATCH ?? 8);
const MIN_MS = Number(process.env.TRAIL_BOOST_MIN_MS ?? 60_000); // 1 min
const MAX_MS = Number(process.env.TRAIL_BOOST_MAX_MS ?? 300_000); // 5 min
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];

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
async function queueBoosts(prisma, castHash) {
  if (!enabled()) return 0;
  const ub = userbaseClient();
  // Respect consent: exclude anyone who opted OUT of supporting official posts.
  // Default (column null/false) = opted in. Falls back gracefully if the
  // trail_opt_out column doesn't exist yet (pre-migration).
  let data;
  const filtered = await ub
    .from("userbase_hive_keys")
    .select("hive_username")
    .or("trail_opt_out.is.null,trail_opt_out.eq.false")
    .limit(2000);
  if (filtered.error) {
    const all = await ub.from("userbase_hive_keys").select("hive_username").limit(2000);
    data = all.data;
    console.warn("[boost] trail_opt_out column missing — using all keys (run the skatehive3.0 migration to enable opt-out).");
  } else {
    data = filtered.data;
  }
  const names = shuffle((data || []).map((r) => r.hive_username).filter(Boolean));
  const pick = names.slice(0, SUBSET);
  if (!pick.length) return 0;
  await prisma.trailUserbaseBoost.createMany({
    data: pick.map((u) => ({ castHash, hiveUsername: u, weight: WEIGHT, status: "pending" })),
    skipDuplicates: true,
  });
  return pick.length;
}

// Drain a batch of pending boosts: decrypt key, upvote, space out randomly.
async function drainBoosts(prisma, log) {
  if (!enabled()) return;
  const pending = await prisma.trailUserbaseBoost.findMany({
    where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: BATCH,
  }).catch(() => []);
  if (!pending.length) return;

  const ub = userbaseClient();
  const { Client, PrivateKey } = require("@hiveio/dhive");
  const client = new Client(HIVE_NODES);

  for (let i = 0; i < pending.length; i++) {
    const b = pending[i];
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
      const op = ["vote", { voter: b.hiveUsername, author, permlink, weight: b.weight }];
      await client.broadcast.sendOperations([op], PrivateKey.fromString(wif));
    } catch (e) {
      status = "failed"; err = (e && e.message ? e.message : String(e)).slice(0, 160);
    }
    await prisma.trailUserbaseBoost.update({ where: { id: b.id }, data: { status, error: err } }).catch(() => {});
    if (log) log(`[boost] ${b.hiveUsername} → ${b.castHash.slice(0, 18)} ${status}${err ? " " + err : ""}`);
    if (i < pending.length - 1) {
      await new Promise((r) => setTimeout(r, MIN_MS + Math.floor(Math.random() * (MAX_MS - MIN_MS))));
    }
  }
}

module.exports = { enabled, queueBoosts, drainBoosts, SUBSET, WEIGHT };
