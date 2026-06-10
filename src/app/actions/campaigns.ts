"use server";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type Align,
  type EmailBlock,
  type EmailColumn,
  type EmailDocument,
  type EmailSection,
  newId,
  serializeEmail,
} from "@/lib/campaign-email";
import { detectTemplate, getCampaignTemplate } from "@/lib/campaign-templates";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";
import type { ProjectConfig } from "@/projects/types";
import {
  fetchLatestWeeklyStokenIssue,
  fetchTopSkatehivePosts,
  formatPostsForPrompt,
} from "@/lib/skatehive-content";

const AI_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 4 * 60_000);
const ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");

// Project-aware persona for campaign prompts. Defaults to the original
// Hive-platform framing (SkateHive/Gnars unchanged); projects can override it
// via `campaignArtifacts.persona` when that framing is wrong (e.g. Reelflip).
function campaignPersona(project: {
  name: string;
  campaignArtifacts?: { persona?: string };
}): string {
  return (
    project.campaignArtifacts?.persona?.trim() ||
    `the growth lead at ${project.name} — a community-owned platform built on Hive`
  );
}

// Hive snap publishing constants (mirrors repo-to-social.ts).
const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];
const SNAPS_CONTAINER_AUTHOR = "peak.snaps";

// Beneficiaries applied to published Hive mag posts (weights in basis points;
// 10000 = 100%). The posting account can't be its own beneficiary, so any entry
// matching the author is dropped at publish time.
const MAG_POST_BENEFICIARIES: { account: string; weight: number }[] = [
  { account: "skatehive", weight: 500 }, // 5% — platform
  { account: "xvlad", weight: 500 },     // 5% — operator
];

export async function createCampaignFromInstagramPost(
  postId: string,
): Promise<{ ok: true; campaignId: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();

    const post = await prisma.instagramPost.findUnique({
      where: { id: postId },
    });

    if (!post) return { ok: false, error: "Post not found." };
    if (post.projectSlug !== project.slug) return { ok: false, error: "Post not found." };
    // Any post with content can seed a campaign — published, scheduled, or draft.
    const mediaForGuard: string[] = Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]) : [];
    if (!(post.caption ?? "").trim() && mediaForGuard.length === 0) {
      return { ok: false, error: "This post has no caption or media yet — add content before creating a campaign." };
    }

    const isPublished = post.status === "published";
    const isScheduled = post.status === "scheduled";
    const statusWord = isPublished ? "published" : isScheduled ? "planned" : "draft";

    // Build a short caption snippet for naming / heading
    const captionSnippet = (post.caption ?? "").trim().slice(0, 60).replace(/\n/g, " ") || null;
    const refDate = post.publishedAt ?? post.scheduledFor ?? null;
    const dateStr = refDate
      ? new Date(refDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : null;

    const heading = captionSnippet ?? dateStr ?? "Instagram post";
    const igHandle = project.hive.account ?? project.slug;
    const type = (post.type ?? "post").toLowerCase();

    // Build seed brief — fully written, no [[ placeholders
    const lines: string[] = [];
    lines.push(`# Cross-platform from Instagram — ${heading}`);
    lines.push("");
    lines.push("## Source");
    if (isPublished) {
      lines.push(`Published Instagram ${type} by @${igHandle}${dateStr ? ` on ${dateStr}` : ""}.`);
    } else if (isScheduled) {
      lines.push(`Planned Instagram ${type} by @${igHandle}${dateStr ? `, scheduled for ${dateStr}` : ""} (not yet posted).`);
    } else {
      lines.push(`Draft Instagram ${type} by @${igHandle} (not yet posted).`);
    }
    if (post.permalink) lines.push(`Original: ${post.permalink}`);
    lines.push("");

    if (post.caption) {
      lines.push("## Original caption");
      lines.push(post.caption);
      lines.push("");
    }

    if (post.firstComment) {
      lines.push("## First comment");
      lines.push(post.firstComment);
      lines.push("");
    }

    const mediaUrls: string[] = Array.isArray(post.mediaUrls) ? (post.mediaUrls as string[]) : [];
    if (mediaUrls.length > 0) {
      lines.push("## Media");
      for (const url of mediaUrls) lines.push(`- ${url}`);
      lines.push("");
    }

    lines.push("## Goal");
    lines.push(
      `Adapt this ${statusWord} Instagram post into coordinated posts for the other channels — an X/Twitter thread, a Farcaster cast, a Discord announcement, and an email newsletter — preserving the core message and ${project.name}'s voice, each native to its platform.${isPublished ? " Link back to the Instagram post where it fits." : ""}`,
    );

    const seedBrief = lines.join("\n");
    const campaignName = `IG → cross-platform · ${captionSnippet ? captionSnippet.slice(0, 50) : (dateStr ?? "post")}`;

    const campaign = await prisma.campaign.create({
      data: {
        name: campaignName,
        projectSlug: project.slug,
        sourceMediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        sourcePermalink: post.permalink ?? undefined,
        documents: { create: { name: "Brief", isMain: true, content: seedBrief } },
      },
      select: { id: true },
    });

    revalidatePath("/campaign-creator");
    return { ok: true, campaignId: campaign.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create campaign." };
  }
}

export async function createCampaign(formData: FormData) {
  const templateId = ((formData.get("templateId") as string | null) ?? "").trim();

  const project = await getActiveProject();
  const template = templateId ? getCampaignTemplate(templateId, project) : null;

  const rawName = (formData.get("name") as string | null)?.trim();
  const name = rawName || template?.name || "Untitled campaign";
  const briefContent = template?.briefSeed ?? "";
  const campaign = await prisma.campaign.create({
    data: {
      name,
      projectSlug: project.slug,
      documents: { create: { name: "Brief", isMain: true, content: briefContent } },
    },
    select: { id: true },
  });

  revalidatePath("/campaign-creator");
  redirect(`/campaign-creator/${campaign.id}`);
}

export async function renameCampaign(id: string, name: string) {
  const next = name.trim() || "Untitled campaign";
  await prisma.campaign.update({ where: { id }, data: { name: next } });
  revalidatePath("/campaign-creator");
  revalidatePath(`/campaign-creator/${id}`);
}

export async function deleteCampaign(id: string) {
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaign-creator");
}

