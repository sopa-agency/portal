#!/usr/bin/env node
// Seed/refresh the TrailAccount registry from what we currently have wired.
// Idempotent (upsert by kind+label). Safe to re-run.

"use strict";
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // @gnars signer was approved via the sponsor (global skatehive app) and is
  // sitting in FarcasterMemberSigner (connected while logged in as xvlad).
  const gnarsSigner = await prisma.farcasterMemberSigner
    .findFirst({ where: { handle: "gnars", status: "approved" } })
    .catch(() => null);

  const accounts = [
    // ── Companies ──────────────────────────────────────────────────────────
    {
      kind: "company", label: "skatehive", ownerSlug: "skatehive",
      fid: 538839, fcSignerUuid: process.env.NEYNAR_SIGNER_UUID || null, fcApiKeyEnv: "NEYNAR_API_KEY",
      hiveAccount: "skatehive", hiveKeyEnv: "HIVE_POSTING_KEY",
    },
    {
      kind: "company", label: "gnars", ownerSlug: "gnars",
      // @gnars (fid 3757) — signer minted under the GLOBAL app, so use NEYNAR_API_KEY.
      fid: 3757, fcSignerUuid: gnarsSigner ? gnarsSigner.signerUuid : null, fcApiKeyEnv: "NEYNAR_API_KEY",
      hiveAccount: "gnars", hiveKeyEnv: "GNARS_HIVE_POSTING_KEY",
    },
    {
      kind: "company", label: "reelflip", ownerSlug: "reelflip",
      fid: 3338092, fcSignerUuid: null /* resolved from FarcasterSigner at runtime */, fcApiKeyEnv: "NEYNAR_API_KEY",
      hiveAccount: "reelflip", hiveKeyEnv: "REELFLIP_HIVE_POSTING_KEY",
    },
    {
      // nogenta posts to Hive as @nogenta — WATCHED so its posts get the Pool-B
      // community boost. No posting key wired (it's a boost target, not an actor).
      kind: "company", label: "nogenta", ownerSlug: "nogenta",
      fid: 814250, fcSignerUuid: null, fcApiKeyEnv: "NEYNAR_API_KEY",
      hiveAccount: "nogenta", hiveKeyEnv: null,
    },
    // ── Agents ────────────────────────────────────────────────────────────-
    {
      kind: "agent", label: "bobgnarley", ownerSlug: "gnars",
      // bobgnarley (fid 2808368) — signer in the gnars PAID app, so likes work.
      fid: 2808368, fcSignerUuid: process.env.GNARS_NEYNAR_SIGNER_UUID || null, fcApiKeyEnv: "GNARS_NEYNAR_API_KEY",
      hiveAccount: null, hiveKeyEnv: null,
    },
  ];

  for (const a of accounts) {
    const existing = await prisma.trailAccount.findUnique({ where: { kind_label: { kind: a.kind, label: a.label } } }).catch(() => null);
    if (existing) {
      await prisma.trailAccount.update({ where: { id: existing.id }, data: a });
      console.log(`updated ${a.kind}/${a.label} (fid ${a.fid}) signer=${a.fcSignerUuid ? a.fcSignerUuid.slice(0, 8) + "…" : "(runtime)"}`);
    } else {
      await prisma.trailAccount.create({ data: a });
      console.log(`created ${a.kind}/${a.label} (fid ${a.fid})`);
    }
  }
  console.log("\nRegistry now:");
  const all = await prisma.trailAccount.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] });
  for (const a of all) console.log(`  [${a.kind}] ${a.label} fid=${a.fid ?? "-"} hive=${a.hiveAccount ?? "-"} enabled=${a.enabled} autoLike=${a.autoLike}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
