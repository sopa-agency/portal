// Server-only: shared logic for generating and persisting AI social insights.
// Intentionally NOT a "use server" module so it can be imported by both
// src/app/actions/social-insights.ts (which IS "use server") and
// src/app/actions/briefings.ts without triggering Next.js "use server" import
// constraints.
import "server-only";

import { prisma } from "@/lib/prisma";
import { fetchChannelMetrics } from "@/lib/social-metrics";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { feedbackScope, feedbackPromptBlock } from "@/lib/insight-feedback";
import type { ProjectConfig, SocialChannel } from "@/projects/types";
import type { ChannelMetrics } from "@/lib/social-metrics";

const TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 5 * 60_000);

// ---------------------------------------------------------------------------
// Prompt builders (mirrors the originals in social-insights.ts action)
// ---------------------------------------------------------------------------

function summarizeMetrics(m: Extract<ChannelMetrics, { ok: true }>): string {
  const lines: string[] = [];
  const delta =
    m.followersDelta7d == null
      ? "no 7d history yet"
      : `${m.followersDelta7d >= 0 ? "+" : ""}${m.followersDelta7d} in 7d`;
  lines.push(`Followers: ${m.followers ?? "?"} (${delta})`);

  if (m.highlights?.length) {
    lines.push("Account (last 7 days):");
    for (const h of m.highlights) {
      const wow = h.deltaPct == null ? "" : ` (${h.deltaPct >= 0 ? "+" : ""}${h.deltaPct}% WoW)`;
      const sub = h.sub ? ` — ${h.sub}` : "";
      lines.push(`  - ${h.label}: ${h.value}${wow}${sub}`);
    }
  }

  if (m.posts?.length) {
    const now = Date.now();
    const sortedPosts = [...m.posts].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
    const latest = sortedPosts[0];
    const previous = sortedPosts[1];

    lines.push("Recent posts:");
    sortedPosts.forEach((p, i) => {
      const eng = p.engagements.map((e) => `${e.label} ${e.value}`).join(", ");
      const title = (p.title ?? "post").replace(/\s+/g, " ").slice(0, 70);
      const ageHours = Math.max(0, (now - new Date(p.at).getTime()) / 3_600_000);
      const ageLabel = ageHours < 1
        ? `${Math.max(1, Math.round(ageHours * 60))}m ago`
        : ageHours < 48
          ? `${Math.round(ageHours)}h ago`
          : `${Math.round(ageHours / 24)}d ago`;
      lines.push(`  ${i + 1}. "${title}" — ${eng} — posted ${ageLabel}`);
    });

    if (latest) {
      const latestAgeHours = Math.max(0, (now - new Date(latest.at).getTime()) / 3_600_000);
      lines.push(
        latestAgeHours < 24
          ? `Latest-post context: the newest post is only ${latestAgeHours < 1 ? `${Math.max(1, Math.round(latestAgeHours * 60))} minutes` : `${Math.round(latestAgeHours)} hours`} old, so its reach/share/save counts are still immature and should NOT be treated as a settled underperformer.`
          : `Latest-post context: the newest post is ${Math.round(latestAgeHours / 24)} days old.`,
      );
    }

    if (latest && previous) {
      const gapDays = Math.max(
        0,
        (new Date(latest.at).getTime() - new Date(previous.at).getTime()) / 86_400_000,
      );
      if (gapDays >= 45) {
        lines.push(
          `Posting-gap context: there was roughly a ${Math.round(gapDays)}-day gap between the newest post and the previous one. Factor that restart effect into the analysis before judging momentum or declaring a miss.`,
        );
      }
    }
  }
  return lines.join("\n");
}

function buildStrategyBlock(channel: SocialChannel): string {
  const parts: string[] = [
    `Channel: ${channel.platform}${channel.handle ? ` (${channel.handle})` : ""}`,
  ];
  if (channel.summary) parts.push(`Positioning: ${channel.summary}`);
  if (channel.cadence) parts.push(`Cadence: ${channel.cadence}`);
  if (channel.voice) parts.push(`Voice: ${channel.voice}`);
  if (channel.formats?.length) {
    parts.push("Formats:");
    for (const f of channel.formats) parts.push(`  - ${f.name}: ${f.description}`);
  }
  if (channel.dos?.length) parts.push(`Always: ${channel.dos.join("; ")}`);
  if (channel.donts?.length) parts.push(`Never: ${channel.donts.join("; ")}`);
  return parts.join("\n");
}