export async function createDocument(
  campaignId: string,
  name?: string,
): Promise<{ ok: boolean; documentId?: string; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.create({
      data: {
        campaignId,
        name: name?.trim() || "Untitled document",
        content: "",
        isMain: false,
      },
      select: { id: true },
    });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, documentId: doc.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteDocument(
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { campaignId: true, isMain: true },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.isMain) return { ok: false, error: "Cannot delete the main brief." };
    await prisma.campaignDocument.delete({ where: { id: documentId } });
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateDocumentContent(documentId: string, content: string) {
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { content },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}

export async function renameDocument(documentId: string, name: string) {
  const next = name.trim() || "Untitled";
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { name: next },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

type GenerateResult = { ok: true } | { ok: false; error: string };

// Match briefings.ts: lazily fill GATEWAY_TOKEN from ~/.openclaw/.env so local
// dev works without manual export.
async function ensureLocalGatewayToken(): Promise<void> {
  if (process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN) return;
  try {
    const raw = await fs.readFile(ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[1];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env.GATEWAY_TOKEN = val;
      return;
    }
  } catch {
    // env file unreadable — caller will surface the proper "token missing" error.
  }
}

export async function generateCampaignBrief(campaignId: string): Promise<GenerateResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { documents: { where: { isMain: true }, take: 1 } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const title = campaign.name.trim();
  if (!title || title.toLowerCase() === "untitled campaign") {
    return { ok: false, error: "Rename the campaign first — the title is what the brief is built from." };
  }

  const project = await getActiveProject();
  const template = detectTemplate(title, project);
  const aiAgentId = project.agent.id;
  const communityTag = project.hive.community;
  const farcasterChannel = project.farcaster.channel;
  const hiveAccount = project.hive.account;
  const projectName = project.name;

  // Weekly Stoken gets a dedicated branch: pull real recent posts from the
  // community + the latest issue number, then have the AI
  // build a real recap instead of a generic template fill-in.
  if (template?.id === "weekly-stoken") {
    // Projects with a weeklyRecap spec let their own agent assemble the recap
    // from its live sources/tools/memory. SkateHive (no spec) keeps the
    // canonical Hive-posts Weekly Stoken flow.
    if (project.weeklyRecap) {
      return generateAgentRecapBrief(campaignId, template, campaign.documents[0], project);
    }
    return generateWeeklyStokenBrief(campaignId, title, campaign.documents[0], project);
  }

  // Best-effort brand context from Drive (only non-empty for projects with a
  // Drive folder configured; never throws or breaks generation).
  const { getDriveBrandContext } = await import("@/lib/google-drive");
  const briefBrandCtx = await getDriveBrandContext(project);

  const prompt = `You are ${campaignPersona(project)}. Draft a marketing campaign brief for the campaign titled "${title}".

Write it as a long-form Hive blog post (300-500 words) that is ready to publish to the ${projectName} community (tag: ${communityTag}). Editorial tone — direct, community-to-community, no corporate marketing-speak. Make concrete assumptions about goal, audience, offer, and channel mix based on the title; lean into the specifics the title implies.

Use this exact section structure:

# ${title}

(One opening paragraph that hooks the reader and frames the campaign in 2-3 sentences.)

## Goal
One paragraph stating the outcome we want and a measurable target.

## Audience
2-3 sentences naming the specific community segment, with the wedge that makes them relevant (region, age, content style, activity, whatever fits).

## The offer
What the user actually gets. Be concrete (amounts in $HIVE/HBD, mechanics, timing, prizes).

## Window
Specific start and end dates (assume the campaign runs ~4 weeks starting roughly 2 weeks from today, 2026-05-16).

## Channels
Ordered list of the channels we'll use, in execution order. Stack: Hive snaps (peak.snaps container), Farcaster /${farcasterChannel} channel as @${hiveAccount}, Twitter/X thread, Discord announcement, email newsletter. Note which day each lands.

## Success metric
Primary metric + 1 sentence on why it matters. Add a north-star metric as a follow-up line.

## Risks
2-4 bullets covering realistic failure modes (turnout, judging fairness, payout liquidity, dependencies on partners).

## Next steps
A short bulleted to-do list owners can pick up immediately.

Return ONLY the markdown body starting with the H1 title — no preamble, no code fences, no JSON.${briefBrandCtx ? `\n\n${briefBrandCtx}` : ""}`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, aiAgentId, { timeoutMs: AI_TIMEOUT_MS, project });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to draft the brief." };
  }

  const body = stripCodeFence(raw).trim();
  if (!body) return { ok: false, error: "AI returned an empty brief." };

  const mainDoc = campaign.documents[0];
  if (mainDoc) {
    await prisma.campaignDocument.update({ where: { id: mainDoc.id }, data: { content: body } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name: "Brief", isMain: true, content: body },
    });
  }

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Weekly Stoken — dedicated brief generator. Pulls real trending posts from
// the community and the latest issue number, then has the AI build a recap
// that matches the canonical Weekly Stoken format.
// ---------------------------------------------------------------------------

async function generateWeeklyStokenBrief(
  campaignId: string,
  title: string,
  mainDoc: { id: string } | undefined,
  project: Awaited<ReturnType<typeof getActiveProject>>,
): Promise<GenerateResult> {
  const aiAgentId = project.agent.id;
  const hiveAccount = project.hive.account;
  const projectName = project.name;
  let posts: Awaited<ReturnType<typeof fetchTopSkatehivePosts>>;
  let latestIssue = 0;
  try {
    [posts, latestIssue] = await Promise.all([
      fetchTopSkatehivePosts({
        daysBack: 8,
        limit: 30,
        minVotes: 5,
        minBodyLength: 250,
        communityTag: project.hive.community,
        frontendUrl: project.hive.frontend,
      }),
      fetchLatestWeeklyStokenIssue(project.hive.account),
    ]);
  } catch (error) {
    return {
      ok: false,
      error:
        "Could not fetch community content from Hive: " +
        (error instanceof Error ? error.message : String(error)),
    };
  }

  if (posts.length === 0) {
    return {
      ok: false,
      error:
        `No qualifying posts found in ${project.hive.community} in the last 8 days (need 5+ votes, real title, 250+ char body). Try again later or relax filters.`,
    };
  }

  const nextIssue = latestIssue + 1;
  const postsBlock = formatPostsForPrompt(posts);
  const communityTag = project.hive.community;

  const prompt = `You are the editor of "The Weekly Stoken", ${projectName}'s flagship weekly content recap. You are writing Issue #${nextIssue}.

This output is the FINAL Hive blog post that will be published to ${communityTag} as @${hiveAccount}/the-weekly-stoken-${nextIssue}. It is NOT an internal brief — it is the publishable post itself. So no internal sections like "Goal", "Audience", "Window", "Channels", "Success metric", or "Risks". Reference the canonical format used in past issues (e.g. https://skatehive.app/@${hiveAccount}/the-weekly-stoken-${latestIssue}).

Use this structure exactly:

# The Weekly Stoken #${nextIssue}

**Welcome to the Weekly Stoken #${nextIssue}**

(One short opening paragraph — 2-3 sentences max — introducing what this issue rounds up. Skater voice.)

For each featured post (5-8 picks), use this exact block, separated by \`---\`:

### 🔗[<post title>](<full skatehive.app post url>)

By @<author>

> <one-sentence excerpt or hook in the skater's own voice, under 200 chars — paraphrase or quote from the post body, NOT a marketing summary>

![<short alt>](<image url from the post — use the "Image:" url from the list below; leave the block out only if there is genuinely no image>)

---

After the last featured post block, close with:

## Skater of the Week — @<chosen author>

(One paragraph, 2-3 sentences. Pick the most engaged or most consistent author from the list. Mention what their post(s) showcase and why other skaters should follow them. End with a direct link to their profile: https://skatehive.app/@<author>.)

(Then one final short paragraph as a sign-off: thank the featured creators, invite readers to drop a tip / vote / comment, and tease that the next issue lands next week.)

QUALITY RULES — break any of these and the issue is unusable:
1. Use ONLY posts from the list below. Do NOT invent posts, authors, URLs, or images. Do NOT use placeholders like [[clip 1]] or [[author]].
2. Pick 5-8 posts. Lean toward variety: don't feature the same author twice unless they have two truly different posts.
3. Lead with the highest-engagement post that has a clear title and a watchable hook (image + action). Drop posts whose titles are too short, generic, or look like snap fragments.
4. Excerpts: real sentence from the body, keep the author's voice. One sentence each, under 200 chars.
5. Image URL MUST be the exact "Image:" URL from the post in the list below, or omitted entirely. Do not invent image URLs.
6. The output IS the Hive blog post. Do not include any internal-brief sections (Goal / Audience / Window / Channels / Success metric / Risks).

Real posts from ${communityTag} in the past 8 days (sorted by engagement):

${postsBlock}

Return ONLY the markdown body starting with "# The Weekly Stoken #${nextIssue}". No preamble, no code fences, no JSON.`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, aiAgentId, { timeoutMs: AI_TIMEOUT_MS, project });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "AI gateway failed to draft the Weekly Stoken.",
    };
  }

  const body = stripCodeFence(raw).trim();
  if (!body) return { ok: false, error: "AI returned an empty Weekly Stoken brief." };

  if (mainDoc) {
    await prisma.campaignDocument.update({ where: { id: mainDoc.id }, data: { content: body } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name: "Brief", isMain: true, content: body },
    });
  }

  // Also bump the campaign name so it reflects the actual issue number.
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { name: `Weekly Stoken #${nextIssue}` },
  });

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent-assembled weekly recap. Instead of injecting a fixed data source, the
// project's agent compiles the recap from its OWN live sources, tools, and
// memory (e.g. Gnars → onchain governance via gnars-subgraph; Reelflip → its
// Instagram playbook), following the project's section guidance, in its own
// voice. Driven by `project.weeklyRecap`.
// ---------------------------------------------------------------------------

