"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { resolveFarcasterSigner } from "@/lib/farcaster-signer";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { brandEnv } from "@/lib/brand-env";
import { HIVE_NODES } from "@/lib/social-publish";
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
  cast: { hash: string; platform: string; authorSlug: string; authorHandle: string | null; text: string; postedAt: string; url: string };
  liked: boolean; // did THIS portal already auto-like/upvote it
};

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

function fcCastUrl(authorSlug: string, hash: string): string {
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
      platform: r.cast.platform,
      authorSlug: r.cast.authorSlug,
      authorHandle: r.cast.authorHandle,
      text: r.cast.text,
      postedAt: r.cast.postedAt.toISOString(),
      url: r.cast.url ?? fcCastUrl(r.cast.authorSlug, r.cast.hash),
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
  platform: string = "farcaster",
): string {
  const voice = project.socials.find((s) => s.voice)?.voice ?? `${project.name}'s authentic, culture-native voice`;
  const noun = platform === "hive" ? "Hive post" : "Farcaster cast";
  const steer = instruction?.trim()
    ? `\n\nEXTRA INSTRUCTION (highest priority — follow it): ${instruction.trim()}${
        current?.trim() ? `\nRefine this current draft accordingly: """${current.trim()}"""` : ""
      }`
    : "";
  return `You are replying to a ${noun} from a partner account (@${partnerSlug}) as ${project.name} — but you must sound like a REAL PERSON in the scene casually commenting, NOT a brand or a marketer.

${project.name}'s vibe (for reference, don't imitate corporate tone): ${voice}

Their ${noun}:
"""
${castText}
"""

Rules:
- VERY SHORT. One line. Usually under 80 characters. A few words is often perfect.
- Human and natural — like texting a friend. Lowercase is fine. Relaxed, a little imperfect.
- React to what they ACTUALLY said. No hype, no slogans, no marketing words ("incrível", "imperdível", "vamos juntos"...).
- No hashtags. At most one emoji, and only if a real person would actually use it (often none).
- Never sound like an announcement or an ad.

Output ONLY the reply text, nothing else.${steer}`;
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
      replyPrompt(g.project, action.cast.authorHandle ?? action.cast.authorSlug, action.cast.text, instruction, current, action.cast.platform),
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

/** Post the reply/comment as this portal's account (Farcaster reply or Hive comment). */
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

  const result =
    action.cast.platform === "hive"
      ? await postHiveComment(g.project, action.cast.hash, body)
      : await postFarcasterReply(g.project, action.cast.hash, body);

  if (!result.ok) {
    await prisma.farcasterTrailAction
      .update({ where: { id: actionId }, data: { status: "failed", error: result.error } })
      .catch(() => {});
    return result;
  }
  await prisma.farcasterTrailAction
    .update({ where: { id: actionId }, data: { status: "done", postedText: body, resultRef: result.ref, error: null } })
    .catch(() => {});
  return { ok: true, url: result.url };
}

async function postFarcasterReply(
  project: ProjectConfig,
  parentHash: string,
  body: string,
): Promise<{ ok: true; url: string; ref: string } | { ok: false; error: string }> {
  const signer = await resolveFarcasterSigner(project);
  const prefix = project.agent.gatewayEnvPrefix;
  const apiKey = (prefix && process.env[`${prefix}_NEYNAR_API_KEY`]) || process.env.NEYNAR_API_KEY;
  if (!signer || !apiKey) return { ok: false, error: "Farcaster não conectado neste portal." };

  const res = await fetch("https://api.neynar.com/v2/farcaster/cast", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ signer_uuid: signer.signerUuid, text: body, parent: parentHash }),
  });
  const j = (await res.json().catch(() => ({}))) as { cast?: { hash?: string } };
  if (!res.ok || !j.cast?.hash) return { ok: false, error: `Neynar HTTP ${res.status}` };
  return { ok: true, url: fcCastUrl(project.slug, j.cast.hash), ref: j.cast.hash };
}

async function postHiveComment(
  project: ProjectConfig,
  castHash: string, // "hive:author/permlink"
  body: string,
): Promise<{ ok: true; url: string; ref: string } | { ok: false; error: string }> {
  const account = brandEnv(project, "HIVE_POSTING_ACCOUNT");
  const key = brandEnv(project, "HIVE_POSTING_KEY");
  if (!account || !key) return { ok: false, error: "Hive não conectado neste portal (falta posting key)." };

  const [parentAuthor, parentPermlink] = castHash.replace(/^hive:/, "").split("/");
  if (!parentAuthor || !parentPermlink) return { ok: false, error: "Post Hive inválido." };

  const permlink = `re-${parentPermlink}-${Date.now().toString(36)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 255);

  try {
    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);
    const op = [
      "comment",
      {
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        author: account,
        permlink,
        title: "",
        body,
        json_metadata: JSON.stringify({ app: `Marketing Portal ${project.name}`, tags: [project.hive.community ?? "hive"] }),
      },
    ] as const;
    await client.broadcast.sendOperations([op as never], PrivateKey.fromString(key));
    return { ok: true, url: `https://peakd.com/@${account}/${permlink}`, ref: `${account}/${permlink}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao comentar no Hive." };
  }
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
