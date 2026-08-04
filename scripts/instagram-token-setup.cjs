#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Instagram credential setup for a brand portal.
//
// Every portal publishes with its OWN Meta credentials — brand-env.ts blocks
// cross-brand fallback on purpose, so a new brand stays unable to post until
// ${PREFIX}_INSTAGRAM_ACCESS_TOKEN + ${PREFIX}_INSTAGRAM_BUSINESS_ACCOUNT_ID
// exist. This script produces both.
//
//   Discover (short-lived user token from the Graph API Explorer):
//     node scripts/instagram-token-setup.cjs --prefix NOGENTA --token EAAG…
//
//   Verify what's already in .env.local:
//     node scripts/instagram-token-setup.cjs --prefix NOGENTA --check
//
// Needs META_APP_ID + META_APP_SECRET (env or --app-id/--app-secret) to trade
// the short-lived token for a long-lived one. Page tokens derived from a
// long-lived user token don't expire, which is what the portal wants.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const GRAPH = "https://graph.facebook.com/v21.0";

// ── args ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 19).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

const prefix = String(args.prefix ?? "").toUpperCase();
if (!prefix) {
  console.error("Missing --prefix (e.g. --prefix NOGENTA). It must match the project's agent.gatewayEnvPrefix.");
  process.exit(1);
}

// ── .env.local reader (no dotenv dependency) ───────────────────────────────
function loadEnvLocal() {
  const file = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnvLocal();
const env = (key) => process.env[key]?.trim() || fileEnv[key] || undefined;

async function graph(pathname, params) {
  const url = new URL(GRAPH + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`${e.type ?? res.status}: ${e.message ?? res.statusText}`);
  }
  return json;
}

/** Redact a token in logs — first 8 chars is enough to tell two apart. */
const short = (t) => `${String(t).slice(0, 8)}…(${String(t).length} chars)`;

// ── --check: validate the credentials already configured ───────────────────
async function check() {
  const token = env(`${prefix}_INSTAGRAM_ACCESS_TOKEN`);
  const igid = env(`${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID`);

  console.log(`\nChecking ${prefix}_INSTAGRAM_* …\n`);
  if (!token) return console.error(`✗ ${prefix}_INSTAGRAM_ACCESS_TOKEN is not set.`);
  if (!igid) return console.error(`✗ ${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID is not set.`);

  try {
    const me = await graph(`/${igid}`, {
      fields: "username,name,followers_count,media_count",
      access_token: token,
    });
    console.log(`✓ Token works — @${me.username} (${me.name ?? "no name"})`);
    console.log(`  ${me.followers_count ?? "?"} followers · ${me.media_count ?? "?"} posts · IG id ${igid}`);
  } catch (e) {
    console.error(`✗ Graph API rejected the credentials: ${e.message}`);
    return;
  }

  // Publishing needs the content-publishing permission; the quota endpoint is
  // the cheapest way to prove it's granted (and shows the 100 posts/24h limit).
  try {
    const q = await graph(`/${igid}/content_publishing_limit`, {
      fields: "config,quota_usage",
      access_token: token,
    });
    const row = q.data?.[0] ?? {};
    const cap = row.config?.quota_total ?? 100;
    console.log(`✓ Publishing permission granted — ${row.quota_usage ?? 0}/${cap} posts used in the last 24h`);
  } catch (e) {
    console.error(`✗ Can't read the publishing quota — instagram_content_publish is probably missing: ${e.message}`);
  }

  // Expiry: page tokens from a long-lived user token report no expiry.
  const appId = env("META_APP_ID");
  const appSecret = env("META_APP_SECRET");
  if (appId && appSecret) {
    try {
      const d = await graph("/debug_token", {
        input_token: token,
        access_token: `${appId}|${appSecret}`,
      });
      const data = d.data ?? {};
      const exp = data.expires_at;
      console.log(
        exp === 0 || exp === undefined
          ? "✓ Token never expires (page token from a long-lived user token)"
          : `⚠ Token expires ${new Date(exp * 1000).toISOString()} — re-run this script before then`,
      );
    } catch {
      /* debug_token is a nice-to-have; ignore failures */
    }
  }
  console.log("");
}

// ── default: exchange + discover pages/IG accounts ─────────────────────────
async function discover() {
  const appId = args["app-id"] ?? env("META_APP_ID");
  const appSecret = args["app-secret"] ?? env("META_APP_SECRET");
  const shortToken = args.token ?? env("META_SHORT_LIVED_TOKEN");

  if (!shortToken) {
    console.error(
      "Missing --token. Grab a User token from https://developers.facebook.com/tools/explorer\n" +
        "with these permissions: pages_show_list, business_management, instagram_basic,\n" +
        "instagram_content_publish, instagram_manage_comments, instagram_manage_insights,\n" +
        "pages_read_engagement, pages_manage_posts.",
    );
    process.exit(1);
  }
  if (!appId || !appSecret) {
    console.error("Missing META_APP_ID / META_APP_SECRET (env or --app-id / --app-secret).");
    process.exit(1);
  }

  console.log("\n1. Exchanging the short-lived token for a long-lived one…");
  const longLived = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const userToken = longLived.access_token;
  const days = longLived.expires_in ? Math.round(longLived.expires_in / 86400) : "?";
  console.log(`   ✓ long-lived user token ${short(userToken)} — valid ~${days} days`);

  console.log("\n2. Listing Pages and their Instagram Business Accounts…");
  const pages = await graph("/me/accounts", {
    fields: "name,id,access_token,instagram_business_account{id,username,name,followers_count}",
    limit: "100",
    access_token: userToken,
  });

  const rows = pages.data ?? [];
  if (rows.length === 0) {
    console.error(
      "   ✗ No Pages returned. The IG account must be a Professional account connected to a\n" +
        "     Facebook Page, and your user must be an admin of that Page in Meta Business Suite.",
    );
    process.exit(1);
  }

  const withIg = rows.filter((p) => p.instagram_business_account);
  for (const p of rows) {
    const ig = p.instagram_business_account;
    console.log(
      ig
        ? `   • Page "${p.name}" (${p.id}) → @${ig.username} · IG id ${ig.id} · ${ig.followers_count ?? "?"} followers`
        : `   • Page "${p.name}" (${p.id}) → no Instagram Business Account connected`,
    );
  }

  if (withIg.length === 0) {
    console.error("\n   ✗ None of these Pages has an Instagram Business Account connected.");
    process.exit(1);
  }

  console.log(`\n3. Env lines — paste the block for the brand's account into .env.local:\n`);
  for (const p of withIg) {
    const ig = p.instagram_business_account;
    console.log(`# ${p.name} → @${ig.username}`);
    console.log(`${prefix}_INSTAGRAM_ACCESS_TOKEN=${p.access_token}`);
    console.log(`${prefix}_INSTAGRAM_BUSINESS_ACCOUNT_ID=${ig.id}\n`);
  }

  console.log(
    "Page tokens derived from a long-lived user token don't expire.\n" +
      `Verify afterwards with: node scripts/instagram-token-setup.cjs --prefix ${prefix} --check\n` +
      `Then mirror them to production: vercel env add ${prefix}_INSTAGRAM_ACCESS_TOKEN production\n`,
  );
}

(async () => {
  try {
    await (args.check ? check() : discover());
  } catch (e) {
    console.error(`\nFailed: ${e.message}\n`);
    process.exit(1);
  }
})();
