// Vercel cron. Invoked by Vercel Cron (GET, hourly — see vercel.json). It is a SAFETY NET, not the primary publisher: it only runs the
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
import { snapshotTreasuryWalletsIfDue } from "@/lib/treasury-wallet-snapshots";
import { rodadaSemanalIfDue } from "@/lib/split-vote-weekly";
import { refillStreamIfLow } from "@/lib/stream-autopilot";
import { dispatchSkatehiveScheduledPosts } from "@/lib/skatehive-scheduled-posts";
import { probeZerionQuota } from "@/lib/zerion-probe";

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
  // CONDITIONAL GUARANTEE: this claim serialises via Postgres, so it only
  // coordinates deploys that point at the SAME database. Two deploys on DIFFERENT
  // databases each claim count=1 in their own DB and BOTH run — this coordinates
  // nothing in that case. Whether that's happening is exactly the open Check-2
  // (shared-DB) question; until it's confirmed, this guarantee is conditional.
  //
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

  // Foto horária do saldo de cada carteira de tesouro — é isto que alimenta o
  // gráfico de linhas sobrepostas. Dentro do claim: uma leitura por hora, não
  // uma por deployment que carrega o cron.
  const walletSnapshot = claimedActions
    ? await snapshotTreasuryWalletsIfDue(now).catch((e) => ({ ran: false, reason: String(e) }))
    : { skipped: "tick-claimed" as const };

  // A urna semanal do split: abre segunda depois da reunião, fecha 48h depois.
  // Só abre e fecha — aplicar o resultado no contrato segue sendo clique humano.
  const urnaSemanal = claimedActions
    ? await rodadaSemanalIfDue(new Date(now)).catch((e) => ({ ran: false, reason: String(e) }))
    : { skipped: "tick-claimed" as const };

  // SkateHive's scheduled-post processor (skatehive3.0 #135) has no cron of its
  // own — this tick is what makes it run. Deliberately OUTSIDE the per-hour
  // claim and outside the mac-lease branch, so it fires on every tick no matter
  // which deployment won the claim or whether the Mac is up. See the module for
  // why that is the safe choice rather than the sloppy one.
  const skatehiveScheduled = await dispatchSkatehiveScheduledPosts();

  // Sonda de cota da Zerion — uma chamada barata a /v1/chains/ (não consome
  // cota de carteira) só para capturar os headers de rate limit. Roda aqui
  // porque a chave é write-only na Vercel: só o runtime a enxerga. Gravada no
  // Postgres porque log da Vercel não é legível por API. Sai quando a cota
  // estiver medida e o botão de sync assumir o mesmo logging.
  const zerionProbe = claimedActions ? await probeZerionQuota() : { ok: false, error: "tick-claimed" };

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
      walletSnapshot,
      urnaSemanal,
      skatehiveScheduled,
      zerionProbe,
    });
  }

  // Mac is down → take over.
  const result = await runScheduledPublish(now);
  return NextResponse.json({ ...result, fallback: true, skipped: false, claimedActions, autoBoost, revenue, streamRefill, walletSnapshot, urnaSemanal, skatehiveScheduled, zerionProbe });
}
