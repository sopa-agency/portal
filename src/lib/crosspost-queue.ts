// Instagram cross-post curation queue — data layer.
//
// The queue lives in the SkateHive app's Supabase (`userbase_crosspost_queue`),
// NOT in the portal's own Prisma DB. Four rules shape this file:
//
//  1. We reach it over PostgREST with the userbase service-role key the portal
//     already holds. That key is broad — it bypasses RLS on every userbase
//     table, including users' encrypted posting keys — so nothing here reads
//     anything but the queue, and nothing writes anything but the queue and the
//     notifications table.
//
//  2. PostgREST has no multi-statement transactions, so "flip the row AND tell
//     the author" can't be atomic. Exactly-once delivery is rebuilt from the
//     portal's own DB instead — see crosspost-notices.ts. Every write here
//     follows the same order: claim the notice, change the row, send, confirm.
//
//  3. Instagram publishes through the PORTAL's pipeline (ffmpeg transcode to an
//     IG-safe MP4, the Mac worker's residential IP, retry with backoff), not
//     through the app. We claim a row, hand it to our scheduler, and write the
//     result back when it lands.
//
//  4. We never write status='publishing'. That value belongs to the app's own
//     compare-and-swap; our claim is pending_review → approved, which is just as
//     atomic and keeps the row inside the partial unique index.
//
// The table also carries Farcaster rows. We never touch them: those publish on
// the requesting user's OWN account, with a signer that lives in the app. Every
// query below asserts target='instagram' — the row id comes from the client.
import "server-only";
import { getUserbaseClient } from "@/lib/supabase-userbase";
import {
  claimNotice,
  confirmNotice,
  failNotice,
  type NoticeKind,
  type NoticePayload,
} from "@/lib/crosspost-notices";
import type {
  CrossPostItem,
  CrossPostStatus,
  InstagramPayload,
} from "@/lib/crosspost-shared";

const QUEUE = "userbase_crosspost_queue";
const NOTIFICATIONS = "userbase_notifications";

const COLUMNS =
  "id,user_id,requested_by_handle,target,hive_author,hive_permlink,status,payload," +
  "reviewed_by_handle,reviewed_at,review_note,attempts,published_at,publish_error," +
  "result,created_at,updated_at";

export function crossPostConfig(): { db: boolean; missing: string[] } {
  const ok = !!getUserbaseClient();
  return {
    db: ok,
    missing: ok ? [] : ["SUPABASE_USERBASE_URL", "SUPABASE_USERBASE_SERVICE_ROLE_KEY"],
  };
}

/**
 * Turn PostgREST's own wording into something a curator can act on.
 *
 * PGRST205 is the one that matters: the queue table doesn't exist in the
 * Supabase this portal points at. That's the expected state until the app ships
 * its migration, and "Could not find the table in the schema cache" tells a
 * social-media curator nothing about what to do.
 */
