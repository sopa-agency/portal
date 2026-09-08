"use server";

import { revalidatePath } from "next/cache";
import { prisma, withDbRetry } from "@/lib/prisma";
import type { OutreachAudienceMode, OutreachRecipient } from "@/lib/outreach";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Controlled email outreach — delivers a campaign's "Email" artifact to a
// tracked audience in manual, daily-controlled BATCHES (see OutreachContact in
// prisma/schema.prisma). Reuses the campaign email content (parseEmail/renderEmail)
// and the blast unsubscribe footer, but adds per-recipient state so the same
// skater is never re-emailed within a campaign, plus re-engagement detection.
//
// Per-recipient tokens ({{first_name}}, {{last_post_date}}, …) are filled here,
// in the subject as well as the body — see src/lib/we-miss-you-email.ts for
// the list. Before each send the recipient is re-checked: opted out since
// being enqueued → not sent; posted on Hive since being enqueued → not sent
// (a "we noticed you left" to someone who just came back is worse than silence).
//
// Gated to the tenant that owns the GLOBAL userbase (SkateHive) — same reasoning
// as the userbase actions — and to the campaign's own project.
// ---------------------------------------------------------------------------

// The mailbox is plain Gmail SMTP with no warmed-up sending domain, and the
// audience is dormant — the worst combination for spam placement. So: a hard
// per-campaign ceiling over any rolling 24h, enforced server-side (the panel's
// batch size is a convenience, not the guard), and a pause between sends.
const DAILY_CAP = 50;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = DAILY_CAP;
const SEND_SPACING_MS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;

type Campaign = { id: string; name: string; projectSlug: string };