async function generateAgentRecapBrief(
  campaignId: string,
  template: { label: string },
  mainDoc: { id: string } | undefined,
  project: Awaited<ReturnType<typeof getActiveProject>>,
): Promise<GenerateResult> {
  const recap = project.weeklyRecap;
  if (!recap) return { ok: false, error: "No weekly-recap config for this project." };

  const today = new Date().toISOString().slice(0, 10);
  const sectionList = recap.sections.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const prompt = `You are ${project.name}'s agent. Produce this week's recap ("${template.label}") for ${today}.

Compile it from YOUR OWN live sources, tools, and memory${recap.sourcesHint ? ` — ${recap.sourcesHint}` : ""}. Do NOT invent numbers, governance results, or financial/onchain data — pull them from your real sources, and if a source is unavailable say so plainly instead of guessing.

Cover these sections, in your own voice (apply your identity/SOUL — tone and concision):
${sectionList}

This output IS the publishable recap, not an internal brief — no "Goal / Audience / Window / Channels / Success metric / Risks" scaffolding. Return ONLY the markdown body, starting with an H1 title like "# ${template.label} — ${today}". No preamble, no code fences, no JSON.`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, project.agent.id, { timeoutMs: AI_TIMEOUT_MS, project });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to draft the recap." };
  }

  const body = stripCodeFence(raw).trim();
  if (!body) return { ok: false, error: "AI returned an empty recap." };

  if (mainDoc) {
    await prisma.campaignDocument.update({ where: { id: mainDoc.id }, data: { content: body } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name: "Brief", isMain: true, content: body },
    });
  }

  // Keep the template label as the name prefix so re-generation still detects it.
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { name: `${template.label} — ${today}` },
  });

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");
  return { ok: true };
}

// Rewrite any IPFS gateway URL (Pinata, ipfs.io, dweb.link, cloudflare, etc.)
// to the SkateHive gateway so Hive frontends load media from ipfs.skatehive.app.
// Non-IPFS URLs (e.g. Instagram CDN) pass through unchanged.
function toSkatehiveIpfsGateway(url: string): string {
  const m = url.match(/\/ipfs\/([^\s)]+)$/i);
  if (!m) return url;
  if (/ipfs\.skatehive\.app/i.test(url)) return url; // already correct
  return `https://ipfs.skatehive.app/ipfs/${m[1]}`;
}

