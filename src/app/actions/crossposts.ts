"use server";

// Instagram cross-post curation: read the queue, fix the caption, approve (with
// an optional publish time) or reject. Everything runs as a server action —
// approving only enqueues, so nothing here blocks on Meta.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { crossPostPublisherHealth } from "@/lib/scheduler-lease";
import { normalizeMediaUrl } from "@/lib/social-publish";
import {
  claimForPortalPublish,
  crossPostConfig,
  getQueueItem,
  listQueue,
  notifyQueueScheduled,
  rejectQueueItem,
  releaseClaim,
  updateQueuePayload,
  type ListQueueOptions,
} from "@/lib/crosspost-queue";
import {
  IG_CAPTION_MAX,
  IG_MAX_COLLABORATORS,
  type CrossPostItem,
  type InstagramPayload,
} from "@/lib/crosspost-shared";

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project, who };
}

export type CrossPostSetup = {
  ready: boolean;
  missing: string[];
  /**
   * Whether the host that actually publishes can write results back. This is a
   * DIFFERENT process from the one rendering this page, with its own env — and
   * getting it wrong is invisible until a post is live and its author never
   * hears about it, so the curator sees it before approving anything.
   */
  publisher: "ready" | "unconfigured" | "unknown";
};

export async function getCrossPostSetup(): Promise<CrossPostSetup> {
  const g = await gate();
  if (!g.ok) return { ready: false, missing: [], publisher: "unknown" };
  const cfg = crossPostConfig();
  const publisher = cfg.db
    ? await crossPostPublisherHealth().catch(() => "unknown" as const)
    : ("unknown" as const);
  return { ready: cfg.db, missing: cfg.missing, publisher };
}

export async function listCrossPostQueue(
  opts: ListQueueOptions = {},
): Promise<
  | { ok: true; items: CrossPostItem[]; total: number; curator: string }
  | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await listQueue(opts);
  if (!res.ok) return res;
  return { ok: true, items: res.items, total: res.total, curator: g.who.username };
}

export async function refreshCrossPostItem(
  id: string,
): Promise<{ ok: true; item: CrossPostItem | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  return getQueueItem(id);
}

/** Server-side mirror of Instagram's limits — never trust the client's counter. */
function validate(p: InstagramPayload): string | null {
  if (typeof p.caption !== "string") return "Legenda inválida.";
  if (p.caption.length > IG_CAPTION_MAX) {
    return `Legenda passa de ${IG_CAPTION_MAX} caracteres.`;
  }
  if (!Array.isArray(p.collaborators)) return "Colaboradores inválidos.";
  if (p.collaborators.length > IG_MAX_COLLABORATORS) {
    return `No máximo ${IG_MAX_COLLABORATORS} colaboradores.`;
  }
  return null;
}

/** Trim, drop a leading @, de-dupe, and cap at Instagram's 3 collaborators. */
function cleanCollaborators(list: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of list) {
    const c = raw.trim().replace(/^@/, "");
    if (c) seen.add(c);
  }
  return [...seen].slice(0, IG_MAX_COLLABORATORS);
}

/**
 * Persist curator edits to the caption and collaborators. We re-read the row
 * first so what we write is the STORED payload plus the edited fields — never a
 * client-supplied object, which could otherwise smuggle in new media URLs or a
 * different author.
 */
export async function saveCrossPostPayload(
  id: string,
  edits: { caption?: string; collaborators?: string[] },
): Promise<{ ok: true; item: CrossPostItem } | { ok: false; error: string; stale?: boolean }> {
  const g = await gate();
  if (!g.ok) return g;

  const current = await getQueueItem(id);
  if (!current.ok) return current;
  if (!current.item) return { ok: false, error: "Item não encontrado." };
  if (current.item.status !== "pending_review") {
    return {
      ok: false,
      stale: true,
      error: "Esse item já saiu da revisão — recarregue a lista.",
    };
  }

  const base = current.item.payload;
  const next: InstagramPayload = {
    ...base,
    caption: edits.caption ?? base.caption,
    collaborators: cleanCollaborators(edits.collaborators ?? base.collaborators ?? []),
  };

  const invalid = validate(next);
  if (invalid) return { ok: false, error: invalid };

  const saved = await updateQueuePayload(id, next);
  if (!saved.ok) return saved;
  return { ok: true, item: { ...current.item, payload: next } };
}

