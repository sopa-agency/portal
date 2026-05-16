#!/usr/bin/env node
// Test publishing a SkateHive Hive SNAP as @skatehive.
// SNAP pattern (matches skatehive3.0 web app's SnapComposer): a comment under
// peak.snaps' latest daily container. Posts inherit the Snaps community on-chain
// but are tagged with hive-173115 in json_metadata so SkateHive frontends pick
// them up. DOES NOT post a top-level root in hive-173115 — those become full
// blog posts in the SkateHive community feed, which is the wrong destination
// for tweet-shape content.
//
// Modes:
//   node scripts/hive-snap-test.js              # DRY RUN
//   node scripts/hive-snap-test.js --broadcast  # Publish (real, public, permanent)

"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { Client, PrivateKey } = require("@hiveio/dhive");

const HIVE_POSTING_ACCOUNT = process.env.HIVE_POSTING_ACCOUNT;
const HIVE_POSTING_KEY = process.env.HIVE_POSTING_KEY;
const BROADCAST = process.argv.includes("--broadcast");

if (!HIVE_POSTING_ACCOUNT) throw new Error("HIVE_POSTING_ACCOUNT missing");
if (!HIVE_POSTING_KEY) throw new Error("HIVE_POSTING_KEY missing");

const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];
const SNAPS_CONTAINER_AUTHOR = "peak.snaps";
const COMMUNITY_TAG = "hive-173115";

const TEST_BODY = `Testing the new SkateHive ops portal snap pipeline. 🛹`;

async function main() {
  const client = new Client(HIVE_NODES);

  console.log("Fetching latest peak.snaps container...");
  const containers = await client.database.call("get_discussions_by_author_before_date", [
    SNAPS_CONTAINER_AUTHOR,
    "",
    new Date().toISOString().split(".")[0],
    1,
  ]);
  if (!containers?.[0]) throw new Error("Could not fetch peak.snaps container");
  const parentPermlink = containers[0].permlink;
  console.log(`  parent: ${SNAPS_CONTAINER_AUTHOR}/${parentPermlink}`);

  const permlink = `snap-${crypto.randomUUID()}`;
  const metadata = {
    app: "Portal Skatehive",
    tags: [COMMUNITY_TAG, "snaps"],
    images: [],
  };
  const op = [
    "comment",
    {
      parent_author: SNAPS_CONTAINER_AUTHOR,
      parent_permlink: parentPermlink,
      author: HIVE_POSTING_ACCOUNT,
      permlink,
      title: "",
      body: TEST_BODY,
      json_metadata: JSON.stringify(metadata),
    },
  ];

  console.log("\n--- COMMENT OP ---");
  console.log(JSON.stringify(op, null, 2));
  console.log("\n--- VIEW URLS (after broadcast) ---");
  console.log(`https://skatehive.app/post/${HIVE_POSTING_ACCOUNT}/${permlink}`);

  if (!BROADCAST) {
    console.log("\nDRY RUN — pass --broadcast to actually publish.");
    return;
  }

  const key = PrivateKey.fromString(HIVE_POSTING_KEY);
  const result = await client.broadcast.sendOperations([op], key);
  console.log("\n✅ Broadcast accepted:");
  console.log(`  trx_id: ${result.id ?? result.trx_id}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  if (err.jse_info) console.error("  jse_info:", err.jse_info);
  process.exit(1);
});
