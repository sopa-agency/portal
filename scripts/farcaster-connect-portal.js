#!/usr/bin/env node
// Connect a portal's Farcaster account via a Neynar managed signer + approval
// link. Generalizes scripts/farcaster-signer-setup.js (which was hardcoded to
// @skatehive) to ANY project, and stores the approved signer in the DB
// (FarcasterSigner table) so it lights up the Settings "Conectar Farcaster"
// card with NO env edit / redeploy.
//
// Usage:
//   node scripts/farcaster-connect-portal.js <projectSlug> <fid>
//
// Reads from .env.local (the account is the SPONSOR + the APPROVER — self-serve):
//   <SLUG>_FARCASTER_MNEMONIC  (or FARCASTER_MNEMONIC) — 24-word recovery phrase
//   <PREFIX>_NEYNAR_API_KEY    (or NEYNAR_API_KEY)
//
// The mnemonic is used ONCE to sign the on-chain key request, then you DELETE it.
// It is never printed. Run on the Mac mini (the file stays local).
//
// Flow: derive custody addr → look up fid → create signer → sign EIP-712
// SignedKeyRequest → register → print approval_url → you approve in Warpcast →
// poll until approved → upsert FarcasterSigner(projectSlug).

"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { mnemonicToAccount } = require("viem/accounts");
const { PrismaClient } = require("@prisma/client");

const SLUG = (process.argv[2] || "").trim().toLowerCase();
const ARG_FID = parseInt(process.argv[3] || "", 10);
if (!SLUG || !ARG_FID) {
  console.error("Usage: node scripts/farcaster-connect-portal.js <projectSlug> <fid>  (e.g. reelflip 3338092)");
  process.exit(1);
}
const PREFIX = SLUG.toUpperCase();

const MNEMONIC =
  process.env[`${PREFIX}_FARCASTER_MNEMONIC`] || process.env.FARCASTER_MNEMONIC;
const NEYNAR_API_KEY =
  process.env[`${PREFIX}_NEYNAR_API_KEY`] || process.env.NEYNAR_API_KEY;

if (!NEYNAR_API_KEY) throw new Error(`No Neynar API key (${PREFIX}_NEYNAR_API_KEY or NEYNAR_API_KEY) in .env.local`);
if (!MNEMONIC) throw new Error(`No mnemonic (${PREFIX}_FARCASTER_MNEMONIC or FARCASTER_MNEMONIC) in .env.local`);

const SIGNED_KEY_REQUEST_VALIDATOR = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553",
};
const SIGNED_KEY_REQUEST_TYPE = [
  { name: "requestFid", type: "uint256" },
  { name: "key", type: "bytes" },
  { name: "deadline", type: "uint256" },
];

async function neynar(method, p, body) {
  const res = await fetch(`https://api.neynar.com${p}`, {
    method,
    headers: { "x-api-key": NEYNAR_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Neynar ${method} ${p} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  const account = mnemonicToAccount(MNEMONIC);
  console.log(`Custody address: ${account.address}`);

  // Verify the mnemonic actually controls the given fid via the free bulk
  // endpoint (the custody-address lookup is a paid feature).
  const bulk = await neynar("GET", `/v2/farcaster/user/bulk?fids=${ARG_FID}`);
  const user = bulk?.users?.[0];
  if (!user) throw new Error(`fid ${ARG_FID} not found on Farcaster.`);
  const username = user.username;
  if ((user.custody_address || "").toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Custody mismatch: the mnemonic derives ${account.address}, but fid ${ARG_FID} ` +
      `(@${username}) is custodied by ${user.custody_address}. Wrong recovery phrase.`,
    );
  }
  const fid = ARG_FID;
  console.log(`Account: @${username} (fid ${fid}) — custody verified, sponsor + approver`);

  console.log("Creating a fresh signer...");
  const signer = await neynar("POST", "/v2/farcaster/signer");
  console.log(`  signer_uuid: ${signer.signer_uuid}`);

  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h
  console.log("Signing EIP-712 SignedKeyRequest with custody key...");
  const signature = await account.signTypedData({
    domain: SIGNED_KEY_REQUEST_VALIDATOR,
    types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE },
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(fid), key: signer.public_key, deadline: BigInt(deadline) },
  });

  console.log("Submitting signed_key to Neynar...");
  const registered = await neynar("POST", "/v2/farcaster/signer/signed_key", {
    signer_uuid: signer.signer_uuid,
    app_fid: fid,
    deadline,
    signature,
  });
  console.log(`  status: ${registered.status}`);
  if (registered.signer_approval_url) {
    console.log("\n==================================================================");
    console.log(" APPROVE THIS in Warpcast (open as @" + username + "):");
    console.log("   " + registered.signer_approval_url);
    console.log("==================================================================\n");
  }

  console.log("Polling for approval (up to ~3 min)...");
  let last;
  for (let i = 0; i < 180; i++) {
    const state = await neynar("GET", `/v2/farcaster/signer?signer_uuid=${signer.signer_uuid}`);
    last = state;
    if (state.status === "approved") {
      console.log(`\n✅ Approved. fid=${state.fid}`);
      const prisma = new PrismaClient();
      try {
        await prisma.farcasterSigner.upsert({
          where: { projectSlug: SLUG },
          update: { signerUuid: signer.signer_uuid, fid: state.fid ?? fid, username, status: "approved", connectedBy: "setup-script" },
          create: { projectSlug: SLUG, signerUuid: signer.signer_uuid, fid: state.fid ?? fid, username, status: "approved", connectedBy: "setup-script" },
        });
        console.log(`Stored signer for "${SLUG}" in FarcasterSigner.`);
      } finally {
        await prisma.$disconnect();
      }
      console.log("\nDONE. Now DELETE the mnemonic line from .env.local.");
      return;
    }
    if (state.status === "revoked") throw new Error("Signer was revoked.");
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("\nTimed out. Last state:", last);
  console.error("If the approval_url was printed, open it in Warpcast and re-run.");
  process.exit(1);
}

main().catch((err) => { console.error("\n" + err.message); process.exit(1); });
