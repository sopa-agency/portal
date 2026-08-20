#!/usr/bin/env node
// One-shot setup: register a Neynar managed signer for @skatehive on Farcaster.
//
// Reads from .env.local:
//   NEYNAR_API_KEY        — Neynar developer API key
//   FARCASTER_MNEMONIC    — 24-word recovery phrase for the @skatehive custody address
// Writes back:
//   NEYNAR_SIGNER_UUID    — UUID of the approved signer (used by the worker/UI to post)
//
// After this completes successfully you can DELETE the FARCASTER_MNEMONIC line.
//
// Run: node scripts/farcaster-signer-setup.js

"use strict";

const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { mnemonicToAccount } = require("viem/accounts");

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const MNEMONIC = process.env.FARCASTER_MNEMONIC;
const FID = 538839; // @skatehive

if (!NEYNAR_API_KEY) throw new Error("NEYNAR_API_KEY missing from .env.local");
if (!MNEMONIC) throw new Error("FARCASTER_MNEMONIC missing from .env.local");

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
  if (!res.ok) {
    throw new Error(`Neynar ${method} ${p} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

function writeSignerUuidToEnv(uuid) {
  const file = path.join(__dirname, "..", ".env.local");
  let raw = fs.readFileSync(file, "utf8");
  if (/^NEYNAR_SIGNER_UUID=/m.test(raw)) {
    raw = raw.replace(/^NEYNAR_SIGNER_UUID=.*$/m, `NEYNAR_SIGNER_UUID="${uuid}"`);
  } else {
    raw += `\nNEYNAR_SIGNER_UUID="${uuid}"\n`;
  }
  fs.writeFileSync(file, raw);
}

async function main() {
  const account = mnemonicToAccount(MNEMONIC);
  console.log(`Custody address derived from mnemonic: ${account.address}`);
  console.log(`Expected for @skatehive (fid ${FID}): 0x97b78d7b3c66c2ffb961aa0adb6ce672a3716d8c`);
  if (account.address.toLowerCase() !== "0x97b78d7b3c66c2ffb961aa0adb6ce672a3716d8c") {
    throw new Error(
      `Custody mismatch — the mnemonic doesn't derive the expected @skatehive address. ` +
        `Check FARCASTER_MNEMONIC.`,
    );
  }

  console.log("Creating a fresh signer...");
  const signer = await neynar("POST", "/v2/farcaster/signer");
  console.log(`  signer_uuid: ${signer.signer_uuid}`);
  console.log(`  public_key:  ${signer.public_key}`);

  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h
  console.log("Signing EIP-712 SignedKeyRequest with custody key...");
  const signature = await account.signTypedData({
    domain: SIGNED_KEY_REQUEST_VALIDATOR,
    types: { SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE },
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: BigInt(FID),
      key: signer.public_key,
      deadline: BigInt(deadline),
    },
  });
  console.log(`  signature: ${signature.slice(0, 18)}…${signature.slice(-6)}`);

  console.log("Submitting signed_key to Neynar...");
  const registered = await neynar("POST", "/v2/farcaster/signer/signed_key", {
    signer_uuid: signer.signer_uuid,
    app_fid: FID,
    deadline,
    signature,
  });
  console.log(`  status: ${registered.status}`);
  if (registered.signer_approval_url) {
    console.log(`  approval_url: ${registered.signer_approval_url}`);
  }

  console.log("Polling signer status (~30s)...");
  let last;
  for (let i = 0; i < 30; i++) {
    const state = await neynar("GET", `/v2/farcaster/signer?signer_uuid=${signer.signer_uuid}`);
    last = state;
    if (state.status === "approved") {
      console.log(`✅ Signer approved. fid=${state.fid}`);
      writeSignerUuidToEnv(signer.signer_uuid);
      console.log(`Wrote NEYNAR_SIGNER_UUID=${signer.signer_uuid} to .env.local`);
      console.log("\nYou can now delete the FARCASTER_MNEMONIC line from .env.local.");
      return;
    }
    if (state.status === "revoked") {
      throw new Error("Signer was revoked.");
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("\nTimed out waiting for approval. Last state:", last);
  console.error("If approval_url was printed above, open it in Warpcast as @skatehive and re-run polling.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