/**
 * Approve an INSTAGRAM cross-post — published by the portal, not the app.
 *
 * Two steps, in this order on purpose: claim the queue row first (atomic, so
 * only one curator can win), then create the InstagramPost. If the second step
 * fails we hand the claim back, because a claimed row nobody is publishing is
 * an item silently stuck in limbo.
 *
 * Returns as soon as it's queued. The Mac worker's scheduler tick does the slow
 * part — transcoding to an IG-safe MP4 and talking to Meta — with retry and
 * backoff, and writes the result back to the app's queue when it lands.
 *
 * `scheduledForISO` picks the moment it goes out; omitted means now. Either way
 * the row sits at `approved` in the app's queue until it actually publishes,
 * which keeps it inside the partial unique index — so an author can't re-request
 * a snap that's already booked for next Friday.
 */
export async function approveInstagramCrossPost(
  id: string,
  edits: { caption?: string; collaborators?: string[] },
  scheduledForISO?: string,
): Promise<{ ok: true; scheduledFor: string } | { ok: false; error: string; stale?: boolean }> {
  const g = await gate();
  if (!g.ok) return g;

  // Validate the time BEFORE claiming: a rejected date shouldn't cost the item
  // its place in the review queue.
  let when = new Date();
  if (scheduledForISO) {
    when = new Date(scheduledForISO);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Data inválida." };
    if (when.getTime() < Date.now() - 60_000) {
      return { ok: false, error: "Não dá pra agendar no passado." };
    }
  }

  const claim = await claimForPortalPublish(id, g.who.username);
  if (!claim.ok) return claim;

  const item = claim.item;
  // `id` comes from the client. The claim query already filters on
  // target='instagram', so this is belt-and-braces — but it's cheap, and it
  // fails loudly rather than trying to build an Instagram post out of a
  // Farcaster payload (which carries `text`, not `caption`, and no media).
  if (item.target !== "instagram") {
    await releaseClaim(id);
    return { ok: false, error: "Esse pedido não é de Instagram." };
  }

  const payload = item.payload;
  const caption = edits.caption ?? payload.caption ?? "";
  const collaborators = cleanCollaborators(edits.collaborators ?? payload.collaborators ?? []);

  const invalid = validate({ ...payload, caption, collaborators });
  if (invalid) {
    await releaseClaim(id);
    return { ok: false, error: invalid };
  }

  // Media order matters for a carousel, so keep the payload's own ordering.
  const mediaUrls = (
    payload.media_items?.length
      ? payload.media_items.map((m) => m.url)
      : [payload.video_url, payload.image_url].filter((u): u is string => !!u)
  ).map(normalizeMediaUrl);

  if (mediaUrls.length === 0) {
    await releaseClaim(id);
    return { ok: false, error: "Esse pedido não tem mídia publicável." };
  }

  try {
    await prisma.instagramPost.create({
      data: {
        projectSlug: g.project.slug,
        type: payload.ig_media_type,
        title: `cross-post @${item.hiveAuthor || item.requestedByHandle}`,
        caption,
        mediaUrls,
        collaborators,
        scheduledFor: when,
        status: "scheduled",
        publishMode: "auto",
        createdBy: g.who.username,
        crossPostQueueId: id,
      },
    });
  } catch (err) {
    await releaseClaim(id);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Only after the post is safely queued: an author told "approved for Friday"
  // about something that never got enqueued is worse than no notice at all.
  // No-ops for "publish now" — the published notice is moments away and carries
  // the actual link.
  await notifyQueueScheduled(item, when.toISOString());

  // Scheduled posts show up on the Calendar tab automatically — listUnifiedCalendar
  // reads every InstagramPost with status="scheduled", so rescheduling and
  // cancelling already work there without a second surface here.
  revalidatePath("/marketing-suggestions");
  return { ok: true, scheduledFor: when.toISOString() };
}

/**
 * Recusar. O motivo é opcional: exigir justificativa só travava a curadoria, e
 * o autor é avisado da recusa com ou sem texto.
 */
export async function rejectCrossPost(
  id: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
  const g = await gate();
  if (!g.ok) return g;
  return rejectQueueItem(id, { curatorHandle: g.who.username, note: (note ?? "").trim() });
}