/** Session + owner-tenant + campaign-ownership gate. Returns project + campaign. */
async function outreachGate(campaignId: string): Promise<{ project: ProjectConfig; campaign: Campaign }> {
  const { cookies } = await import("next/headers");
  const { SESSION_COOKIE, verifySession } = await import("@/lib/auth");
  const { getActiveProject } = await import("@/projects/index");
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) throw new Error("Unauthorized");
  const { outreachAvailable } = await import("@/lib/outreach-modes");
  if (!outreachAvailable(project)) {
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

/** Sends in the last rolling 24h for this campaign (the DAILY_CAP window). */
async function sentLast24h(campaignId: string): Promise<number> {
  return prisma.outreachContact.count({ where: { campaignId, sentAt: { gte: new Date(Date.now() - DAY_MS) } } });
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
      skipped: number;
      /** Sent in the last rolling 24h — what counts against dailyCap. */
      sentToday: number;
      dailyCap: number;
    }
  | { ok: false; error: string };

/** Fast status snapshot for the panel (no Hive calls). */
export async function getOutreachStatus(campaignId: string): Promise<OutreachStatus> {
  try {
    const { campaign } = await outreachGate(campaignId);
    const [grouped, email, sentToday] = await Promise.all([
      prisma.outreachContact.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } }),
      resolveCampaignEmail(campaignId, campaign.name),
      sentLast24h(campaignId),
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
      skipped: by("skipped") + by("opted_out"),
      sentToday,
      dailyCap: DAILY_CAP,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Enqueue one audience segment as pending contacts (idempotent — skips existing). */
export async function prepareOutreach(
  campaignId: string,
  opts?: { mode?: OutreachAudienceMode },
): Promise<{ ok: true; enqueued: number; audience: number; pool: number } | { ok: false; error: string }> {
  try {
    const { project } = await outreachGate(campaignId);
    const mode = opts?.mode ?? "lapsed";
    const { resolveOutreachAudience } = await import("@/lib/outreach");
    const { pool, audience } = await resolveOutreachAudience(mode);

    const existing = new Set(
      (await prisma.outreachContact.findMany({ where: { campaignId }, select: { email: true } })).map((r) => r.email),
    );
    const fresh = audience.filter((r) => !existing.has(r.email));
    if (fresh.length > 0) {
      // createMany would stamp one createdAt on every row; the send order is
      // createdAt ASC, so stagger by 1ms to keep the audience's order (lapsed =
      // most recently quiet first) as the queue order.
      const base = Date.now();
      await withDbRetry(() =>
        prisma.outreachContact.createMany({
          data: fresh.map((r, i) => ({
            campaignId,
            email: r.email,
            hiveUsername: r.handle,
            projectSlug: project.slug,
            createdAt: new Date(base + i),
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

// ---------------------------------------------------------------------------
// Per-recipient personalization
// ---------------------------------------------------------------------------

type Tokens = {
  firstName: string;
  username: string;
  lastPostDate: string;
  lastPostDatePt: string;
  /** `, “Title”,` clause — HTML (linked) and plain-text (subject) variants. */
  lastPostLinkHtml: string;
  lastPostLinkText: string;
};

function formatDate(ms: number, locale: "pt-BR" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(ms));
}

/** A first name to greet with: display name's first word when it's a real name, else the handle. */
function firstNameOf(displayName: string | null | undefined, handle: string | null | undefined): string {
  const dn = (displayName ?? "").trim();
  if (dn && !/^wallet\s+0x/i.test(dn) && dn.toLowerCase() !== (handle ?? "").toLowerCase()) {
    const first = dn.split(/\s+/)[0];
    if (first.length >= 2) return first;
  }
  return handle || "skater";
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildTokens(input: {
  displayName: string | null;
  handle: string | null;
  lastPost: { title: string; url: string; createdAt: number } | null;
  lastActivityAt: number | null;
}): Tokens {
  const when = input.lastPost?.createdAt ?? (input.lastActivityAt && input.lastActivityAt > 0 ? input.lastActivityAt : null);
  return {
    firstName: firstNameOf(input.displayName, input.handle),
    username: input.handle || "skater",
    lastPostDate: when ? formatDate(when, "en-US") : "a while ago",
    lastPostDatePt: when ? formatDate(when, "pt-BR") : "algum tempo atrás",
    lastPostLinkHtml: input.lastPost
      ? `, &ldquo;<a href="${escHtml(input.lastPost.url)}" style="color:inherit;text-decoration:underline;" target="_blank" rel="noopener">${escHtml(input.lastPost.title)}</a>&rdquo;,`
      : "",
    lastPostLinkText: input.lastPost ? `, "${input.lastPost.title}",` : "",
  };
}

function fillTokens(s: string, t: Tokens, kind: "html" | "text"): string {
  return s
    .replace(/\{\{\s*first_name\s*\}\}/g, t.firstName)
    .replace(/\{\{\s*username\s*\}\}/g, t.username)
    .replace(/\{\{\s*last_post_date_pt\s*\}\}/g, t.lastPostDatePt)
    .replace(/\{\{\s*last_post_date\s*\}\}/g, t.lastPostDate)
    .replace(/\{\{\s*last_post_link\s*\}\}/g, kind === "html" ? t.lastPostLinkHtml : t.lastPostLinkText);
}

function usesLastPostTokens(...parts: string[]): boolean {
  return parts.some((p) => /\{\{\s*last_post_/.test(p));
}

export async function sendOutreachBatch(
  campaignId: string,
  opts?: { batchSize?: number; testTo?: string },
): Promise<
  | { ok: true; sent: number; failed: number; skipped: number; responded: number; remaining: number; dailyRemaining: number; test?: boolean }
  | { ok: false; error: string }
> {
  try {
    const { project, campaign } = await outreachGate(campaignId);
    const { sendProjectEmail } = await import("@/lib/email");
    const { blastFooterHtml, unsubscribeHeaders } = await import("@/lib/newsletter");
    const { hiveLastActivity, hiveLastRootPost, resolveSubscribedPool } = await import("@/lib/outreach");

    const email = await resolveCampaignEmail(campaignId, campaign.name);
    if ("error" in email) return { ok: false, error: email.error };
    const { subject, html } = email;
    const frontend = project.hive.frontend ?? "https://peakd.com";
    const wantsLastPost = usesLastPostTokens(subject, html);

    const personalize = (t: Tokens, to: string) => {
      const body = fillTokens(html, t, "html").replace(/<\/body>/i, `${blastFooterHtml(project, to)}</body>`);
      return {
        subject: fillTokens(subject, t, "text"),
        html: body,
        text: body.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim(),
        headers: unsubscribeHeaders(project, to),
      };
    };

    // --- Test send: single recipient, sample tokens, no tracking -----------
    const testTo = opts?.testTo?.trim().toLowerCase();
    if (testTo) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) return { ok: false, error: "Test email inválido." };
      const sample = buildTokens({
        displayName: "Skater",
        handle: "skater",
        lastPost: { title: "Título do último post", url: frontend, createdAt: Date.now() - 120 * DAY_MS },
        lastActivityAt: null,
      });
      const r = await sendProjectEmail(project, { to: testTo, ...personalize(sample, testTo) });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, sent: 1, failed: 0, skipped: 0, responded: 0, remaining: 0, dailyRemaining: 0, test: true };
    }

    // --- Real batch ---------------------------------------------------------
    if (/\[\[/.test(html) || /\[\[/.test(subject)) {
      return { ok: false, error: "O email ainda tem [[placeholders]]. Preencha as novidades no brief e regenere, ou edite o email." };
    }

    const responded = await detectReengagement(campaignId);

    const alreadyToday = await sentLast24h(campaignId);
    const dailyRoom = DAILY_CAP - alreadyToday;
    if (dailyRoom <= 0) {
      return { ok: false, error: `Teto de ${DAILY_CAP} emails por 24h atingido nesta campanha. Continua amanhã.` };
    }
    const batchSize = Math.min(dailyRoom, MAX_BATCH_SIZE, Math.max(1, opts?.batchSize ?? DEFAULT_BATCH_SIZE));
    const batch = await prisma.outreachContact.findMany({
      where: { campaignId, status: "pending" },
      // id tiebreaker: rows enqueued before the 1ms stagger share a createdAt.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    const countRemaining = () => prisma.outreachContact.count({ where: { campaignId, status: "pending" } });
    if (batch.length === 0) {
      return { ok: true, sent: 0, failed: 0, skipped: 0, responded, remaining: await countRemaining(), dailyRemaining: dailyRoom };
    }

    // Fresh subscription state + Hive activity for just this batch.
    const pool = new Map<string, OutreachRecipient>();
    for (const r of await resolveSubscribedPool()) pool.set(r.email, r);
    const lastActivity = await hiveLastActivity(batch.map((c) => c.hiveUsername).filter((h): h is string => !!h));

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const c of batch) {
      const rec = pool.get(c.email);
      if (!rec) {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "opted_out", error: "descadastrou antes do envio" } });
        skipped++;
        continue;
      }
      const handle = c.hiveUsername || rec.handle;
      const lastActivityAt = handle ? (lastActivity.get(handle.toLowerCase()) ?? null) : null;
      if (lastActivityAt !== null && lastActivityAt > c.createdAt.getTime()) {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "skipped", error: "voltou a postar antes do envio" } });
        skipped++;
        continue;
      }

      const lastPost = wantsLastPost && handle && lastActivityAt ? await hiveLastRootPost(handle, frontend) : null;
      const tokens = buildTokens({ displayName: rec.displayName, handle, lastPost, lastActivityAt });
      const r = await sendProjectEmail(project, { to: c.email, ...personalize(tokens, c.email) });
      if (r.ok) {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "sent", sentAt: new Date(), error: null } });
        sent++;
      } else {
        await prisma.outreachContact.update({ where: { id: c.id }, data: { status: "bounced", error: r.error ?? "send failed" } });
        failed++;
      }
      await new Promise((res) => setTimeout(res, SEND_SPACING_MS));
    }

    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, sent, failed, skipped, responded, remaining: await countRemaining(), dailyRemaining: dailyRoom - sent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
