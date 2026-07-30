// Exactly-once notifications for cross-post curation.
//
// The queue and the notifications live in the SkateHive app's Supabase, which
// the portal reaches over PostgREST — and PostgREST has no multi-statement
// transactions. So "flip the row AND tell the author" cannot be atomic there.
// Left alone, the two halves split in both directions: a rejection the author
// never hears about, or an author told twice because a second curator saw the
// item still sitting in review.
//
// The guarantee is rebuilt here instead, in the portal's own Postgres where
// transactions do exist. The unique constraint on (queueId, kind) IS the
// mechanism: CLAIMING a notice is what grants the right to send it. A retry
// can't claim what's already claimed, so it can't send a second time. Notices
// left unconfirmed are picked up by the scheduler's reconcile pass, which is
// what turns "might be lost" into "arrives late at worst".
import "server-only";
import { prisma } from "@/lib/prisma";

export type NoticeKind = "rejected" | "scheduled" | "published" | "failed";

export type NoticePayload = {
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Take the exclusive right to send one notice.
 *
 * Returns false when someone already holds it — either it was sent, or another
 * attempt is in flight. Either way the caller must not send.
 */
export async function claimNotice(
  queueId: string,
  kind: NoticeKind,
  payload: NoticePayload,
): Promise<boolean> {
  try {
    await prisma.crossPostNotice.create({
      data: { queueId, kind, payload: payload as unknown as object },
    });
    return true;
  } catch {
    // Unique violation — already claimed. Anything else (DB down) is equally a
    // reason not to send: without a durable claim we can't promise exactly-once.
    return false;
  }
}

/** The app accepted the notification. Never send this one again. */
export async function confirmNotice(queueId: string, kind: NoticeKind): Promise<void> {
  await prisma.crossPostNotice
    .updateMany({
      where: { queueId, kind, sentAt: null },
      data: { sentAt: new Date(), lastError: null },
    })
    .catch(() => {});
}

/** The send failed. Leave it unconfirmed so the reconcile pass retries it. */
export async function failNotice(
  queueId: string,
  kind: NoticeKind,
  error: string,
): Promise<void> {
  await prisma.crossPostNotice
    .updateMany({
      where: { queueId, kind, sentAt: null },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 500) },
    })
    .catch(() => {});
}

// Give up after this many tries so a permanently-bad payload (a deleted user,
// say) doesn't get retried every ten minutes forever.
const MAX_NOTICE_ATTEMPTS = 8;

/** Notices claimed but never confirmed — owed to their authors. */
export async function pendingNotices(olderThanMs = 5 * 60_000) {
  return prisma.crossPostNotice.findMany({
    where: {
      sentAt: null,
      attempts: { lt: MAX_NOTICE_ATTEMPTS },
      createdAt: { lt: new Date(Date.now() - olderThanMs) },
    },
    orderBy: { createdAt: "asc" },
    take: 25,
  });
}