function friendlyError(err: { code?: string; message: string }): string {
  if (err.code === "PGRST205" || /Could not find the table/i.test(err.message)) {
    return "A fila ainda não existe neste banco. O app da SkateHive precisa criar a tabela userbase_crosspost_queue antes que a curadoria funcione.";
  }
  return err.message;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type QueueRow = {
  id: string;
  user_id: string | null;
  requested_by_handle: string | null;
  target: string;
  hive_author: string | null;
  hive_permlink: string;
  status: string;
  payload: unknown;
  reviewed_by_handle: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  attempts: number | null;
  published_at: string | null;
  publish_error: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
};

function toItem(r: QueueRow): CrossPostItem {
  return {
    id: r.id,
    userId: r.user_id,
    requestedByHandle: r.requested_by_handle ?? "",
    // Read the real value. Hardcoding "instagram" here once made every
    // downstream target check tautologically true and silently disarmed a guard.
    target: r.target === "farcaster" ? "farcaster" : "instagram",
    hiveAuthor: r.hive_author,
    hivePermlink: r.hive_permlink,
    status: r.status as CrossPostStatus,
    payload: (r.payload ?? {}) as InstagramPayload,
    reviewedByHandle: r.reviewed_by_handle,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    attempts: r.attempts ?? 0,
    publishedAt: r.published_at,
    publishError: r.publish_error,
    result: (r.result ?? null) as CrossPostItem["result"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type ListQueueOptions = {
  /** Defaults to the review backlog. */
  statuses?: CrossPostStatus[];
  author?: string;
  limit?: number;
};

export async function listQueue(
  opts: ListQueueOptions = {},
): Promise<
  { ok: true; items: CrossPostItem[]; total: number } | { ok: false; error: string }
> {
  const sb = getUserbaseClient();
  if (!sb) return { ok: false, error: "Supabase do userbase não configurado." };

  const statuses = opts.statuses ?? ["pending_review"];
  // The backlog is a queue — oldest first, so nobody's request rots at the
  // bottom. History is a feed: newest first, or a curator opening "decided"
  // after a few hundred decisions would be shown the oldest ones ever made.
  const reviewing = statuses.length === 1 && statuses[0] === "pending_review";

  let q = sb
    .from(QUEUE)
    .select(COLUMNS, { count: "exact" })
    .eq("target", "instagram")
    .in("status", statuses)
    .order("created_at", { ascending: reviewing })
    .limit(Math.min(opts.limit ?? 100, 300));

  if (opts.author) {
    const a = opts.author.toLowerCase();
    q = q.or(`hive_author.ilike.${a},requested_by_handle.ilike.${a}`);
  }

  const { data, error, count } = await q;
  if (error) return { ok: false, error: friendlyError(error) };
  const items = ((data ?? []) as unknown as QueueRow[]).map(toItem);
  return { ok: true, items, total: count ?? items.length };
}

export async function getQueueItem(
  id: string,
): Promise<{ ok: true; item: CrossPostItem | null } | { ok: false; error: string }> {
  const sb = getUserbaseClient();
  if (!sb) return { ok: false, error: "Supabase do userbase não configurado." };
  const { data, error } = await sb
    .from(QUEUE)
    .select(COLUMNS)
    .eq("id", id)
    .eq("target", "instagram")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, item: data ? toItem(data as unknown as QueueRow) : null };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Send one notification at most once, ever.
 *
 * The claim happens in the portal's DB (transactional) BEFORE the remote insert,
 * so two racing callers can't both send. On failure the claim is left
 * unconfirmed and the scheduler's reconcile pass retries it — the author hears
 * late rather than never.
 */
async function sendNotice(
  queueId: string,
  kind: NoticeKind,
  payload: NoticePayload,
): Promise<void> {
  if (!(await claimNotice(queueId, kind, payload))) return;
  await deliverNotice(queueId, kind, payload);
}

/** The delivery half on its own, so the reconcile pass can retry a stale claim. */
export async function deliverNotice(
  queueId: string,
  kind: NoticeKind,
  payload: NoticePayload,
): Promise<void> {
  const sb = getUserbaseClient();
  if (!sb) {
    await failNotice(queueId, kind, "Supabase do userbase não configurado.");
    return;
  }
  const { error } = await sb.from(NOTIFICATIONS).insert({
    user_id: payload.userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    link: payload.link,
    metadata: payload.metadata,
  });
  if (error) await failNotice(queueId, kind, error.message);
  else await confirmNotice(queueId, kind);
}

/** Shared metadata every cross-post notice carries, for the app's translations. */
function baseMetadata(item: { id: string; hivePermlink: string }) {
  return { queue_id: item.id, target: "instagram", hive_permlink: item.hivePermlink };
}

// ---------------------------------------------------------------------------
// Writes — each guarded on the status it expects, so a stale click can't land
// ---------------------------------------------------------------------------

/**
 * Save curator edits to the caption and collaborators. Guarded on
 * `pending_review` so an edit can't land on a row another curator already
 * claimed and queued for publishing.
 */
export async function updateQueuePayload(
  id: string,
  payload: InstagramPayload,
): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
  const sb = getUserbaseClient();
  if (!sb) return { ok: false, error: "Supabase do userbase não configurado." };
  const { data, error } = await sb
    .from(QUEUE)
    .update({ payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("target", "instagram")
    .eq("status", "pending_review")
    .select("id");
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data?.length) {
    return { ok: false, stale: true, error: "Esse item saiu da fila de revisão — recarregue a lista." };
  }
  return { ok: true };
}

export async function rejectQueueItem(
  id: string,
  opts: { curatorHandle: string; note: string },
): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
  const sb = getUserbaseClient();
  if (!sb) return { ok: false, error: "Supabase do userbase não configurado." };

  const { data, error } = await sb
    .from(QUEUE)
    .update({
      status: "rejected",
      reviewed_by_handle: opts.curatorHandle,
      reviewed_at: new Date().toISOString(),
      review_note: opts.note || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("target", "instagram")
    .eq("status", "pending_review")
    .select("id,user_id,hive_permlink");

  if (error) return { ok: false, error: friendlyError(error) };
  const row = data?.[0] as { id: string; user_id: string | null; hive_permlink: string } | undefined;
  if (!row) {
    return { ok: false, stale: true, error: "Esse item já foi decidido por outra pessoa — recarregue a lista." };
  }

  if (row.user_id) {
    // The app translates from `type` + `metadata`; the English strings are only
    // a fallback, and `note` is shown to the author in whatever language the
    // curator wrote it.
    await sendNotice(id, "rejected", {
      userId: row.user_id,
      type: "crosspost_rejected",
      title: "Your Instagram cross-post wasn't picked up",
      body: "The curation team passed on this one.",
      link: null,
      metadata: { ...baseMetadata({ id, hivePermlink: row.hive_permlink }), note: opts.note || null },
    });
  }
  return { ok: true };
}

/**
 * Atomically take an item off the review queue. Only the caller that wins the
 * race gets the row; everyone else gets `stale` and reloads.
 *
 * PostgREST turns this into a single guarded UPDATE ... RETURNING, so the
 * compare-and-swap holds even without an explicit transaction.
 */
export async function claimForPortalPublish(
  id: string,
  curatorHandle: string,
): Promise<{ ok: true; item: CrossPostItem } | { ok: false; error: string; stale?: boolean }> {
  const sb = getUserbaseClient();
  if (!sb) return { ok: false, error: "Supabase do userbase não configurado." };
  const { data, error } = await sb
    .from(QUEUE)
    .update({
      status: "approved",
      reviewed_by_handle: curatorHandle,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("target", "instagram")
    .eq("status", "pending_review")
    .select(COLUMNS);
  if (error) return { ok: false, error: friendlyError(error) };
  const row = (data ?? [])[0] as unknown as QueueRow | undefined;
  if (!row) return { ok: false, stale: true, error: "Outro curador chegou antes — recarregue a lista." };
  return { ok: true, item: toItem(row) };
}

/** Hand the claim back if we couldn't queue the post after taking it. */
export async function releaseClaim(id: string): Promise<void> {
  const sb = getUserbaseClient();
  if (!sb) return;
  await sb
    .from(QUEUE)
    .update({
      status: "pending_review",
      reviewed_by_handle: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("target", "instagram")
    .eq("status", "approved");
}

/**
 * Tell the author their post was approved for a future slot.
 *
 * Only worth sending when they'd otherwise sit in silence: a "publish now" lands
 * within a tick or two and the published notice arrives with a real link, so
 * announcing the approval first would be two notifications minutes apart for one
 * action — which is how people learn to mute you.
 */
const SCHEDULE_NOTICE_HORIZON_MS = 15 * 60_000;

export async function notifyQueueScheduled(item: CrossPostItem, whenISO: string): Promise<void> {
  if (!item.userId) return;
  if (new Date(whenISO).getTime() - Date.now() < SCHEDULE_NOTICE_HORIZON_MS) return;
  await sendNotice(item.id, "scheduled", {
    userId: item.userId,
    type: "crosspost_scheduled",
    title: "Your Instagram cross-post was approved",
    body: "The curation team picked your post — it goes out at the scheduled time.",
    link: null,
    // scheduled_for so the app renders the date in the user's own timezone and
    // locale rather than trusting the English fallback.
    metadata: { ...baseMetadata(item), scheduled_for: whenISO },
  });
}

// ---------------------------------------------------------------------------
// Write-back from the scheduler
//
// These run right after a post is already live, inside the scheduler's publish
// try/catch. They must NEVER throw: an exception would be caught up there,
// flip the post back to `scheduled`, and publish it to Instagram a second time.
// ---------------------------------------------------------------------------

function warnWriteBack(id: string, reason: string): void {
  console.error(
    `[crosspost] o publish terminou mas NÃO consegui atualizar a fila (id=${id}): ${reason}. ` +
      `A linha ficou presa em 'approved' — confira no Instagram se o post saiu e ajuste à mão.`,
  );
}

export async function markQueuePublished(
  id: string,
  result: { igMediaId: string; permalink?: string | null },
): Promise<void> {
  try {
    const sb = getUserbaseClient();
    if (!sb) return warnWriteBack(id, "Supabase do userbase não configurado neste host");

    const { data, error } = await sb
      .from(QUEUE)
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        publish_error: null,
        result: { ig_media_id: result.igMediaId, ig_permalink: result.permalink ?? null },
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("target", "instagram")
      .eq("status", "approved")
      .select("id,user_id,hive_permlink");

    if (error) return warnWriteBack(id, error.message);
    const row = data?.[0] as { user_id: string | null; hive_permlink: string } | undefined;
    if (!row?.user_id) return;

    // Notify on PUBLISHED, not on approved: the publish can still fail minutes
    // after approval, and "your post is live" followed by nothing being live is
    // worse than a slightly later notice. It's also the first moment we have a
    // permalink to hand them.
    await sendNotice(id, "published", {
      userId: row.user_id,
      type: "crosspost_published",
      title: "Your Instagram cross-post is live",
      body: "The curation team picked your post.",
      link: result.permalink ?? null,
      metadata: {
        ...baseMetadata({ id, hivePermlink: row.hive_permlink }),
        ig_permalink: result.permalink ?? null,
      },
    });
  } catch (err) {
    warnWriteBack(id, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Called when the scheduler gave up for good. Left as `failed` so the app's
 * partial unique index frees the slot and the author can ask again — which is
 * exactly what the notification tells them.
 */
export async function markQueueFailed(id: string, error: string): Promise<void> {
  try {
    const sb = getUserbaseClient();
    if (!sb) return warnWriteBack(id, "Supabase do userbase não configurado neste host");

    const { data, error: err } = await sb
      .from(QUEUE)
      .update({
        status: "failed",
        publish_error: error.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("target", "instagram")
      .eq("status", "approved")
      .select("id,user_id,hive_permlink");

    if (err) return warnWriteBack(id, err.message);
    const row = data?.[0] as { user_id: string | null; hive_permlink: string } | undefined;
    if (!row?.user_id) return;

    await sendNotice(id, "failed", {
      userId: row.user_id,
      type: "crosspost_failed",
      title: "Your Instagram cross-post didn't go through",
      body: "Something went wrong on our side — you can request it again.",
      link: null,
      metadata: baseMetadata({ id, hivePermlink: row.hive_permlink }),
    });
  } catch (e) {
    warnWriteBack(id, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Queue rows sitting in `approved` for a while — candidates for reconciliation.
 *
 * `approved` is meant to be a short hop: claimed, enqueued, published. A row
 * that lingers means something broke the chain — a write-back that failed, or an
 * InstagramPost someone deleted from Post Creator. Left alone it holds the
 * partial unique index slot forever, so the author can never re-request that
 * snap. Legitimately-scheduled posts also sit here, which is why the caller
 * checks the portal-side post state before touching anything.
 */
export async function listApprovedQueueIds(olderThanMs: number): Promise<string[]> {
  try {
    const sb = getUserbaseClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from(QUEUE)
      .select("id")
      .eq("target", "instagram")
      .eq("status", "approved")
      .lt("updated_at", new Date(Date.now() - olderThanMs).toISOString())
      .limit(200);
    if (error) return [];
    return (data ?? []).map((r) => (r as { id: string }).id);
  } catch {
    return [];
  }
}
