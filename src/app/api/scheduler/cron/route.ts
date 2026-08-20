// Vercel fallback cron. Invoked by Vercel Cron (GET, every few minutes — see
// vercel.json). It is a SAFETY NET, not the primary publisher: it only runs the
// due-post publisher when the Mac's heartbeat lease is stale (i.e. the Mac
// worker/portal is down). When the Mac is alive, this no-ops so normal posting
// stays on the Mac (residential IP).
//
// Auth: Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when a
// CRON_SECRET env var is configured. We verify it when present.

import { NextResponse } from "next/server";
import { runScheduledPublish, macLeaseIsStale } from "@/lib/scheduler-core";
import { MAC_LEASE_GRACE_MS } from "@/lib/scheduler-lease";
import { autoBoostFromVotes } from "@/lib/auto-boost";
import { snapshotRevenueIfDue } from "@/lib/revenue-snapshots";
import { refillStreamIfLow } from "@/lib/stream-autopilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET;

function authorized(req: Request): boolean {
  if (!CRON_SECRET) return true; // not configured yet — allow (set CRON_SECRET to lock down)
  return req.headers.get("authorization") === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();

  // Auto-boost on operator likes — runs every cron tick regardless of the mac
  // lease (it only reads Hive + queues DB rows; not residential-IP-sensitive).
  const autoBoost = await autoBoostFromVotes().catch((e) => ({ ok: false, error: String(e) }));

  // Revenue snapshots — records tracked org-chart balances (~once/day, self-
  // throttled). RPC reads + DB writes only, so it runs regardless of the lease.
  const revenue = await snapshotRevenueIfDue(now).catch((e) => ({ ran: false, reason: String(e) }));

  // Payroll autopilot — if the stream buffer is running low, propose the refill
  // (withdraw yield from the vault + wrap) for the Safe owners to sign. Read +
  // propose only; no funds move without their signatures.
  const streamRefill = await refillStreamIfLow().catch((e) => ({ ran: false, reason: String(e) }));

  if (!(await macLeaseIsStale(now))) {
    return NextResponse.json({
      checkedAt: new Date(now).toISOString(),
      fallback: true,
      skipped: true,
      reason: `mac-alive (within ${Math.round(MAC_LEASE_GRACE_MS / 60000)}m grace)`,
      autoBoost,
      revenue,
      streamRefill,
    });
  }

  // Mac is down → take over.
  const result = await runScheduledPublish(now);
  return NextResponse.json({ ...result, fallback: true, skipped: false, autoBoost, revenue, streamRefill });
}
