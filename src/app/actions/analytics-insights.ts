"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { fetchGa4, fetchGsc } from "@/lib/google-analytics";
import { callOpenClaw } from "@/lib/openclaw-gateway";

const TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 5 * 60_000);

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  return `${d >= 0 ? "+" : ""}${d}%`;
}

function buildPrompt(
  ga4: Extract<Awaited<ReturnType<typeof fetchGa4>>, { ok: true }>,
  gsc: Extract<Awaited<ReturnType<typeof fetchGsc>>, { ok: true }>,
  projectName: string,
): string {
  const s = ga4.summary;
  const t = gsc.totals;

  const lines: string[] = [
    `You are an SEO and growth analyst for ${projectName}. Below is ${ga4.days}-day analytics data. Do NOT invent numbers — use only the data given.`,
    "",
    "=== Google Analytics (GA4) ===",
    `Active users: ${fmt(s.activeUsers.value)} (${fmtDelta(s.activeUsers.deltaPct)} vs prev period)`,
    `New users: ${fmt(s.newUsers.value)} (${fmtDelta(s.newUsers.deltaPct)})`,
    `Sessions: ${fmt(s.sessions.value)} (${fmtDelta(s.sessions.deltaPct)})`,
    `Page views: ${fmt(s.screenPageViews.value)} (${fmtDelta(s.screenPageViews.deltaPct)})`,
    `Engagement rate: ${fmtPct(s.engagementRate.value)} (${fmtDelta(s.engagementRate.deltaPct)})`,
    `Bounce rate: ${fmtPct(s.bounceRate.value)} (${fmtDelta(s.bounceRate.deltaPct)})`,
    `Avg session duration: ${Math.round(s.averageSessionDuration.value)}s (${fmtDelta(s.averageSessionDuration.deltaPct)})`,
  ];

  if (ga4.alerts.length) {
    lines.push(`Alerts: ${ga4.alerts.join("; ")}`);
  }

  if (ga4.topPages.length) {
    lines.push("", "Top pages:");
    for (const p of ga4.topPages.slice(0, 5)) {
      lines.push(`  - ${p.path} (${fmt(p.views)} views)`);
    }
  }

  if (ga4.sourceMedium.length) {
    lines.push("", "Top acquisition (source/medium):");
    for (const sm of ga4.sourceMedium.slice(0, 5)) {
      lines.push(`  - ${sm.name}: ${fmt(sm.sessions)} sessions`);
    }
  }

  if (ga4.devices.length) {
    lines.push("", "Devices:");
    for (const d of ga4.devices) {
      lines.push(`  - ${d.name}: ${fmt(d.sessions)} sessions`);
    }
  }

  lines.push("", "=== Search Console (GSC) ===");
  lines.push(`Clicks: ${fmt(t.clicks.value)} (${fmtDelta(t.clicks.deltaPct)} vs prev period)`);
  lines.push(`Impressions: ${fmt(t.impressions.value)} (${fmtDelta(t.impressions.deltaPct)})`);
  lines.push(`CTR: ${fmtPct(t.ctr.value)} (${fmtDelta(t.ctr.deltaPct)})`);
  lines.push(`Avg position: ${t.position.value.toFixed(1)} (${fmtDelta(t.position.deltaPct)})`);

  if (gsc.quickWins.length) {
    lines.push("", "Quick-win queries (pos 4-20, high impressions — optimize title/meta):");
    for (const qw of gsc.quickWins.slice(0, 5)) {
      lines.push(`  - "${qw.query}" — pos ${qw.position.toFixed(1)}, ${fmt(qw.impressions)} impr., CTR ${fmtPct(qw.ctr)}`);
    }
  }

  const { branded, nonBranded } = gsc.branded;
  const totalClicks = branded.clicks + nonBranded.clicks;
  if (totalClicks > 0) {
    const brandedPct = ((branded.clicks / totalClicks) * 100).toFixed(0);
    lines.push("", `Branded vs non-branded clicks: ${fmt(branded.clicks)} branded (${brandedPct}%) / ${fmt(nonBranded.clicks)} non-branded`);
  }

  if (gsc.gainers.length) {
    lines.push("", "Top click gainers vs previous period:");
    for (const g of gsc.gainers) {
      lines.push(`  - "${g.query}": +${g.delta} clicks (${g.prevClicks} → ${g.clicks})`);
    }
  }

  if (gsc.losers.length) {
    lines.push("", "Top click losers vs previous period:");
    for (const l of gsc.losers) {
      lines.push(`  - "${l.query}": ${l.delta} clicks (${l.prevClicks} → ${l.clicks})`);
    }
  }

  if (gsc.topQueries.length) {
    lines.push("", "Top search queries:");
    for (const q of gsc.topQueries.slice(0, 5)) {
      lines.push(`  - "${q.query}": ${fmt(q.clicks)} clicks, pos ${q.position.toFixed(1)}`);
    }
  }

  lines.push(
    "",
    "=== Task ===",
    "Analyze the numbers and return markdown with exactly these sections:",
    "## Read on the numbers",
    "(3-5 tight bullets: what's working, what's underperforming, the clearest signal)",
    "## SEO quick wins (prioritized)",
    "(top 3-5 concrete quick-win queries or pages — each: the action + the number supporting it)",
    "## Recommendations",
    "(a prioritized, numbered list — each item: the action + why, tied to a specific metric)",
    "## This week",
    "(one concrete action to take this week, grounded in the data)",
    "Keep it tight and skimmable. Do NOT invent numbers.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// generateAnalyticsInsights — auth-gated, persists via AnalyticsInsight
// ---------------------------------------------------------------------------

export async function generateAnalyticsInsights(
  days: 7 | 28 | 90,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();

    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized" };

    if (!project.analytics) return { ok: false, error: "Analytics not configured for this project." };

    const [ga4Result, gscResult] = await Promise.all([
      fetchGa4(project, days),
      fetchGsc(project, days),
    ]);

    if (!ga4Result.ok || !gscResult.ok) {
      const reason = !ga4Result.ok
        ? ("error" in ga4Result ? ga4Result.error : "GA4 not configured")
        : ("error" in gscResult ? gscResult.error : "GSC not configured");
      return { ok: false, error: `Data unavailable: ${reason}` };
    }

    const prompt = buildPrompt(ga4Result, gscResult, project.name);
    const text = await callOpenClaw(prompt, project.agent.id, {
      project,
      timeoutMs: TIMEOUT_MS,
    });

    if (!text?.trim()) return { ok: false, error: "The agent returned an empty response." };

    await prisma.analyticsInsight.upsert({
      where: { projectSlug: project.slug },
      create: {
        projectSlug: project.slug,
        body: text,
        generatedBy: session.username,
      },
      update: {
        body: text,
        generatedBy: session.username,
        generatedAt: new Date(),
      },
    });

    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getLatestAnalyticsInsight — auth-gated read from DB for hydration on mount
// ---------------------------------------------------------------------------

export async function getLatestAnalyticsInsight(): Promise<{
  body: string;
  generatedAt: string;
  generatedBy: string | null;
} | null> {
  try {
    const project = await getActiveProject();

    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return null;

    const row = await prisma.analyticsInsight.findUnique({
      where: { projectSlug: project.slug },
      select: { body: true, generatedAt: true, generatedBy: true },
    });

    if (!row) return null;

    return {
      body: row.body,
      generatedAt: row.generatedAt.toISOString(),
      generatedBy: row.generatedBy,
    };
  } catch {
    return null;
  }
}
