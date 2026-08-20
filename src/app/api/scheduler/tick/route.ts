// Scheduler tick endpoint — the Mac PM2 worker POSTs here every ~10s. This is
// the PRIMARY publisher (runs on the Mac → residential IP, good for Instagram).
// The actual work lives in @/lib/scheduler-core so the Vercel fallback cron
// (/api/scheduler/cron) can share it.
//
// A request carrying `x-scheduler-source: mac` also refreshes the heartbeat
// lease, which is how the Vercel fallback knows the Mac is alive and stays out
// of the way. The lease is refreshed only AFTER a successful run, so if this
// route errors (e.g. Neon unreachable) the lease goes stale and Vercel takes over.

import { NextResponse } from "next/server";
import { runScheduledPublish, touchMacLease, findDueItems } from "@/lib/scheduler-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SHARED_SECRET = process.env.SCHEDULER_TICK_SECRET;

function authorized(req: Request): boolean {
  if (!SHARED_SECRET) return true;
  const header = req.headers.get("x-scheduler-secret");
  return header === SHARED_SECRET;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const result = await runScheduledPublish(now);

  // Refresh the Mac heartbeat only after a successful run, and only for the
  // Mac worker (not ad-hoc manual POSTs).
  if (req.headers.get("x-scheduler-source") === "mac") {
    await touchMacLease(now);
  }

  return NextResponse.json(result);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await findDueItems(Date.now());
  return NextResponse.json({ pendingDue: due.length });
}