export async function generateCampaignArtifacts(campaignId: string): Promise<GenerateResult> {
  let campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { documents: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  let title = campaign.name.trim();
  let mainDoc = campaign.documents.find((d) => d.isMain);
  let brief = (mainDoc?.content ?? "").trim();
  if (!brief) {
    return { ok: false, error: "Write or generate the brief first — there's nothing for the artifacts to draw from." };
  }

  const artifactsProject = await getActiveProject();
  let template = detectTemplate(title, artifactsProject);

  // For template campaigns where the brief still has [[placeholder]] markers
  // (i.e. user clicked "Generate everything from brief" before filling in the
  // template), regenerate the brief first so the artifacts have real content
  // to draw from. The brief generation handles its own Hive fetch + naming.
  if (template && brief.includes("[[")) {
    const briefResult = await generateCampaignBrief(campaignId);
    if (!briefResult.ok) {
      return {
        ok: false,
        error: "Couldn't auto-refresh the brief: " + briefResult.error + " — fill the brief in by hand or fix the issue and re-run.",
      };
    }
    // Re-read after regeneration.
    campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { documents: true },
    });
    if (!campaign) return { ok: false, error: "Campaign disappeared mid-generation." };
    title = campaign.name.trim();
    mainDoc = campaign.documents.find((d) => d.isMain);
    brief = (mainDoc?.content ?? "").trim();
    template = detectTemplate(title, artifactsProject);
  }
  const artifactsAgentId = artifactsProject.agent.id;
  const artifactsCommunity = artifactsProject.hive.community;
  const artifactsFarcasterChannel = artifactsProject.farcaster.channel;
  const artifactsHiveAccount = artifactsProject.hive.account;
  const artifactsProjectName = artifactsProject.name;

  // Best-effort brand context from Drive (only for projects with Drive configured).
  const { getDriveBrandContext } = await import("@/lib/google-drive");
  const artifactsBrandCtx = await getDriveBrandContext(artifactsProject);

  const templateRules = buildTemplateArtifactRules(template?.id, artifactsProject);

  // Weekly Stoken: fetch the same trending posts the brief drew from so the
  // email can use real titles + URLs + thumbnail images per featured post.
  let weeklyStokenContext = "";
  if (template?.id === "weekly-stoken") {
    try {
      const posts = await fetchTopSkatehivePosts({
        daysBack: 8,
        limit: 30,
        minVotes: 5,
        minBodyLength: 250,
        communityTag: artifactsProject.hive.community,
        frontendUrl: artifactsProject.hive.frontend,
      });
      if (posts.length > 0) {
        weeklyStokenContext =
          `\n\nReal ${artifactsProjectName} posts fetched fresh from ${artifactsCommunity} (use these EXACT urls and image urls — do not invent):\n\n` +
          formatPostsForPrompt(posts);
      }
    } catch {
      // If we can't fetch fresh content, fall back to the brief-only prompt.
    }
  }

  // Source carousel (when this campaign was seeded from an Instagram post) so
  // the snap / cast / mag post can embed the exact images instead of being
  // text-only.
  let sourceMedia: string[] = Array.isArray(campaign.sourceMediaUrls)
    ? (campaign.sourceMediaUrls as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  // Fallback for campaigns seeded before sourceMediaUrls existed: pull the URLs
  // out of the brief's "## Media" list.
  if (sourceMedia.length === 0) {
    const mediaSection = brief.match(/##\s*Media\s*\n([\s\S]*?)(?:\n##\s|$)/i);
    if (mediaSection) {
      sourceMedia = mediaSection[1]
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter((u) => /^https?:\/\//.test(u));
    }
  }
  // Serve carousel media through the SkateHive IPFS gateway, not Pinata's.
  sourceMedia = sourceMedia.map(toSkatehiveIpfsGateway);
  const carouselBlock =
    sourceMedia.length > 0
      ? `\n\nSource Instagram carousel images — EMBED THESE (use these EXACT URLs in order; do not invent or omit them):\n${sourceMedia
          .map((u, i) => `${i + 1}. ${u}`)
          .join("\n")}\n`
      : "";
  const imageRules =
    sourceMedia.length > 0
      ? `\n\nImages (a source carousel is provided above):
- "hive_snap": after the text, embed ALL carousel images as Hive markdown, each on its own line: ![](url), in order. Use the EXACT URLs — every one, none dropped.
- "farcaster": append the first carousel image URL on its own final line (Farcaster auto-embeds image URLs). Use the EXACT URL.
- "hive_mag_post" / "hive_mag_post_pt": embed ALL carousel images with ![alt](url), interspersed between sections — lead with the strongest image. Use the EXACT URLs, in order, none invented or dropped.`
      : "";

  const artifactsVoiceHint = artifactsProject.campaignArtifacts?.voiceHint?.trim();
  const prompt = `You are ${campaignPersona(artifactsProject)}. Draft the coordinated campaign artifacts below based on the brief.${
    artifactsVoiceHint ? `\n\nVoice: ${artifactsVoiceHint}` : ""
  }${artifactsBrandCtx ? `\n\n${artifactsBrandCtx}` : ""}

Campaign title: "${title}"

Brief:
${brief}
${templateRules}${weeklyStokenContext}${carouselBlock}

Return a single JSON object with this exact shape, and NOTHING else (no prose, no code fences):

{
  "hive_snap": "...",
  "hive_mag_post": "...",
  "hive_mag_post_pt": "...",
  "farcaster": "...",
  "tweets": ["...", "..."],
  "discord": "...",
  "email": {
    "subject": "...",
    "preheader": "...",
    "sections": [
      {
        "background": "linear-gradient(90deg,#0a0a0a,#1f2937)",
        "paddingY": 28,
        "paddingX": 32,
        "columns": [
          { "blocks": [ { "type": "heading", "level": 3, "text": "${artifactsProjectName.toUpperCase()} UPDATE", "align": "left", "color": "${artifactsProject.theme.accentDark}" } ] }
        ]
      },
      {
        "background": "#ffffff",
        "paddingY": 32,
        "paddingX": 32,
        "columns": [
          { "blocks": [ /* see block shapes below */ ] }
        ]
      }
    ]
  }
}

Rules:
${
  artifactsHiveAccount
    ? `- The mag post will be published at EXACTLY this URL: ${magPostUrl(artifactsProject, artifactsHiveAccount, magPostPermlink(title, campaignId))} — wherever "hive_snap", "farcaster", "tweets", "discord", or "email" link to the mag post / recap / full read, use that EXACT URL. Never invent, alter, or shorten it. Do NOT put this link inside "hive_mag_post" or "hive_mag_post_pt" (the post must not link to itself).\n`
    : ""
}- "hive_snap": a single Hive snap (short post) that will be published as a comment under peak.snaps' daily container on ${artifactsCommunity}. Plain text, real line breaks, under 280 characters when possible. Community voice. No hashtags in front — Hive frontends pick those up from json_metadata.
- "hive_mag_post": a long-form Hive blog post (magazine style, ~300-600 words) ready to publish to ${artifactsCommunity} as @${artifactsHiveAccount}. Markdown with headings, paragraphs, and embedded images. Expand the core idea into a real read — context, the take, why it matters. Editorial, community-to-community, no corporate marketing-speak. This IS the publishable post body — no internal-brief sections (Goal / Audience / Window / Channels / Success metric / Risks). ALWAYS WRITE THIS IN ENGLISH — Hive's audience is international — even if the brief, caption, or images are in Portuguese.
- "hive_mag_post_pt": a faithful Brazilian Portuguese translation of "hive_mag_post" — same structure, same headings, the SAME embedded image URLs in the same places. This is stored in the post's json_metadata as the pt translation. Translate naturally, don't transliterate.
- "farcaster": a single Farcaster cast for the /${artifactsFarcasterChannel} channel as @${artifactsHiveAccount}. Under 320 characters. Plain text. One short hook + the link. Emojis are fine.
- "tweets": an array of 3-5 tweet strings posted from @${artifactsHiveAccount}. The first opens the thread with a hook + payoff and ends with a downward arrow. Each subsequent tweet stands on its own. Plain text, real line breaks. Keep each under 280 characters. Don't number them ("1/", "2/") — the UI handles that.
- "discord": a single message for the ${artifactsProjectName} Discord #announcements channel. Start with @everyone or @community if appropriate. Discord markdown (**bold**, bullet lists). Include the relevant link(s). More casual than the tweets.
- "email": a structured email document. Open with a dark hero section + eyebrow heading "${artifactsProjectName.toUpperCase()} UPDATE" in the project accent color (${artifactsProject.theme.accentDark}) + an H1 (use {{first_name}} for personalization if it helps). Body section follows with the campaign-specific blocks (see template rules + content above).

Text + heading blocks support inline links via [label](url) markdown — the renderer turns those into <a> tags. Use that for any clickable link inside body text instead of a separate button. The "button" block is for the primary CTA only.

Allowed block shapes (omit id — the server assigns them):
- heading: { "type": "heading", "level": 1|2|3, "text": "... [label](url) markdown supported", "align": "left|center|right", "color": "#hex" }
- text:    { "type": "text",    "html": "plain text — newlines allowed, [label](url) markdown supported", "align": "left|center|right", "color": "#hex" }
- image:   { "type": "image",   "src": "https://...", "alt": "...", "width": 100, "align": "left|center|right", "href": "https://... optional, makes the image clickable" }
- button:  { "type": "button",  "label": "...", "href": "https://...", "bg": "#hex", "color": "#hex", "align": "left|center|right" }
- divider: { "type": "divider", "color": "#hex", "thickness": 1 }
- spacer:  { "type": "spacer",  "height": 24 }
- list:    { "type": "list",    "ordered": true|false, "items": ["... [label](url) supported", "..."] }
${imageRules}

The JSON must be valid — escape newlines inside strings as \\n, escape quotes as \\". Begin your reply with "{" and end with "}".`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, artifactsAgentId, { timeoutMs: AI_TIMEOUT_MS, project: artifactsProject });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to draft the artifacts." };
  }

  const parsed = extractArtifactsJson(raw);
  if (!parsed) {
    // Stash the raw output so the user can salvage what's there by hand
    // instead of losing a minute-long AI call to a parse error.
    await upsertNamedDocument(
      campaignId,
      "AI debug — last raw output",
      `The AI's last response could not be parsed as JSON. Paste useful chunks into the relevant doc by hand, then delete this one.\n\n---\n\n${raw}`,
    );
    revalidatePath(`/campaign-creator/${campaignId}`);
    return {
      ok: false,
      error: "AI did not return valid JSON. Raw output saved to \"AI debug — last raw output\".",
    };
  }

  // Save whatever fields parsed cleanly; missing fields are skipped silently
  // (the user can re-run or fill them in manually).
  const saved: string[] = [];
  const missing: string[] = [];

  if (parsed.hive_snap) {
    await upsertNamedDocument(campaignId, "Hive snap", parsed.hive_snap);
    saved.push("Hive snap");
  } else missing.push("Hive snap");

  if (parsed.hive_mag_post) {
    await upsertNamedDocument(campaignId, "Hive mag post", parsed.hive_mag_post);
    saved.push("Hive mag post");
  } else missing.push("Hive mag post");

  // Portuguese translation — kept as a sibling doc; published into the mag
  // post's json_metadata (translations.pt) by publishHiveMagPost.
  if (parsed.hive_mag_post_pt) {
    await upsertNamedDocument(campaignId, "Hive mag post (PT)", parsed.hive_mag_post_pt);
    saved.push("Hive mag post (PT)");
  }

  if (parsed.farcaster) {
    await upsertNamedDocument(campaignId, "Farcaster cast", parsed.farcaster);
    saved.push("Farcaster cast");
  } else missing.push("Farcaster cast");

  if (parsed.tweets.length > 0) {
    const tweetsContent = parsed.tweets.map((t) => t.trim()).filter(Boolean).join("\n---\n");
    if (tweetsContent) {
      await upsertNamedDocument(campaignId, "Twitter thread", tweetsContent);
      saved.push("Twitter thread");
    } else missing.push("Twitter thread");
  } else missing.push("Twitter thread");

  if (parsed.discord) {
    await upsertNamedDocument(campaignId, "Discord announcement", parsed.discord);
    saved.push("Discord announcement");
  } else missing.push("Discord announcement");

  if (parsed.email) {
    const emailDocument = normalizeAiEmail(parsed.email);
    const emailContent = serializeEmail(emailDocument);
    await upsertNamedDocument(campaignId, "Email", emailContent);
    saved.push("Email");
  } else missing.push("Email");

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");

  if (saved.length === 0) {
    await upsertNamedDocument(
      campaignId,
      "AI debug — last raw output",
      `The AI returned JSON, but none of the expected fields were populated. Raw response below — paste useful chunks into the relevant doc by hand.\n\n---\n\n${raw}`,
    );
    return { ok: false, error: "AI returned JSON but every field was empty. Raw output saved." };
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Drafted ${saved.join(", ")} — but missing ${missing.join(", ")}. Re-run to fill the gaps, or click each missing doc and write it by hand.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rebuild a legacy raw-HTML email into structured blocks via the AI.
// ---------------------------------------------------------------------------

export async function rebuildEmailFromHtml(
  documentId: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const doc = await prisma.campaignDocument.findUnique({
    where: { id: documentId },
    select: { id: true, content: true, campaignId: true },
  });
  if (!doc) return { ok: false, error: "Email document not found." };

  const html = (doc.content ?? "").trim();
  if (!html || html.startsWith("{")) {
    return { ok: false, error: "Nothing to rebuild — this email is already structured (or empty)." };
  }

  const emailProject = await getActiveProject();
  const emailAgentId = emailProject.agent.id;

  const prompt = `Convert the following HTML email into the structured email-blocks JSON shape.

Return ONLY a JSON object matching this shape, no prose or code fences:

{
  "subject": "...",
  "preheader": "...",
  "sections": [
    { "background": "#hex or gradient", "paddingY": 24, "paddingX": 24, "columns": [
      { "blocks": [ /* blocks */ ] }
    ] }
  ]
}

Allowed block shapes (omit id):
- heading: { "type": "heading", "level": 1|2|3, "text": "...", "align": "left|center|right", "color": "#hex" }
- text:    { "type": "text",    "html": "plain text", "align": "left|center|right", "color": "#hex" }
- button:  { "type": "button",  "label": "...", "href": "https://...", "bg": "#hex", "color": "#hex", "align": "left|center|right" }
- divider, spacer, list as in the campaign generator.

Skip image tags — leave a comment-only gap if needed. Preserve headings, paragraphs, lists, buttons, colors, and the overall hero/body structure. Do NOT inline-style; the renderer adds styling.

Source HTML:
${html}`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, emailAgentId, { timeoutMs: AI_TIMEOUT_MS, project: emailProject });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to rebuild the email." };
  }

  const stripped = stripCodeFence(raw);
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "AI did not return valid JSON. Try again." };

  let aiEmail: unknown;
  try {
    aiEmail = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: "AI returned malformed JSON. Try again." };
  }

  const document = normalizeAiEmail(aiEmail);
  const content = serializeEmail(document);

  await prisma.campaignDocument.update({ where: { id: documentId }, data: { content } });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);

  return { ok: true, content };
}

