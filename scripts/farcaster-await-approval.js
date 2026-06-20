#!/usr/bin/env node
// Resume polling an already-created Neynar signer until it's approved, then
// store it in FarcasterSigner. Use after farcaster-connect-portal.js timed out
// waiting for the Warpcast approval.
//
// Usage: node scripts/farcaster-await-approval.js <projectSlug> <signer_uuid> <fid> [username]

"use strict";
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { PrismaClient } = require("@prisma/client");

const SLUG = (process.argv[2] || "").trim().toLowerCase();
const SIGNER = (process.argv[3] || "").trim();
const FID = parseInt(process.argv[4] || "", 10) || null;
const USERNAME = (process.argv[5] || "").trim() || null;
if (!SLUG || !SIGNER) {
  console.error("Usage: node scripts/farcaster-await-approval.js <projectSlug> <signer_uuid> <fid> [username]");
  process.exit(1);
}
const PREFIX = SLUG.toUpperCase();
const KEY = process.env[`${PREFIX}_NEYNAR_API_KEY`] || process.env.NEYNAR_API_KEY;

async function neynar(p) {
  const res = await fetch(`https://api.neynar.com${p}`, { headers: { "x-api-key": KEY, accept: "application/json" } });
  return res.json();
}

(async () => {
  console.log(`Polling signer ${SIGNER} for "${SLUG}" (up to ~5 min)...`);
  for (let i = 0; i < 300; i++) {
    const s = await neynar(`/v2/farcaster/signer?signer_uuid=${SIGNER}`);
    if (s.status === "approved") {
      console.log(`\n✅ Approved. fid=${s.fid}`);
      const prisma = new PrismaClient();
      try {
        await prisma.farcasterSigner.upsert({
          where: { projectSlug: SLUG },
          update: { signerUuid: SIGNER, fid: s.fid ?? FID, username: USERNAME, status: "approved", connectedBy: "setup-script" },
          create: { projectSlug: SLUG, signerUuid: SIGNER, fid: s.fid ?? FID, username: USERNAME, status: "approved", connectedBy: "setup-script" },
        });
        console.log(`Stored signer for "${SLUG}" in FarcasterSigner.`);
      } finally { await prisma.$disconnect(); }
      console.log("\nDONE. Now DELETE the mnemonic line from .env.local.");
      return;
    }
    if (s.status === "revoked") { console.error("Signer revoked."); process.exit(1); }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("\nStill not approved. Re-run this script once you've approved in Warpcast.");
  process.exit(1);
})();
