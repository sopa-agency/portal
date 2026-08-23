// Vercel fallback cron. Invoked by Vercel Cron (GET, every few minutes — see
// vercel.json). It is a SAFETY NET, not the primary publisher: it only runs the
// due-post publisher when the Mac's heartbeat lease is stale (i.e. the Mac
// worker/portal is down). When the Mac is alive, this no-ops so normal posting
// stays on the Mac (residential IP).
//
// Auth: Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when a
// CRON_SECRET env var is configured. We verify it when present.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

  // ── One-run-per-hour claim for the autopilot actions ───────────────────────
  // auto-boost / revenue snapshot / stream refill must run ONCE per hour even
  // when several deployments carry this cron (during the repo consolidation BOTH
  // sopa-agency/portal and the sunset marketing-portal fire it hourly). Claim the
  // hour with an ATOMIC conditional UPDATE on the shared SchedulerLease: Postgres
  // serialises it, so exactly ONE cron flips lastActionsTickAt into this hour and
  // runs the actions; the other sees it already claimed and skips them.
  //
  // Do NOT fold this into the Mac publish-lease. These actions are NOT
  // residential-IP-sensitive and MUST run even when the Mac worker is alive —
  // gating them behind mac-stale would silently stop the hourly snapshots/boosts/
  // refills whenever the Mac is up. That is why this is a SEPARATE per-hour claim,
  // not a reuse of the publish lease. (Looks like redundancy; it isn't — don't
  // "simplify" it into the lease later.)
  //
  // Deliberate side effect: with this claim, how many deployments carry the cron
  // stops mattering — no double-run, and no window where NEITHER runs. The Step-4
  // cutover no longer needs the choreographed "add here → wait for a fire → then
  // disable there" sequence; either side can be turned off at any time.
  const hourStart = new Date(now);
  hourStart.setUTCMinutes(0, 0, 0);
  const claim = await prisma.schedulerLease
    .updateMany({
      where: { id: "singleton", OR: [{ lastActionsTickAt: null }, { lastActionsTickAt: { lt: hourStart } }] },
      data: { lastActionsTickAt: new Date(now) },
    })
    .catch(() => ({ count: 0 }));
  let claimedActions = claim.count === 1;
  if (!claimedActions) {
    // The singleton row might not exist yet — create-as-claim (unique id makes
    // this atomic: only one concurrent create wins).
    claimedActions = await prisma.schedulerLease
      .create({ data: { id: "singleton", lastActionsTickAt: new Date(now) } })
      .then(() => true)
      .catch(() => false);
  }

  // Only the cron that claimed the hour runs the actions; the other skips them.
  // `claimedActions` is echoed below so the LOG distinguishes the two deployments
  // — one "claimed + ran", the other "tick-claimed" — at the same hour.
  const autoBoost = claimedActions
    ? await autoBoostFromVotes().catch((e) => ({ ok: false, error: String(e) }))
    : { skipped: "tick-claimed" as const };
  const revenue = claimedActions
    ? await snapshotRevenueIfDue(now).catch((e) => ({ ran: false, reason: String(e) }))
    : { skipped: "tick-claimed" as const };
  const streamRefill = claimedActions
    ? await refillStreamIfLow().catch((e) => ({ ran: false, reason: String(e) }))
    : { skipped: "tick-claimed" as const };

  if (!(await macLeaseIsStale(now))) {
    return NextResponse.json({
      checkedAt: new Date(now).toISOString(),
      fallback: true,
      skipped: true,
      reason: `mac-alive (within ${Math.round(MAC_LEASE_GRACE_MS / 60000)}m grace)`,
      claimedActions,
      autoBoost,
      revenue,
      streamRefill,
    });
  }

  // Mac is down → take over.
  const result = await runScheduledPublish(now);
  return NextResponse.json({ ...result, fallback: true, skipped: false, claimedActions, autoBoost, revenue, streamRefill });
}