// ---------------------------------------------------------------------------
// Publish a Hive snap document — mirrors repo-to-social.publishTweetToHive.
// Posts the doc's content as a comment under peak.snaps' latest container.
// ---------------------------------------------------------------------------

export async function publishHiveSnap(
  documentId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const account = process.env.HIVE_POSTING_ACCOUNT;
    const key = process.env.HIVE_POSTING_KEY;
    if (!account || !key) {
      return { ok: false, error: "HIVE_POSTING_ACCOUNT or HIVE_POSTING_KEY not set on the server." };
    }

    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { content: true, campaignId: true },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    const text = doc.content.trim();
    if (!text) return { ok: false, error: "Snap is empty — nothing to publish." };

    // Read active project so community tag and app label are project-aware.
    const snapProject = await getActiveProject();
    const communityTag = snapProject.hive.community;

    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);

    const result = (await client.database.call("get_discussions_by_author_before_date", [
      SNAPS_CONTAINER_AUTHOR,
      "",
      new Date().toISOString().split(".")[0],
      1,
    ])) as Array<{ permlink: string }>;
    if (!result?.[0]?.permlink) {
      return { ok: false, error: "Could not fetch peak.snaps container." };
    }
    const parentPermlink = result[0].permlink;
    const permlink = `snap-${crypto.randomUUID()}`;

    const imageUrls = [
      ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
    ]
      .map((m) => m[1])
      .concat(text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/gi) ?? []);

    const metadata = {
      app: `Marketing Portal ${snapProject.name}`,
      tags: [communityTag, "snaps"],
      images: [...new Set(imageUrls)],
    };
    const op = [
      "comment",
      {
        parent_author: SNAPS_CONTAINER_AUTHOR,
        parent_permlink: parentPermlink,
        author: account,
        permlink,
        title: "",
        body: text,
        json_metadata: JSON.stringify(metadata),
      },
    ] as const;

    const pk = PrivateKey.fromString(key);
    await client.broadcast.sendOperations([op as never], pk);

    const url = `https://skatehive.app/post/${account}/${permlink}`; // NOTE: skatehive.app is the canonical Hive frontend used by all tenants; keeping as-is.
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Resolve everything a Hive mag-post publish needs (title, body, images,
// community, tags, beneficiaries, PT translation) WITHOUT broadcasting. Shared
// by the publish action and the publish-confirmation preview so what you see is
// exactly what gets posted.
// ---------------------------------------------------------------------------

type MagPostFields = {
  campaignId: string;
  account: string | null;
  title: string;
  body: string;
  community: string;
  imageUrls: string[];
  tags: string[];
  ptBody: string;
  beneficiaries: { account: string; weight: number }[];
};

async function buildMagPostFields(
  documentId: string,
  magProject: Awaited<ReturnType<typeof getActiveProject>>,
): Promise<{ ok: false; error: string } | ({ ok: true } & MagPostFields)> {
  const prefix = magProject.agent.gatewayEnvPrefix;
  const account =
    process.env[`${prefix}_HIVE_POSTING_ACCOUNT`] ?? process.env.HIVE_POSTING_ACCOUNT ?? null;

  const doc = await prisma.campaignDocument.findUnique({
    where: { id: documentId },
    select: { content: true, campaignId: true },
  });
  if (!doc) return { ok: false, error: "Document not found." };
  let body = doc.content.trim();
  if (!body) return { ok: false, error: "Mag post is empty — nothing to publish." };

  // Sibling Portuguese translation → json_metadata.translations.pt
  const ptDoc = await prisma.campaignDocument.findFirst({
    where: { campaignId: doc.campaignId, name: "Hive mag post (PT)", isMain: false },
    select: { content: true },
  });
  const ptBody = (ptDoc?.content ?? "").trim();

  // Title = first markdown heading of ANY level (# … ######), stripped from the
  // body. Mag posts emit their (already-translated) title as the leading
  // heading — often `##`, not `#`. Falling back to the campaign name would drag
  // in the untranslated "Cross-platform from Instagram — …" prefix, so we only
  // use that as a last resort and strip that prefix when we do.
  let title = "";
  const heading = body.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  if (heading) {
    title = heading[1].trim();
    body = body.replace(heading[0], "").trim();
  }
  if (!title) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: doc.campaignId },
      select: { name: true },
    });
    title = (campaign?.name ?? "Untitled")
      .replace(/^\s*cross-platform from [^—–\-:]+[—–\-:]\s*/i, "")
      .trim();
  }

  const community = magProject.hive.community;
  const imageUrls = [
    ...new Set([...body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1])),
  ];
  const tags = [community, magProject.slug];
  // Beneficiaries — drop any equal to the posting account (Hive rejects a
  // self-beneficiary) and sort ascending by account (Hive requires it).
  const beneficiaries = (account
    ? MAG_POST_BENEFICIARIES.filter((b) => b.account !== account)
    : MAG_POST_BENEFICIARIES
  ).sort((a, b) => a.account.localeCompare(b.account));

  return { ok: true, campaignId: doc.campaignId, account, title, body, community, imageUrls, tags, ptBody, beneficiaries };
}

/**
 * Preview of what a Hive mag-post publish will look like — used by the
 * confirmation dialog. Read-only; never broadcasts.
 */
export async function getHiveMagPostPreview(documentId: string): Promise<
  | {
      ok: true;
      title: string;
      account: string | null;
      community: string;
      tags: string[];
      images: string[];
      thumbnail: string | null;
      bodyMarkdown: string;
      hasPtTranslation: boolean;
      beneficiaries: { account: string; weight: number }[];
      frontend: string | null;
    }
  | { ok: false; error: string }
> {
  const project = await getActiveProject();
  const built = await buildMagPostFields(documentId, project);
  if (!built.ok) return built;
  return {
    ok: true,
    title: built.title,
    account: built.account,
    community: built.community,
    tags: built.tags,
    images: built.imageUrls,
    thumbnail: built.imageUrls[0] ?? null,
    bodyMarkdown: built.body,
    hasPtTranslation: built.ptBody.length > 0,
    beneficiaries: built.beneficiaries,
    frontend: project.hive.frontend ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mag-post permlink + URL — DETERMINISTIC so the URL is knowable at artifact
// generation time. The artifacts prompt hands the AI this exact URL (so casts/
// tweets/discord/email never invent one), and publishHiveMagPost derives the
// same permlink at broadcast time. Derived from the campaign NAME + id suffix:
// renaming the campaign between generation and publish breaks the match, so
// don't. Bonus: re-publishing the same campaign's mag post becomes a Hive
// EDIT (same permlink) instead of a duplicate post.
// ---------------------------------------------------------------------------

function magPostPermlink(campaignName: string, campaignId: string): string {
  const slug =
    campaignName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "post";
  return `${slug}-${campaignId.slice(-8)}`;
}

function magPostUrl(project: ProjectConfig, account: string, permlink: string): string {
  const base = project.hive.frontend?.replace(/\/+$/, "");
  return base ? `${base}/post/${account}/${permlink}` : `https://peakd.com/@${account}/${permlink}`;
}

// ---------------------------------------------------------------------------
// Publish a "Hive mag post" document as a ROOT Hive blog post in the project's
// community (as the project's own Hive account). The English body is the post;
// the sibling "Hive mag post (PT)" doc rides along in json_metadata.translations.pt.
// ---------------------------------------------------------------------------

export async function publishHiveMagPost(
  documentId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const magProject = await getActiveProject();
    const prefix = magProject.agent.gatewayEnvPrefix;
    const key = process.env[`${prefix}_HIVE_POSTING_KEY`] ?? process.env.HIVE_POSTING_KEY;

    const built = await buildMagPostFields(documentId, magProject);
    if (!built.ok) return built;
    const { campaignId, account, title, body, community: communityTag, imageUrls, tags, ptBody, beneficiaries } = built;
    if (!account || !key) {
      return { ok: false, error: `Hive posting account/key not set for ${magProject.name}.` };
    }

    // Deterministic — must match the predicted URL the artifacts prompt handed
    // to the AI (see magPostPermlink). Falls back to the doc title for legacy
    // campaigns whose row vanished.
    const magCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { name: true },
    });
    const permlink = magPostPermlink(magCampaign?.name?.trim() || title, campaignId);

    const metadata: Record<string, unknown> = {
      app: `Marketing Portal ${magProject.name}`,
      format: "markdown",
      tags,
      image: imageUrls,
    };
    if (ptBody) metadata.translations = { pt: ptBody };

    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);
    const op = [
      "comment",
      {
        parent_author: "",
        parent_permlink: communityTag,
        author: account,
        permlink,
        title,
        body,
        json_metadata: JSON.stringify(metadata),
      },
    ];

    const ops: unknown[] = [op];
    if (beneficiaries.length > 0) {
      ops.push([
        "comment_options",
        {
          author: account,
          permlink,
          max_accepted_payout: "1000000.000 HBD",
          percent_hbd: 10000,
          allow_votes: true,
          allow_curation_rewards: true,
          extensions: [[0, { beneficiaries }]],
        },
      ]);
    }

    const pk = PrivateKey.fromString(key);
    await client.broadcast.sendOperations(ops as never[], pk);

    await prisma.campaignDocument.update({
      where: { id: documentId },
      data: { postedAt: new Date(), postedTo: "hive-blog" },
    });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, url: magPostUrl(magProject, account, permlink) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------