function buildPrompt(
  project: ProjectConfig,
  channel: SocialChannel,
  m: Extract<ChannelMetrics, { ok: true }>,
): string {
  return [
    `You are the social media strategist for ${project.name}'s ${channel.platform} account${channel.handle ? ` (${channel.handle})` : ""}.`,
    "Use your own workspace knowledge (brand playbook, prior context) plus the data below.",
    "",
    "=== Posting strategy ===",
    buildStrategyBlock(channel),
    "",
    "=== Live metrics ===",
    summarizeMetrics(m),
    "",
    "=== Task ===",
    "Analyze the numbers and the progress (week-over-week, non-follower reach, per-post engagement). Then give concrete, prioritized, execution-ready suggestions to improve OUTREACH (reach — especially non-follower reach) and ENGAGEMENT (saves, shares, comments, watch time). Ground every recommendation in the actual numbers and the strategy/playbook — no generic advice. Be specific about formats, hooks, CTAs, and cadence.",
    "Important: explicitly consider post recency and posting gaps. Do not call the newest post an underperformer if it is still fresh (especially <24h old), and do not compare a comeback post after a long inactive gap as if it had the same distribution baseline as mature posts.",
    "",
    "Respond in markdown with exactly these sections:",
    "## Read on the numbers",
    "(3-5 tight bullets: what's working, what's underperforming, the clearest signal)",
    "## Recommendations",
    "(a prioritized, numbered list — each item: the action + why, tied to a metric)",
    "## This week",
    "(one concrete thing to ship next, in this project's voice)",
    "Keep it tight and skimmable.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Core: generate + upsert insight for one channel
// ---------------------------------------------------------------------------

/**
 * Fetches metrics, builds the agent prompt, calls the agent, and upserts the
 * result in SocialInsight. Returns the generated text on success.
 *
 * Returns `{ ok: false, error }` if metrics are not-connected (skippable) or
 * if anything else goes wrong. Safe to call in best-effort parallel loops.
 */
export async function generateInsightForChannel(
  project: ProjectConfig,
  channel: SocialChannel,
  generatedBy?: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const account = channel.metricsAccount ?? channel.handle?.replace(/^@/, "");
  const metrics = await fetchChannelMetrics(channel.platform, account, project);

  if (!metrics.ok) {
    if (metrics.reason === "not-connected") {
      return { ok: false, error: `${channel.platform} is not connected.` };
    }
    return { ok: false, error: metrics.error ?? "Metrics unavailable." };
  }

  const prompt = buildPrompt(project, channel, metrics);
  const feedback = await feedbackPromptBlock(
    feedbackScope("social", project.slug, channel.platform),
  );
  const finalPrompt = feedback ? `${prompt}\n\n${feedback}` : prompt;
  const text = await callOpenClaw(finalPrompt, project.agent.id, {
    project,
    timeoutMs: TIMEOUT_MS,
  });
  if (!text?.trim()) return { ok: false, error: "The agent returned an empty response." };

  await prisma.socialInsight.upsert({
    where: {
      projectSlug_platform: {
        projectSlug: project.slug,
        platform: channel.platform.toLowerCase(),
      },
    },
    create: {
      projectSlug: project.slug,
      platform: channel.platform.toLowerCase(),
      body: text,
      generatedBy: generatedBy ?? null,
    },
    update: {
      body: text,
      generatedBy: generatedBy ?? null,
      generatedAt: new Date(),
    },
  });

  return { ok: true, text };
}

// ---------------------------------------------------------------------------
// Batch refresh: generate insights for every connected channel in a project.
// Runs in parallel; individual failures are ignored (best-effort).
// No auth check — intended to be called server-side from the briefing flow.
// ---------------------------------------------------------------------------

export async function refreshProjectSocialInsights(
  project: ProjectConfig,
): Promise<void> {
  await Promise.all(
    project.socials.map((channel) =>
      generateInsightForChannel(project, channel, "briefing-refresh").catch(
        () => undefined,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Context block: read all persisted insights for a project and return a
// markdown block for injection into briefing prompts.
// No auth check — server-side helper.
// ---------------------------------------------------------------------------

export async function getProjectSocialInsightsContext(
  projectSlug: string,
): Promise<string> {
  let rows: { platform: string; body: string }[];
  try {
    rows = await prisma.socialInsight.findMany({
      where: { projectSlug },
      select: { platform: true, body: true },
      orderBy: { generatedAt: "desc" },
    });
  } catch {
    return "";
  }

  if (!rows.length) return "";

  const sections = rows
    .map(
      (r) =>
        `### ${r.platform.charAt(0).toUpperCase() + r.platform.slice(1)}\n${r.body.trim()}`,
    )
    .join("\n\n");

  return `## Social analytics (latest)\n\n${sections}`;
}

/**
 * Freshly-fetched LIVE numbers for every connected channel, formatted for
 * injection into the morning-briefing prompt (followers + 7d delta, account
 * highlights, recent posts with per-post engagement + recency/gap context).
 * Best-effort: channels that aren't connected or error out are skipped.
 * Returns "" when nothing is live.
 */
export async function getProjectSocialMetricsContext(project: ProjectConfig): Promise<string> {
  const blocks: string[] = [];
  for (const channel of project.socials) {
    const account = channel.metricsAccount ?? channel.handle?.replace(/^@/, "");
    try {
      const m = await fetchChannelMetrics(channel.platform, account, project);
      if (m.ok) {
        blocks.push(
          `### ${channel.platform}${channel.handle ? ` (${channel.handle})` : ""}\n${summarizeMetrics(m)}`,
        );
      }
    } catch {
      // best-effort — skip a channel that errors out
    }
  }
  if (!blocks.length) return "";
  return `## Social live numbers (fetched now)\n\n${blocks.join("\n\n")}`;
}
