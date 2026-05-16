#!/usr/bin/env node
// Test publishing a Farcaster cast as @skatehive into the /skatehive channel
// via Neynar's managed signer.
//
// Modes:
//   node scripts/farcaster-cast-test.js              # DRY RUN
//   node scripts/farcaster-cast-test.js --broadcast  # Actually casts (public, permanent)

"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID;
const BROADCAST = process.argv.includes("--broadcast");

if (!NEYNAR_API_KEY) throw new Error("NEYNAR_API_KEY missing");
if (!NEYNAR_SIGNER_UUID) throw new Error("NEYNAR_SIGNER_UUID missing — approve a signer first");

const CHANNEL_ID = "skateboard";
const TEXT = `Testing the new SkateHive ops portal — casting straight from our internal tool into /skateboard. If you see this in the channel, the wiring works. 🛹`;

async function neynar(method, p, body) {
  const res = await fetch(`https://api.neynar.com${p}`, {
    method,
    headers: {
      "x-api-key": NEYNAR_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`Neynar ${method} ${p} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const payload = {
    signer_uuid: NEYNAR_SIGNER_UUID,
    text: TEXT,
    channel_id: CHANNEL_ID,
  };

  console.log("--- CAST PAYLOAD ---");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\n--- WHERE IT WILL APPEAR ---");
  console.log(`Channel feed:   https://warpcast.com/~/channel/${CHANNEL_ID}`);
  console.log(`Author profile: https://warpcast.com/skatehive`);

  if (!BROADCAST) {
    console.log("\nDRY RUN — pass --broadcast to actually cast.");
    return;
  }

  console.log("\nCasting...");
  const result = await neynar("POST", "/v2/farcaster/cast", payload);
  console.log("\n✅ Cast accepted:");
  const cast = result.cast || result;
  console.log(`  hash:   ${cast.hash}`);
  console.log(`  author: @${cast.author?.username ?? "skatehive"} (fid ${cast.author?.fid ?? "538839"})`);
  if (cast.hash) {
    console.log(`  permalink: https://warpcast.com/skatehive/${cast.hash.slice(0, 10)}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
