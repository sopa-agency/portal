"use server";

import { revalidatePath } from "next/cache";
import { prisma, withDbRetry } from "@/lib/prisma";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Controlled email outreach — delivers a campaign's "Email" artifact to a
// tracked audience in manual, daily-controlled BATCHES (see OutreachContact in
// prisma/schema.prisma). Reuses the campaign email content (parseEmail/renderEmail)
// and the blast unsubscribe footer, but adds per-recipient state so the same
// skater is never re-emailed within a campaign, plus re-engagement detection.
//
// Gated to the tenant that owns the GLOBAL userbase (SkateHive) — same reasoning
// as the userbase actions — and to the campaign's own project.
// ---------------------------------------------------------------------------

const USERBASE_OWNER_PREFIX = "SKATEHIVE";
// Low default to protect sending reputation on a re-engagement (dormant) list —
// start small and ramp up (warm-up). Adjustable per-send in the panel (1..MAX).
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 500;

type Campaign = { id: string; name: string; projectSlug: string };

/** Session + owner-tenant + campaign-ownership gate. Returns project + campaign. */
async function outreachGate(campaignId: string): Promise<{ project: ProjectConfig; campaign: Campaign }> {
  const { cookies } = await import("next/headers");
  const { SESSION_COOKIE, verifySession } = await import("@/lib/auth");
  const { getActiveProject } = await import("@/projects/index");
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) throw new Error("Unauthorized");
  if (project.agent.gatewayEnvPrefix !== USERBASE_OWNER_PREFIX) {
    throw new Error("Outreach is only available on the portal that owns the shared userbase.");
  }
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, projectSlug: true },
  });
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.projectSlug !== project.slug) throw new Error("Access denied.");
  return { project, campaign };
}

/** Resolve the campaign's "Email" document into { subject, html }. */
async function resolveCampaignEmail(
  campaignId: string,
  campaignName: string,
): Promise<{ subject: string; html: string } | { error: string }> {
  const doc = await prisma.campaignDocument.findFirst({
    where: { campaignId, name: "Email", isMain: false },
    select: { content: true },
  });
  if (!doc) return { error: 'No "Email" document in this campaign — generate it from the brief first.' };
  const { parseEmail, renderEmail } = await import("@/lib/campaign-email");
  const parsed = parseEmail(doc.content);
  if (parsed.kind === "document") return { subject: parsed.document.subject || campaignName, html: renderEmail(parsed.document) };
  if (parsed.kind === "legacy_html") return { subject: campaignName, html: parsed.html };
  return { error: "Email document is empty — nothing to send." };
}

export type OutreachStatus =
  | {
      ok: true;
      hasEmail: boolean;
      total: number;
      pending: number;
      sent: number;
      responded: number;
      bounced: number;
      sentToday: number;
    }
  | { ok: false; error: string };

