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
import { prisma } from "@/lib/prisma";
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
    // E registra QUAL máquina bateu. O lease é singleton — com duas máquinas
    // ligadas, a segunda sumiria dentro da primeira. Worker que ainda não manda
    // o cabeçalho continua funcionando e entra como "(sem nome)": o tick é a
    // batida do coração do publicador e não pode quebrar por causa de um painel.
    // Best-effort pelo mesmo motivo.
    const host = (req.headers.get("x-scheduler-host") ?? "").trim().toLowerCase().slice(0, 80) || "(sem nome)";
    void prisma.portalHost
      .upsert({
        where: { hostname: host },
        create: { hostname: host, lastTickAt: new Date(now), source: "mac" },
        update: { lastTickAt: new Date(now), tickCount: { increment: 1 } },
      })
      .catch(() => {});
  }

  return NextResponse.json(result);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await findDueItems(Date.now());
  return NextResponse.json({ pendingDue: due.length });
}
