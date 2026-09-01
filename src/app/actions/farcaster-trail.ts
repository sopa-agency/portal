"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject, PROJECT_REGISTRY } from "@/projects/index";
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
  /** The SAME cast as seen by the other accounts on the trail. Carried here so
   *  one person can draft and approve every account's reply from whichever
   *  portal they happen to be in, instead of logging into each one to do it
   *  one at a time. `canAct` is false when this session is not authorized on
   *  that account's portal — the row still shows, but read-only. */
  others: TrailSibling[];
};

export type TrailSibling = {
  actionId: string;
  actorSlug: string;
  actorName: string;
  status: string;
  draft: string | null;
  canAct: boolean;
  /** Why not, when canAct is false. "no_portal" = the trail account has no
   *  portal of its own (member accounts like xvlad, or a retired brand), so
   *  there are no credentials to post with from here — a different problem
   *  from the allowlist one, and saying "sem permissão" for it would send
   *  someone hunting through allowlists for nothing. */
  reason: "ok" | "no_portal" | "not_allowed";
};

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

/**
 * Resolve the portal an action ACTS AS, and prove this session is allowed to
 * act as it.
 *
 * Credentials, voice and agent all come from the actor's project — never from
 * whichever portal the browser happens to be pointed at — so a reply drafted
 * for @skatehive sounds like SkateHive and posts with SkateHive's signer.
 *
 * Authorization is re-checked against that project rather than inherited from
 * the current one. Being on the Gnars allowlist must not, by itself, grant the
 * power to post as SkateHive; someone allowed on both (or global) passes, and
 * that is exactly the person this cross-account view is for.
 */
async function actorFor(actorSlug: string) {
  // MUST be an exact registry hit. getProject() falls back to the default
  // project for an unknown slug, and the trail carries member accounts whose
  // slug is not a portal at all (xvlad, r4topunk) — resolving those through the
  // fallback would draft in the wrong brand's voice and, far worse, post with
  // the wrong brand's credentials. An unknown actor is simply not actionable
  // here.
  const project = PROJECT_REGISTRY[actorSlug];
  if (!project) return null;
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  return who ? { project, who } : null;
}

function fcCastUrl(authorSlug: string, hash: string): string {
  return `https://warpcast.com/${authorSlug}/${hash.slice(0, 10)}`;
}

/**
 * Sob quais LABELS este portal age no trail.
 *
 * A ação é gravada com o `label` da conta (`xvlad`, `bobgnarley`), e o portal
 * se identifica pelo `slug` (`vlad`, `gnars`). Para as contas de marca os dois
 * coincidem por acidente feliz — skatehive é label e é slug — e o código
 * comparava um com o outro direto.
 *
 * Para conta de pessoa isso quebra em silêncio, e quebrou: o portal `vlad`
 * procurava por `actorSlug = "vlad"`, a conta dele se chama `xvlad`, e a página
 * de engagement mostrava vazio com 120 ações no banco. Vazio que não é vazio é
 * a pior resposta que uma tela pode dar.
 *
 * O vínculo verdadeiro é o `ownerSlug` do TrailAccount. É ele que responde
 * "quem é dono desta conta", e é dele que esta função tira a resposta.
 *
 * Devolve o próprio slug como fallback: um portal cuja conta tem label igual ao
 * slug continua funcionando mesmo se a linha do TrailAccount sumir.
 */
async function trailLabelsFor(slug: string): Promise<string[]> {
  const rows = await prisma.trailAccount
    .findMany({ where: { ownerSlug: slug, enabled: true }, select: { label: true } })
    .catch(() => [] as { label: string }[]);
  const labels = rows.map((r) => r.label);
  return labels.length ? labels : [slug];
}