async function upsertNamedDocument(campaignId: string, name: string, content: string) {
  if (!content) return;
  const existing = await prisma.campaignDocument.findFirst({
    where: { campaignId, name, isMain: false },
    select: { id: true },
  });
  if (existing) {
    await prisma.campaignDocument.update({ where: { id: existing.id }, data: { content } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name, isMain: false, content },
    });
  }
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^\s*```(?:\w+)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return fenced ? fenced[1] : text;
}

// Adds template-specific guard rails to the artifact prompt. The Weekly Stoken
// branch is the load-bearing one: the brief already lists real posts; the
// artifacts must reuse them verbatim instead of falling back to placeholders.
function buildTemplateArtifactRules(
  templateId: string | undefined,
  project: Awaited<ReturnType<typeof getActiveProject>>,
): string {
  const hiveAccount = project.hive.account;
  const farcasterChannel = project.farcaster.channel;
  const communityTag = project.hive.community;
  const projectName = project.name;

  if (templateId === "weekly-stoken") {
    return `\n\nTEMPLATE — WEEKLY STOKEN (strict rules):
- The brief above is the publishable Hive blog post and lists 5-8 real featured posts with @authors, full skatehive.app URLs, and image markdown. The "Real ${projectName} posts" section below the brief has the same posts in structured form (URL + Image URL per post). You MUST use those exact posts: authors, titles, URLs, image URLs, and the order they appear.
- NEVER emit [[clip 1]], [[author]], [[username]], [[YYYY-MM-DD]], or any other placeholder pattern. Use the real values.
- The link to the full Weekly Stoken issue is https://skatehive.app/@${hiveAccount}/the-weekly-stoken-<NN> where <NN> is the issue number in the brief's H1 (e.g. "Weekly Stoken #85").

Hive snap: name 2-3 of the actual featured creators using @mentions and link to the full recap URL. Community voice, under 280 chars.

Farcaster cast: real names + real link, /${farcasterChannel} channel voice. Under 320 chars.