/** Fast status snapshot for the panel (no Hive calls). */
export async function getOutreachStatus(campaignId: string): Promise<OutreachStatus> {
  try {
    const { campaign } = await outreachGate(campaignId);
    const [grouped, email, sentToday] = await Promise.all([
      prisma.outreachContact.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } }),
      resolveCampaignEmail(campaignId, campaign.name),
      (async () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return prisma.outreachContact.count({ where: { campaignId, sentAt: { gte: start } } });
      })(),
    ]);
    const by = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    const total = grouped.reduce((n, g) => n + g._count._all, 0);
    return {
      ok: true,
      hasEmail: !("error" in email),
      total,
      pending: by("pending"),
      sent: by("sent"),
      responded: by("responded"),
      bounced: by("bounced"),
      sentToday,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Enqueue the audience as pending contacts (idempotent — skips existing). */
export async function prepareOutreach(
  campaignId: string,
  opts?: { mode?: "inactive" | "all_subscribed" },
): Promise<{ ok: true; enqueued: number; audience: number; pool: number } | { ok: false; error: string }> {
  try {
    const { project } = await outreachGate(campaignId);
    const mode = opts?.mode ?? "inactive";
    const { resolveOutreachAudience } = await import("@/lib/outreach");
    const { pool, audience } = await resolveOutreachAudience(mode);

    const existing = new Set(
      (await prisma.outreachContact.findMany({ where: { campaignId }, select: { email: true } })).map((r) => r.email),
    );
    const fresh = audience.filter((r) => !existing.has(r.email));
    if (fresh.length > 0) {
      await withDbRetry(() =>
        prisma.outreachContact.createMany({
          data: fresh.map((r) => ({
            campaignId,
            email: r.email,
            hiveUsername: r.handle,
            projectSlug: project.slug,
          })),
          skipDuplicates: true,
        }),
      );
    }
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, enqueued: fresh.length, audience: audience.length, pool: pool.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Mark contacted skaters who posted on Hive after being emailed as "responded". */
async function detectReengagement(campaignId: string): Promise<number> {
  const sent = await prisma.outreachContact.findMany({
    where: { campaignId, status: "sent", hiveUsername: { not: null }, sentAt: { not: null } },
    select: { id: true, hiveUsername: true, sentAt: true },
  });
  if (sent.length === 0) return 0;
  const { hiveLastActivity } = await import("@/lib/outreach");
  const last = await hiveLastActivity(sent.map((s) => s.hiveUsername as string));
  let responded = 0;
  for (const s of sent) {
    const lp = last.get((s.hiveUsername as string).toLowerCase());
    if (lp !== undefined && s.sentAt && lp > s.sentAt.getTime()) {
      await prisma.outreachContact.update({ where: { id: s.id }, data: { status: "responded", respondedAt: new Date() } });
      responded++;
    }
  }
  return responded;
}

export async function sendOutreachBatch(
  campaignId: string,
  opts?: { batchSize?: number; testTo?: string },
): Promise<
  | { ok: true; sent: number; failed: number; responded: number; remaining: number; test?: boolean }
  | { ok: false; error: string }
> {
  try {
    const { project, campaign } = await outreachGate(campaignId);
    const { sendProjectEmail } = await import("@/lib/email");
    const { blastFooterHtml } = await import("@/lib/newsletter");

    const email = await resolveCampaignEmail(campaignId, campaign.name);
    if ("error" in email) return { ok: false, error: email.error };
    const { subject, html } = email;

    const personalize = (rawHtml: string, username: string, to: string) =>
      rawHtml
        .replace(/\{\{\s*first_name\s*\}\}/g, username)
        .replace(/<\/body>/i, `${blastFooterHtml(project, to)}</body>`);

    // --- Test send: single recipient, no tracking ---------------------------
    const testTo = opts?.testTo?.trim().toLowerCase();
    if (testTo) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) return { ok: false, error: "Test email inválido." };
      const personalized = personalize(html, "skater", testTo);
      const text = personalized.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
      const r = await sendProjectEmail(project, { to: testTo, subject, html: personalized, text });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sent: 1, failed: 0, responded: 0, remaining: 0, test: true };
    }

    // --- Real batch: re-engagement pass, then send N pending ----------------
    const responded = await detectReengagement(campaignId);

    const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, opts?.batchSize ?? DEFAULT_BATCH_SIZE));
    const batch = await prisma.outreachContact.findMany({
      where: { campaignId, status: "pending" },
      // id tiebreaker: createMany stamps identical createdAt, so order isn't
      // stable on the timestamp alone — this keeps batching deterministic FIFO.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    if (batch.length === 0) {
      const remaining = await prisma.outreachContact.count({ where: { campaignId, status: "pending" } });
      return { ok: true, sent: 0, failed: 0, responded, remaining };
    }

    let sent = 0;
    let failed = 0;
    for (const c of batch) {
      const personalized = personalize(html, c.hiveUsername || "skater", c.email);
      const text = personalized.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
      const r = await sendProjectEmail(project, { to: c.email, subject, html: personalized, text });
      if (r.ok) {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "sent", sentAt: new Date(), error: null } });
        sent++;
      } else {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "bounced", error: r.error ?? "send failed" } });
        failed++;
      }
      await new Promise((res) => setTimeout(res, 150));
    }

    const remaining = await prisma.outreachContact.count({ where: { campaignId, status: "pending" } });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, sent, failed, responded, remaining };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
