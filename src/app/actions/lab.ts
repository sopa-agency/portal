"use server";

import { cookies } from "next/headers";
import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { publishLabChannel } from "@/lib/lab-publish";
import { prisma } from "@/lib/prisma";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { buildGenerateCaptionPrompt, buildImproveCaptionPrompt } from "@/lib/post-creator-prompts";
import type { PostType } from "@/app/actions/post-creator";
import { getLatestSocialInsight } from "@/app/actions/social-insights";
import { getLatestAnalyticsInsight } from "@/app/actions/analytics-insights";
import { getActiveProject } from "@/projects/index";

const LAB_AI_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 120_000);

type TextResult = { ok: true; text: string } | { ok: false; error: string };

async function labGate() {
  const project = await getActiveProject();
  if (!project.lab) throw new Error("Lab is not enabled for this project.");
  return project;
}

/** Improve the current text with the project agent (lab-scoped — no Post Creator
 *  requirement). Reuses the same prompt the Post Creator uses. */
export async function labImproveText(text: string, type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    if (!text.trim()) return { ok: false, error: "Nothing to improve." };
    const prompt = buildImproveCaptionPrompt({ agentName: project.agent.displayName, caption: text, type });
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Generate fresh text from a topic with the project agent. */
export async function labGenerateText(topic: string, type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    if (!topic.trim()) return { ok: false, error: "Give a topic first." };
    const prompt =
      buildGenerateCaptionPrompt({ agentName: project.agent.displayName, topic, type }) +
      `\n\nThis is a fresh request — produce a genuinely DIFFERENT caption than before. Variation seed (diverge, don't mention it): ${Math.random().toString(36).slice(2, 10)}.`;
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Campaign-style fan-out: tailor the base message per channel in one agent
 *  call. Returns a map of networkId → text. Channels carry their own norms. */
export async function labGenerateVariants(
  baseText: string,
  networks: { id: string; label: string; rule: string }[],
): Promise<{ ok: true; variants: Record<string, string> } | { ok: false; error: string }> {
  try {
    const project = await labGate();
    if (!baseText.trim()) return { ok: false, error: "Write a base message first." };
    if (!networks.length) return { ok: false, error: "No channels selected." };
    // Long-form channels get explicit length specs — mirrors the campaign
    // creator's brief→artifacts behavior so Hive Mag + email aren't short.
    const LONGFORM: Record<string, string> = {
      hive_mag:
        "FULL magazine article in Markdown — start with an H1 title, then multiple sections with headers, ~450–800 words. This is long-form editorial, NOT a short post. Expand the base message into a real article.",
      email:
        "Newsletter email — a subject line as the first line, then a well-structured body with several short paragraphs (and a clear CTA at the end), ~200–400 words. Scannable, NOT a one-liner.",
    };
    const list = networks
      .map((n) => `- "${n.id}" (${n.label}): ${LONGFORM[n.id] ?? n.rule}`)
      .join("\n");
    const prompt = `You are the ${project.agent.displayName} content lead. Read your brand playbook (docs/playbook.md) for voice.

Take this base message and write a tailored version for EACH channel below. Respect each channel's norms, limits AND length — short channels stay short, long-form channels (Hive Magazine, email) must be genuinely long as specified:

BASE MESSAGE:
"""
${baseText}
"""

CHANNELS:
${list}

Return ONLY a JSON object mapping each channel id to its tailored text, e.g. {"hive":"...","hive_mag":"# Title...","email":"Subject...\\n\\n..."}. No preamble, no code fences.`;
    const raw = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!raw) return { ok: false, error: "Agent returned empty." };
    const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const variants: Record<string, string> = {};
    for (const n of networks) {
      const v = parsed[n.id];
      if (typeof v === "string" && v.trim()) variants[n.id] = v.trim();
    }
    if (!Object.keys(variants).length) return { ok: false, error: "No variants parsed from the agent output." };
    return { ok: true, variants };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Signed-URL handshake for the Lab composer's media uploads, gated by the `lab`
// flag (so it works regardless of whether the project has Post Creator).
export async function signLabMediaUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    if (!project.lab) return { ok: false, error: "Lab is not enabled for this project." };
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type LabInsight = { key: string; label: string; body: string; generatedAt: string };

/** Gather the project's latest AI insights (analytics + per-platform social) so
 *  the Lab can turn one into a post. */
export async function getLabInsights(): Promise<LabInsight[]> {
  try {
    const project = await labGate();
    const out: LabInsight[] = [];
    const analytics = await getLatestAnalyticsInsight().catch(() => null);
    if (analytics?.body?.trim())
      out.push({ key: "analytics", label: "Analytics (GA4 + Search)", body: analytics.body, generatedAt: analytics.generatedAt });
    const seen = new Set<string>();
    for (const s of project.socials) {
      const platform = s.platform.toLowerCase();
      if (seen.has(platform)) continue;
      seen.add(platform);
      const ins = await getLatestSocialInsight(s.platform).catch(() => null);
      if (ins?.body?.trim())
        out.push({ key: `social:${platform}`, label: `${s.platform} insight`, body: ins.body, generatedAt: ins.generatedAt });
    }
    return out;
  } catch {
    return [];
  }
}

/** Generate a post that acts on an AI insight, in the project agent's voice. */
export async function labGeneratePostFromInsight(insight: string, type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    if (!insight.trim()) return { ok: false, error: "Empty insight." };
    const prompt = `You are the ${project.agent.displayName} content lead. Read your brand playbook (docs/playbook.md) for voice and what you actually post about.

The analytics insight below is INTERNAL strategy data — it is NOT the post. Use it ONLY to decide the angle, format, and topic of a brand-NEW, original post. Then write that fresh post as your audience would read it in their feed.

Hard rules:
- Output a real, ready-to-publish ${type} post about the brand's actual subject matter — NOT about analytics.
- Do NOT repeat, repost, or reference any past post. Do NOT say things like "post more of X", "repost the reel", "let's do another carousel" — that's strategy talk, not a post.
- Do NOT mention metrics, numbers, reach, the algorithm, or the insight itself. Never quote or summarize the insight.
- If the insight says a format/theme works, CREATE NEW content in that format/theme on a fresh idea — don't describe the strategy.

INSIGHT (internal — do not echo):
"""
${insight}
"""

This is a brand-new request — IGNORE anything you generated before and produce a genuinely DIFFERENT post: a fresh hook, angle and idea. Variation seed (use it to diverge, do not mention it): ${Math.random().toString(36).slice(2, 10)}.

Return ONLY the finished post text — no preamble, no quotes, no explanation.`;
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Publish a single channel's text NOW via the existing publish primitives.
 *  Session-gated (it posts publicly). X is intent-only (handled client-side);
 *  Hive Mag / email need the richer long-form/builder flow (not wired here). */
export async function labPublishNow(
  network: string,
  text: string,
): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
  try {
    const project = await labGate();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    if (!text.trim()) return { ok: false, error: "Empty text." };
    const r = await publishLabChannel(network, text, project);
    return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Enqueue a non-IG channel to publish later. The scheduler's publishDueLabPosts
 *  picks it up at scheduledFor and publishes via publishLabChannel. */
export async function labSchedulePost(
  network: string,
  text: string,
  whenISO: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const project = await labGate();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    if (!text.trim()) return { ok: false, error: "Empty text." };
    const when = new Date(whenISO);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date." };
    const row = await prisma.labScheduledPost.create({
      data: {
        projectSlug: project.slug,
        network,
        text: text.trim(),
        scheduledFor: when,
        createdBy: session.username,
      },
    });
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Analyze the project's repo(s) and draft a post from what shipped. Fetches
 *  recent commits via the GitHub API (public; uses a token if available) and
 *  asks the agent to tell the story — no agent repo-tool dependency. */
export async function labAnalyzeRepo(type: PostType): Promise<TextResult> {
  try {
    const project = await labGate();
    const repos = project.repos ?? [];
    if (!repos.length) return { ok: false, error: "Nenhum repo configurado para este projeto." };
    const token =
      process.env[`${project.agent.gatewayEnvPrefix}_GITHUB_TOKEN`] ?? process.env.GITHUB_TOKEN;

    const commits: { repo: string; message: string; author: string; date: string }[] = [];
    for (const r of repos.slice(0, 3)) {
      const [owner, repo] = r.replace(/^https?:\/\/github\.com\//, "").split("/");
      if (!owner || !repo) continue;
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?per_page=20`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "marketing-portal-lab",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (!res.ok) continue;
      const data = (await res.json().catch(() => [])) as Array<{
        commit?: { message?: string; author?: { name?: string; date?: string } };
      }>;
      for (const c of Array.isArray(data) ? data : []) {
        const message = (c.commit?.message ?? "").split("\n")[0].slice(0, 160);
        if (message) commits.push({ repo: r, message, author: c.commit?.author?.name ?? "", date: c.commit?.author?.date ?? "" });
      }
    }
    if (!commits.length) return { ok: false, error: "Não consegui ler commits dos repos (privado sem token?)." };

    const prompt = `You are the ${project.agent.displayName} content lead. Read your brand playbook (docs/playbook.md) for voice.

Below are recent commits from our repo(s). Write ONE ${type} post highlighting what genuinely shipped for the community — concrete, user-facing wins. Tell the story of what's new; do NOT list commits, mention hashes, or include internal/chore/refactor noise. If nothing is user-facing, pick the most interesting real change and frame it for the audience.

COMMITS (internal — do not echo raw):
${JSON.stringify(commits.slice(0, 20), null, 1)}

Fresh request — produce a distinct post. Seed (diverge, don't mention): ${Math.random().toString(36).slice(2, 10)}.

Return ONLY the finished post text — no preamble, no quotes.`;
    const out = await callOpenClaw(prompt, project.agent.id, { project, timeoutMs: LAB_AI_TIMEOUT_MS });
    if (!out) return { ok: false, error: "Agent returned empty." };
    return { ok: true, text: out.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