Tweets: 3-5 tweets. Tweet 1 is the hook + downward arrow. Tweets 2-4 highlight specific featured posts (use the post title + @author + the post's own skatehive.app URL). Final tweet recaps the Creator of the Week.

Discord: list every featured post with bullet points (— **[<title>](<post url>)** by <@author>). Open with @everyone or @community. Include the recap link at the end.

EMAIL (this is the critical part — make it visual + clickable):
- Subject: "Weekly Stoken #<NN> — <punchy hook>". Preheader teases the Creator of the Week + post count.
- Hero section: dark gradient with eyebrow heading "WEEKLY STOKEN #<NN>" in the project accent color.
- Body section #1 (intro): H1 with the issue title, then one text block with the opening hook (1-2 sentences), then a button block "[Read the full recap](url)" pointing to https://skatehive.app/@${hiveAccount}/the-weekly-stoken-<NN>.
- Then FOR EACH FEATURED POST emit a section (one per post) with these blocks in order:
    1. image block — src = the post's "Image:" URL (from the structured list below), width 100, align "center", href = the post's skatehive.app URL (this makes the thumbnail a clickable link to the post)
    2. heading block — level 2, text = "[<post title>](<post url>)" using markdown link syntax so the title becomes clickable, color "#0a0a0a", align "left"
    3. text block — html = "By @<author>" then a newline then the one-sentence excerpt from the brief, color "#404040", align "left"
    4. divider block — color "#e5e5e5", thickness 1
- After all featured-post sections, emit ONE closing section with a heading "Creator of the Week", a text block with the spotlight paragraph (use [@<author>](https://skatehive.app/@<author>) markdown for the link), and a small final text block with an unsubscribe / sign-off note.
- DO NOT use a "list" block for the featured posts — use per-post image + heading + text + divider as described above. The list block does not render thumbnails.
- If a post in the structured list has no image URL, omit the image block for that post but still emit the heading + text + divider.`;
  }
  if (templateId === "updates-roundup") {
    return `\n\nTEMPLATE — UPDATES ROUND-UP:
- The brief lists the actual features shipped. Use those exact names + descriptions in every artifact; do not invent features.
- Hive snap: one-line "Here's what shipped" + 2-3 highlight bullets + link.
- Farcaster cast: dev voice, one paragraph, key ship + link.
- Tweets: thread breaking out the 3 most user-visible changes; one tweet per change.
- Discord: full list under **What shipped** + **Coming next** subsections. Tag @devs or @community as appropriate.
- Email: dev-to-community tone. Subject names the headline ship. Use heading + text blocks for each feature; end with "Coming next" list.`;
  }
  if (templateId === "we-miss-you") {
    return `\n\nTEMPLATE — WE MISS YOU:
- Tone is warm + honest, never guilt-trippy. Personal, not promotional.
- Hive snap + Farcaster cast: short, public-facing "if you've been gone for a minute…" framing — they're the reminder, not the personal outreach.
- Tweets: broad reminder the door is open; no @-mentions of lapsed accounts.
- Discord: a DM template mods can copy/paste, with first_name placeholder and the lapsed user's last-post date placeholder ([last_post_date]).
- Email: personalization tokens {{first_name}} in the H1 and \`{{last_post_date}}\` in the body. Subject is conversational ("Long time, {{first_name}}?"). Single button "Join us again" linking to https://skatehive.app.`;
  }
  // Suppress unused-variable warning for communityTag; it's available for future template rules.
  void communityTag;
  return "";
}

// Tolerant extractor: returns whatever fields are present + parseable. The
// caller decides whether the result is good enough to save. Returns null
// only when no valid JSON object can be located at all.
function extractArtifactsJson(raw: string): {
  hive_snap: string;
  hive_mag_post: string;
  hive_mag_post_pt: string;
  farcaster: string;
  tweets: string[];
  discord: string;
  email: unknown | null;
} | null {
  const candidates = extractJsonCandidates(raw);
  let fallback: {
    hive_snap: string;
    hive_mag_post: string;
    hive_mag_post_pt: string;
    farcaster: string;
    tweets: string[];
    discord: string;
    email: unknown | null;
  } | null = null;

  for (const candidate of candidates) {
    // Parse the candidate; if it fails (e.g. the AI left a raw newline inside a
    // string — common with long-form content), retry on a repaired copy.
    let obj: Record<string, unknown> | null = null;
    try {
      obj = JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      try {
        obj = JSON.parse(repairLooseJson(candidate)) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    if (!obj || typeof obj !== "object") continue;

    const hive_snap = pickString(obj.hive_snap) ?? pickString(obj.hive) ?? pickString(obj.snap) ?? "";
    const hive_mag_post = pickString(obj.hive_mag_post) ?? pickString(obj.hive_blog) ?? pickString(obj.mag_post) ?? "";
    const hive_mag_post_pt = pickString(obj.hive_mag_post_pt) ?? pickString(obj.hive_mag_post_ptbr) ?? pickString(obj.mag_post_pt) ?? "";
    const farcaster = pickString(obj.farcaster) ?? pickString(obj.cast) ?? "";
    const tweetsRaw = Array.isArray(obj.tweets)
      ? obj.tweets
      : Array.isArray(obj.twitter)
        ? obj.twitter
        : [];
    const tweets = tweetsRaw.filter((t): t is string => typeof t === "string");
    const discord = pickString(obj.discord) ?? "";
    const email = obj.email && typeof obj.email === "object" ? obj.email : null;
    const result = { hive_snap, hive_mag_post, hive_mag_post_pt, farcaster, tweets, discord, email };

    // Prefer the candidate that actually carries the expected fields — a nested
    // blob (e.g. an email section) can parse cleanly but have none of them.
    if (hive_snap || hive_mag_post || farcaster || tweets.length > 0 || discord || email) {
      return result;
    }
    if (!fallback) fallback = result;
  }
  return fallback;
}

// Escape raw control characters that appear INSIDE JSON string literals — the
// most common reason an LLM's otherwise-valid JSON fails JSON.parse on long
// multi-line content. Leaves everything outside strings untouched.
function repairLooseJson(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

// Pulls out candidate JSON blobs from a raw AI response. Tries, in order:
// 1. Code-fenced ```json blocks (most reliable when the AI uses fences).
// 2. The entire string with leading/trailing prose trimmed.
// 3. A balanced-brace walker starting at each `{` to handle nested braces.
function extractJsonCandidates(raw: string): string[] {
  const out: string[] = [];
  const fenceRe = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    if (m[1].trim().startsWith("{")) out.push(m[1].trim());
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "{") continue;
    const blob = extractBalancedBraces(raw, i);
    if (blob) out.push(blob);
  }
  // Dedupe while preserving order.
  return Array.from(new Set(out));
}

function extractBalancedBraces(text: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// AI -> EmailDocument normalization. The AI emits a loosely-typed shape;
// we coerce to a valid EmailDocument with IDs filled in.
// ---------------------------------------------------------------------------

function normalizeAiEmail(input: unknown): EmailDocument {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const subject = typeof obj.subject === "string" ? obj.subject : "";
  const preheader = typeof obj.preheader === "string" ? obj.preheader : "";
  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const sections: EmailSection[] = sectionsRaw.map(normalizeAiSection);
  return {
    version: 1,
    subject,
    preheader,
    pageBackground: "#f4f4f5",
    contentBackground: "#ffffff",
    contentWidth: 640,
    textColor: "#171717",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sections: sections.length ? sections : [],
  };
}

function normalizeAiSection(input: unknown): EmailSection {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const columnsRaw = Array.isArray(obj.columns) ? obj.columns : [];
  const columns: EmailColumn[] = columnsRaw.map(normalizeAiColumn);
  return {
    id: newId("sec"),
    background: typeof obj.background === "string" ? obj.background : "#ffffff",
    paddingY: typeof obj.paddingY === "number" ? obj.paddingY : 24,
    paddingX: typeof obj.paddingX === "number" ? obj.paddingX : 24,
    columns: columns.length ? columns : [{ id: newId("col"), blocks: [] }],
  };
}

function normalizeAiColumn(input: unknown): EmailColumn {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks = blocksRaw
    .map(normalizeAiBlock)
    .filter((b): b is EmailBlock => b !== null);
  return { id: newId("col"), blocks };
}

function normalizeAiBlock(input: unknown): EmailBlock | null {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = obj.type;
  const align = pickAlign(obj.align);
  switch (type) {
    case "heading": {
      const levelRaw = obj.level;
      const level = levelRaw === 1 || levelRaw === 2 || levelRaw === 3 ? levelRaw : 2;
      return {
        id: newId("h"),
        type: "heading",
        level,
        text: typeof obj.text === "string" ? obj.text : "",
        align,
        color: pickColor(obj.color, "#0a0a0a"),
      };
    }
    case "text":
      return {
        id: newId("t"),
        type: "text",
        html:
          typeof obj.html === "string"
            ? obj.html
            : typeof obj.text === "string"
              ? (obj.text as string)
              : "",
        align,
        color: pickColor(obj.color, "#404040"),
      };
    case "button":
      return {
        id: newId("btn"),
        type: "button",
        label: typeof obj.label === "string" ? obj.label : "Drop in",
        href: typeof obj.href === "string" ? obj.href : "https://skatehive.app",
        bg: pickColor(obj.bg, "#65a30d"),
        color: pickColor(obj.color, "#ffffff"),
        align,
      };
    case "divider":
      return {
        id: newId("div"),
        type: "divider",
        color: pickColor(obj.color, "#e5e5e5"),
        thickness: typeof obj.thickness === "number" ? obj.thickness : 1,
      };
    case "spacer":
      return {
        id: newId("sp"),
        type: "spacer",
        height: typeof obj.height === "number" ? obj.height : 24,
      };
    case "list": {
      const items = Array.isArray(obj.items)
        ? obj.items.filter((x): x is string => typeof x === "string")
        : [];
      return {
        id: newId("li"),
        type: "list",
        ordered: Boolean(obj.ordered),
        items: items.length ? items : ["Item"],
      };
    }
    case "image": {
      const src = typeof obj.src === "string" ? obj.src.trim() : "";
      if (!src.startsWith("http")) return null;
      const widthRaw = typeof obj.width === "number" ? obj.width : 100;
      const width = Math.min(100, Math.max(20, Math.round(widthRaw)));
      const href = typeof obj.href === "string" && obj.href.startsWith("http") ? obj.href : undefined;
      return {
        id: newId("img"),
        type: "image",
        src,
        alt: typeof obj.alt === "string" ? obj.alt : "",
        align: align === "left" || align === "right" ? align : "center",
        width,
        href,
      };
    }
    default:
      return null;
  }
}

function pickAlign(value: unknown): Align {
  if (value === "left" || value === "center" || value === "right") return value;
  return "left";
}

function pickColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length ? value : fallback;
}

// ---------------------------------------------------------------------------
// B1/B2 — per-artifact actions: toggleArtifactPosted, remixCampaignArtifact,
// sendCampaignArtifact
// ---------------------------------------------------------------------------

/** Flip postedAt between now and null. Returns the new state. */
export async function toggleArtifactPosted(
  documentId: string,
): Promise<{ ok: true; postedAt: Date | null } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { postedAt: true, campaign: { select: { projectSlug: true } } },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.campaign.projectSlug !== project.slug) return { ok: false, error: "Access denied." };

    const newPostedAt = doc.postedAt ? null : new Date();
    const updated = await prisma.campaignDocument.update({
      where: { id: documentId },
      data: { postedAt: newPostedAt },
      select: { postedAt: true, campaignId: true },
    });
    revalidatePath(`/campaign-creator/${updated.campaignId}`);
    return { ok: true, postedAt: updated.postedAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Regenerate a single campaign artifact in-place. */
export async function remixCampaignArtifact(
  documentId: string,
  instruction?: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        name: true,
        campaignId: true,
        campaign: {
          select: {
            projectSlug: true,
            name: true,
            documents: { where: { isMain: true }, take: 1, select: { content: true } },
          },
        },
      },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.campaign.projectSlug !== project.slug) return { ok: false, error: "Access denied." };

    const brief = (doc.campaign.documents[0]?.content ?? "").trim();
    if (!brief) {
      return { ok: false, error: "No brief found — generate or write the brief first." };
    }

    const kind = classifyDocumentKindByName(doc.name);

    // Per-kind rule text mirrors what generateCampaignArtifacts uses.
    const templateRules = buildTemplateArtifactRules(undefined, project);
    const voiceHint = project.campaignArtifacts?.voiceHint?.trim();
    const persona = campaignPersona(project);

    let kindRule: string;
    switch (kind) {
      case "hive":
        kindRule = `Write a single Hive snap for the ${project.hive.community} community as @${project.hive.account}. Plain text, real line breaks, under 280 characters when possible. Community voice. No hashtags in front.`;
        break;
      case "farcaster":
        kindRule = `Write a single Farcaster cast for the /${project.farcaster.channel} channel as @${project.hive.account}. Under 320 characters. Plain text. One short hook + the link. Emojis are fine.`;
        break;
      case "tweets":
        kindRule = `Write an X/Twitter thread: an array of 3-5 tweet strings. The first opens with a hook + payoff and ends with a downward arrow. Each subsequent tweet stands on its own. Plain text, real line breaks. Keep each under 280 characters. Don't number them. Return the tweets joined by \\n---\\n (three hyphens surrounded by newlines). No JSON wrapper.`;
        break;
      case "discord":
        kindRule = `Write a single Discord announcement for the ${project.name} #announcements channel. Start with @everyone or @community if appropriate. Discord markdown (**bold**, bullet lists). Include the relevant link(s). More casual than tweets.`;
        break;
      case "email": {
        const accentColor = project.theme.accentDark;
        kindRule = `Write a structured email document as valid JSON with shape: { "subject": "...", "preheader": "...", "sections": [...] }. Open with a dark hero section + eyebrow heading "${project.name.toUpperCase()} UPDATE" in the project accent color (${accentColor}). Body section follows with the campaign-specific blocks. Return ONLY the JSON object.`;
        break;
      }
      default:
        kindRule = "Rewrite this document with improved clarity and campaign focus.";
    }

    const instructionLine = instruction?.trim()
      ? `\n\nApply this revision: ${instruction.trim()}`
      : "";

    const prompt = `You are ${persona}.${voiceHint ? `\n\nVoice: ${voiceHint}` : ""}

Campaign: "${doc.campaign.name}"

Brief:
${brief}
${templateRules}

Task: ${kindRule}${instructionLine}

${kind === "tweets"
  ? `Return ONLY the tweet strings joined by \\n---\\n. No prose, no labels, no JSON wrapper.`
  : kind === "email"
    ? `Return ONLY the JSON object. No prose, no code fences.`
    : `Return ONLY the new content as plain text. No preamble, no code fences.`}`;

    await ensureLocalGatewayToken();
    let raw: string;
    try {
      raw = await callOpenClaw(prompt, project.agent.id, { timeoutMs: AI_TIMEOUT_MS, project });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed." };
    }

    let content: string;
    if (kind === "email") {
      const match = stripCodeFence(raw).match(/\{[\s\S]*\}/);
      if (!match) return { ok: false, error: "AI did not return valid JSON for email. Try again." };
      let aiEmail: unknown;
      try {
        aiEmail = JSON.parse(match[0]);
      } catch {
        try {
          aiEmail = JSON.parse(repairLooseJson(match[0]));
        } catch {
          return { ok: false, error: "AI returned malformed JSON for email. Try again." };
        }
      }
      const emailDocument = normalizeAiEmail(aiEmail);
      content = serializeEmail(emailDocument);
    } else {
      content = stripCodeFence(raw).trim();
    }

    if (!content) return { ok: false, error: "AI returned empty content. Try again." };

    await prisma.campaignDocument.update({
      where: { id: documentId },
      data: { content },
    });
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Publish a campaign artifact where supported; return manual-copy signal for others. */
export async function sendCampaignArtifact(
  documentId: string,
): Promise<
  | { ok: true; url?: string; platform: string; detail?: string }
  | { ok: false; error: string; manual?: boolean }
> {
  try {
    const project = await getActiveProject();
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        name: true,
        content: true,
        campaignId: true,
        campaign: { select: { projectSlug: true } },
      },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.campaign.projectSlug !== project.slug) return { ok: false, error: "Access denied." };

    const kind = classifyDocumentKindByName(doc.name);
    const content = doc.content.trim();
    if (!content) return { ok: false, error: "Document is empty — nothing to send." };

    if (kind === "hive") {
      const { publishSnapToHive } = await import("@/lib/social-publish");
      const result = await publishSnapToHive(content, project);
      if (!result.ok) return { ok: false, error: result.error };
      await prisma.campaignDocument.update({
        where: { id: documentId },
        data: { postedAt: new Date(), postedTo: "hive" },
      });
      revalidatePath(`/campaign-creator/${doc.campaignId}`);
      return { ok: true, url: result.url, platform: "hive" };
    }

    if (kind === "hive_mag") {
      const result = await publishHiveMagPost(documentId);
      if (!result.ok) return { ok: false, error: result.error ?? "Failed to publish mag post." };
      return { ok: true, url: result.url, platform: "hive-blog" };
    }

    if (kind === "farcaster") {
      const { publishCastToFarcaster } = await import("@/lib/social-publish");
      const result = await publishCastToFarcaster(content, project);
      if (!result.ok) return { ok: false, error: result.error };
      await prisma.campaignDocument.update({
        where: { id: documentId },
        data: { postedAt: new Date(), postedTo: "farcaster" },
      });
      revalidatePath(`/campaign-creator/${doc.campaignId}`);
      return { ok: true, url: result.url, platform: "farcaster" };
    }

    if (kind === "discord") {
      const { publishToDiscord } = await import("@/lib/social-publish");
      const result = await publishToDiscord(content, project);
      if (!result.ok) return { ok: false, error: result.error };
      await prisma.campaignDocument.update({
        where: { id: documentId },
        data: { postedAt: new Date(), postedTo: "discord" },
      });
      revalidatePath(`/campaign-creator/${doc.campaignId}`);
      return { ok: true, platform: "discord" };
    }

    // Twitter / Email — handled client-side (X intent) or via sendCampaignEmail.
    return {
      ok: false,
      error: "manual",
      manual: true,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Email creds status:
//   - SkateHive: DONE (2026-06-09) — SKATEHIVE_SMTP_HOST/PORT/SECURE +
//     SKATEHIVE_EMAIL_USER/PASS (Gmail skatehiveapp, copied from skatehive3.0,
//     SMTP connection verified) in .env.local + Vercel prod+preview.
//   - TODO Gnars + Reelflip: need their OWN mailboxes/SMTP created first, then
//     GNARS_SMTP_*/GNARS_EMAIL_* and REELFLIP_SMTP_*/REELFLIP_EMAIL_*. Until set
//     they show Email = "Not set" on /team and this returns "not configured".
/** Send the email artifact via SMTP/nodemailer to a single recipient. */
export async function sendCampaignEmail(
  documentId: string,
  recipient: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        name: true,
        content: true,
        campaignId: true,
        campaign: { select: { projectSlug: true, name: true } },
      },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.campaign.projectSlug !== project.slug) return { ok: false, error: "Access denied." };

    // Validate recipient.
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(recipient.trim())) {
      return { ok: false, error: "Enter a valid recipient email." };
    }
    const to = recipient.trim();

    // Build HTML from structured email doc or legacy HTML.
    const { parseEmail, renderEmail } = await import("@/lib/campaign-email");
    const parsed = parseEmail(doc.content);
    let html: string;
    let subject: string;
    if (parsed.kind === "document") {
      html = renderEmail(parsed.document);
      subject = parsed.document.subject || doc.campaign.name;
    } else if (parsed.kind === "legacy_html") {
      html = parsed.html;
      subject = doc.campaign.name;
    } else {
      return { ok: false, error: "Email document is empty — nothing to send." };
    }

    // Plain-text fallback: strip HTML tags.
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

    // Delegate SMTP resolution + send to the shared helper.
    const { sendProjectEmail } = await import("@/lib/email");
    const result = await sendProjectEmail(project, { to, subject, html, text });
    if (!result.ok) return result;

    await prisma.campaignDocument.update({
      where: { id: documentId },
      data: { postedAt: new Date(), postedTo: "email" },
    });
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send email.",
    };
  }
}

/** Map document name to artifact kind. */
function classifyDocumentKindByName(name: string): CampaignDocumentKind {
  const lower = name.toLowerCase();
  if (lower.includes("mag post") && lower.includes("(pt)")) return "doc";
  if (lower.includes("mag post") || lower.includes("magazine")) return "hive_mag";
  if (lower.includes("hive") || lower.includes("snap")) return "hive";
  if (lower.includes("farcaster") || lower.includes("cast") || lower.includes("warpcast")) return "farcaster";
  if (lower.includes("tweet") || lower.includes("twitter") || lower.includes("x thread")) return "tweets";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("email")) return "email";
  if (lower.includes("markdown") || lower.includes("blog") || lower.includes("post")) return "markdown";
  return "doc";
}

// Need to export type for the import in classifyDocumentKindByName
type CampaignDocumentKind =
  | "brief"
  | "hive"
  | "hive_mag"
  | "farcaster"
  | "tweets"
  | "discord"
  | "email"
  | "markdown"
  | "doc";