/** Partner casts this portal should reply to (pending/failed first, then done). */
export async function listTrailFeed(): Promise<
  { ok: true; items: TrailItem[]; project: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const slug = g.project.slug;
  // Os labels sob os quais ESTE portal age — ver trailLabelsFor.
  const meus = await trailLabelsFor(slug);

  const replies = await prisma.farcasterTrailAction
    .findMany({
      where: { actorSlug: { in: meus }, kind: "reply", status: { in: ["pending", "failed", "done"] } },
      include: { cast: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    })
    .catch(() => []);

  // Did this portal auto-like each cast? (sibling like action)
  const likeRows = await prisma.farcasterTrailAction
    .findMany({ where: { actorSlug: { in: meus }, kind: "like", castHash: { in: replies.map((r) => r.castHash) } } })
    .catch(() => []);
  const likedByCast = new Map(likeRows.map((l) => [l.castHash, l.status === "done"]));

  // The same casts as seen by every OTHER account on the trail. One query for
  // all of them, then grouped — not one query per card.
  const siblingRows = await prisma.farcasterTrailAction
    .findMany({
      where: { castHash: { in: replies.map((r) => r.castHash) }, kind: "reply", actorSlug: { notIn: meus } },
      orderBy: { actorSlug: "asc" },
    })
    .catch(() => []);

  // Authorize ONCE per distinct account, not once per row.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const actorSlugs = [...new Set(siblingRows.map((r) => r.actorSlug))];
  const reasonBySlug = new Map<string, TrailSibling["reason"]>();
  await Promise.all(
    actorSlugs.map(async (a) => {
      const target = PROJECT_REGISTRY[a];
      if (!target) { reasonBySlug.set(a, "no_portal"); return; } // see actorFor
      const who = await authorize(token, target).catch(() => null);
      reasonBySlug.set(a, who ? "ok" : "not_allowed");
    }),
  );

  const siblingsByCast = new Map<string, TrailSibling[]>();
  for (const r of siblingRows) {
    const list = siblingsByCast.get(r.castHash) ?? [];
    list.push({
      actionId: r.id,
      actorSlug: r.actorSlug,
      actorName: PROJECT_REGISTRY[r.actorSlug]?.name ?? r.actorSlug,
      status: r.status,
      draft: r.draft,
      canAct: (reasonBySlug.get(r.actorSlug) ?? "not_allowed") === "ok",
      reason: reasonBySlug.get(r.actorSlug) ?? "not_allowed",
    });
    siblingsByCast.set(r.castHash, list);
  }

  const items: TrailItem[] = replies.map((r) => ({
    actionId: r.id,
    status: r.status,
    draft: r.draft,
    liked: likedByCast.get(r.castHash) ?? false,
    others: siblingsByCast.get(r.castHash) ?? [],
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
  if (!action || action.kind !== "reply") return { ok: false, error: "Ação não encontrada." };

  const actor = await actorFor(action.actorSlug);
  if (!actor) return { ok: false, error: `Sem permissão para agir como ${action.actorSlug}.` };

  return draftForAction(action, actor.project, instruction, current);
}

/** The actual drafting, shared by the one-account and all-accounts paths. */
async function draftForAction(
  action: { id: string; cast: { authorHandle: string | null; authorSlug: string; text: string; platform: string } },
  project: ProjectConfig,
  instruction?: string,
  current?: string,
): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  let draft: string;
  try {
    const raw = await callOpenClaw(
      replyPrompt(project, action.cast.authorHandle ?? action.cast.authorSlug, action.cast.text, instruction, current, action.cast.platform),
      project.agent.id,
      { timeoutMs: AI_TIMEOUT_MS, project },
    );
    draft = raw.trim().replace(/^["']|["']$/g, "").slice(0, 280);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na IA." };
  }

  await prisma.farcasterTrailAction.update({ where: { id: action.id }, data: { draft } }).catch(() => {});
  return { ok: true, draft };
}

/**
 * Draft a reply for EVERY account that still owes one on this cast, in one go.
 *
 * The point of the button: without it you log into each brand portal to press
 * "generate" once per account, which is the same work multiplied by however
 * many accounts are on the trail.
 *
 * Each account drafts in ITS OWN voice through ITS OWN agent — this is not one
 * text copied across accounts, which would read as a bot the moment two of
 * them landed under the same post. Accounts this session cannot act as are
 * reported as skipped rather than silently dropped, and one account's failure
 * never takes the others down.
 */
export async function generateTrailReplyAll(
  castHash: string,
  instruction?: string,
): Promise<
  | { ok: true; results: { actorSlug: string; actorName: string; ok: boolean; draft?: string; error?: string }[] }
  | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;

  const actions = await prisma.farcasterTrailAction
    .findMany({ where: { castHash, kind: "reply", status: { in: ["pending", "failed"] } }, include: { cast: true } })
    .catch(() => []);
  if (!actions.length) return { ok: false, error: "Nenhuma conta pendente neste post." };

  const results = await Promise.all(
    actions.map(async (action) => {
      const name = PROJECT_REGISTRY[action.actorSlug]?.name ?? action.actorSlug;
      const actor = await actorFor(action.actorSlug);
      if (!actor) return { actorSlug: action.actorSlug, actorName: name, ok: false, error: "sem permissão" };
      const r = await draftForAction(action, actor.project, instruction, action.draft ?? undefined);
      return r.ok
        ? { actorSlug: action.actorSlug, actorName: name, ok: true, draft: r.draft }
        : { actorSlug: action.actorSlug, actorName: name, ok: false, error: r.error };
    }),
  );
  return { ok: true, results };
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
  if (!action || action.kind !== "reply") return { ok: false, error: "Ação não encontrada." };

  // Post with the ACTOR's credentials and identity, whichever portal the
  // browser is on — and only after that account's own allowlist says yes.
  const actor = await actorFor(action.actorSlug);
  if (!actor) return { ok: false, error: `Sem permissão para postar como ${action.actorSlug}.` };

  const result =
    action.cast.platform === "hive"
      ? await postHiveComment(actor.project, action.cast.hash, body)
      : await postFarcasterReply(actor.project, action.cast.hash, body);

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
  const account = brandEnv(project, "HIVE_POSTING_ACCOUNT") ?? project?.hive.account;
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
