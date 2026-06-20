"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { resolveFarcasterSigner } from "@/lib/farcaster-signer";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import type { ProjectConfig } from "@/projects/types";

// Curation-trail HITL replies. Each portal sees the partner casts the trail
// worker flagged for IT to reply to (FarcasterTrailAction.actorSlug = this
// project, kind=reply). The human generates an on-brand draft with AI, edits,
// and posts it as this portal's Farcaster account.

const AI_TIMEOUT_MS = 60_000;

export type TrailItem = {
  actionId: string;
  status: string;
  draft: string | null;
  cast: { hash: string; authorSlug: string; authorFid: number; text: string; postedAt: string; url: string };
  liked: boolean; // did THIS portal already auto-like it
};

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

function castUrl(authorSlug: string, hash: string): string {
  return `https://warpcast.com/${authorSlug}/${hash.slice(0, 10)}`;
}

/** Partner casts this portal should reply to (pending/failed first, then done). */
export async function listTrailFeed(): Promise<
  { ok: true; items: TrailItem[]; project: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const slug = g.project.slug;

  const replies = await prisma.farcasterTrailAction
    .findMany({
      where: { actorSlug: slug, kind: "reply", status: { in: ["pending", "failed", "done"] } },
      include: { cast: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    })
    .catch(() => []);

  // Did this portal auto-like each cast? (sibling like action)
  const likeRows = await prisma.farcasterTrailAction
    .findMany({ where: { actorSlug: slug, kind: "like", castHash: { in: replies.map((r) => r.castHash) } } })
    .catch(() => []);
  const likedByCast = new Map(likeRows.map((l) => [l.castHash, l.status === "done"]));

  const items: TrailItem[] = replies.map((r) => ({
    actionId: r.id,
    status: r.status,
    draft: r.draft,
    liked: likedByCast.get(r.castHash) ?? false,
    cast: {
      hash: r.cast.hash,
      authorSlug: r.cast.authorSlug,
      authorFid: r.cast.authorFid,
      text: r.cast.text,
      postedAt: r.cast.postedAt.toISOString(),
      url: castUrl(r.cast.authorSlug, r.cast.hash),
    },
  }));
  return { ok: true, items, project: g.project.name };
}

function replyPrompt(
  project: ProjectConfig,
  partnerSlug: string,
  castText: string,
  instruction?: string,
  current?: string,
): string {
  const voice = project.socials.find((s) => s.voice)?.voice ?? `${project.name}'s authentic, culture-native voice`;
  const steer = instruction?.trim()
    ? `\n\nEXTRA INSTRUCTION (highest priority — follow it): ${instruction.trim()}${
        current?.trim() ? `\nRefine this current draft accordingly: """${current.trim()}"""` : ""
      }`
    : "";
  return `You are ${project.name}'s social account replying to a Farcaster cast from a partner brand (@${partnerSlug}).

${project.name}'s voice: ${voice}

Their cast:
"""
${castText}
"""

Write ONE short, genuine reply in that voice — supportive, specific to what they actually said, never generic hype. Skate/culture-native. No hashtags, at most one emoji (only if it fits). Max 220 characters. Output ONLY the reply text, nothing else.${steer}`;
}

/** Generate an on-brand AI draft for a reply action. Optional `instruction`
 * steers the tone/content; `current` is the existing draft to refine. */
export async function generateTrailReply(
  actionId: string,
  instruction?: string,
  current?: string,
): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;

  const action = await prisma.farcasterTrailAction
    .findUnique({ where: { id: actionId }, include: { cast: true } })
    .catch(() => null);
  if (!action || action.actorSlug !== g.project.slug || action.kind !== "reply") {
    return { ok: false, error: "Ação não encontrada." };
  }

  let draft: string;
  try {
    const raw = await callOpenClaw(
      replyPrompt(g.project, action.cast.authorSlug, action.cast.text, instruction, current),
      g.project.agent.id,
      { timeoutMs: AI_TIMEOUT_MS, project: g.project },
    );
    draft = raw.trim().replace(/^["']|["']$/g, "").slice(0, 280);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na IA." };
  }

  await prisma.farcasterTrailAction.update({ where: { id: actionId }, data: { draft } }).catch(() => {});
  return { ok: true, draft };
}

/** Post the reply as this portal's Farcaster account (reply = parent set). */
export async function postTrailReply(
  actionId: string,
  text: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const body = text.trim();
  if (!body) return { ok: false, error: "Texto vazio." };

  const action = await prisma.farcasterTrailAction
    .findUnique({ where: { id: actionId }, include: { cast: true } })
    .catch(() => null);
  if (!action || action.actorSlug !== g.project.slug || action.kind !== "reply") {
    return { ok: false, error: "Ação não encontrada." };
  }

  const signer = await resolveFarcasterSigner(g.project);
  const prefix = g.project.agent.gatewayEnvPrefix;
  const apiKey = (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) || process.env.NEYNAR_API_KEY;
  if (!signer || !apiKey) return { ok: false, error: "Farcaster não conectado neste portal." };

  const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ signer_uuid: signer.signerUuid, text: body, parent: action.cast.hash }),
  });
  const j = (await res.json().catch(() => ({}))) as { cast?: { hash?: string } };
  if (!res.ok || !j.cast?.hash) {
    const err = `Neynar HTTP ${res.status}`;
    await prisma.farcasterTrailAction
      .update({ where: { id: actionId }, data: { status: "failed", error: err } })
      .catch(() => {});
    return { ok: false, error: err };
  }

  const hash = j.cast.hash;
  await prisma.farcasterTrailAction
    .update({ where: { id: actionId }, data: { status: "done", postedText: body, resultRef: hash, error: null } })
    .catch(() => {});
  return { ok: true, url: castUrl(g.project.slug, hash) };
}

/** Dismiss a reply (won't show in the actionable list). */
export async function skipTrailReply(actionId: string): Promise<{ ok: boolean }> {
  const g = await gate();
  if (!g.ok) return { ok: false };
  await prisma.farcasterTrailAction
    .updateMany({ where: { id: actionId, actorSlug: g.project.slug, kind: "reply" }, data: { status: "skipped" } })
    .catch(() => {});
  return { ok: true };
}
