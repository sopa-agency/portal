"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { createPinataSignedUploadUrl, normalizeMediaUrl } from "@/lib/social-publish";
import {
  fetchCreatorInfo,
  publishTikTokVideo,
  fetchPublishStatus,
  getTikTokConnection,
  tiktokPostUrl,
  type CreatorInfo,
  type TikTokPrivacy,
} from "@/lib/tiktok";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TikTokStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type TikTokRow = {
  id: string;
  title: string;
  caption: string;
  videoUrl: string | null;
  coverTimeMs: number | null;
  privacy: TikTokPrivacy;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
  isAigc: boolean;
  status: TikTokStatus;
  reviewed: boolean;
  reviewedBy: string | null;
  scheduledFor: string | null;
  shareUrl: string | null;
  error: string | null;
  createdBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TikTokAccountInfo = {
  connected: boolean;
  username: string | null;
  audited: boolean;
  /** Live constraints from creator_info — null when the call failed/not connected. */
  creator: CreatorInfo | null;
  creatorError: string | null;
};

const PRIVACY_VALUES: TikTokPrivacy[] = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
];

const CAPTION_MAX = 2200;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authGate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) throw new Error("Unauthorized");
  if (!project.tiktok) throw new Error("TikTok is not enabled for this project.");
  return { project, username: session.username };
}

type Row = Awaited<ReturnType<typeof prisma.tikTokPost.findFirst>>;

function toPlain(row: NonNullable<Row>): TikTokRow {
  return {
    id: row.id,
    title: row.title ?? "",
    caption: row.caption,
    videoUrl: row.videoUrl,
    coverTimeMs: row.coverTimeMs,
    privacy: (PRIVACY_VALUES.includes(row.privacy as TikTokPrivacy)
      ? row.privacy
      : "SELF_ONLY") as TikTokPrivacy,
    disableComment: row.disableComment,
    disableDuet: row.disableDuet,
    disableStitch: row.disableStitch,
    brandContent: row.brandContent,
    brandOrganic: row.brandOrganic,
    isAigc: row.isAigc,
    status: row.status as TikTokStatus,
    reviewed: row.reviewed,
    reviewedBy: row.reviewedBy,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    shareUrl: row.shareUrl,
    error: row.error,
    createdBy: row.createdBy,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTikTokQueue(): Promise<
  { ok: true; rows: TikTokRow[] } | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();
    const rows = await prisma.tikTokPost.findMany({
      where: { projectSlug: project.slug },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200,
    });
    return { ok: true, rows: rows.map(toPlain) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Account + live creator constraints. TikTok's UX guidelines require the
 * publish screen to reflect the creator's CURRENT settings, so the composer
 * reads privacy options / duet / stitch from here instead of hardcoding them.
 */
export async function getTikTokAccount(): Promise<TikTokAccountInfo> {
  const { project } = await authGate();
  const conn = await getTikTokConnection(project);
  if (!conn || !conn.connected) {
    return { connected: false, username: null, audited: false, creator: null, creatorError: null };
  }
  const info = await fetchCreatorInfo(project);
  return {
    connected: true,
    username: conn.username ?? null,
    audited: conn.audited,
    creator: info.ok ? info.data : null,
    creatorError: info.ok ? null : info.error,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type SaveTikTokParams = {
  id?: string;
  title?: string;
  caption?: string;
  videoUrl?: string | null;
  coverTimeMs?: number | null;
  privacy?: TikTokPrivacy;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  brandContent?: boolean;
  brandOrganic?: boolean;
  isAigc?: boolean;
};

export async function saveTikTokDraft(
  params: SaveTikTokParams,
): Promise<{ ok: true; row: TikTokRow } | { ok: false; error: string }> {
  try {
    const { project, username } = await authGate();

    const caption = (params.caption ?? "").slice(0, CAPTION_MAX);
    const privacy =
      params.privacy && PRIVACY_VALUES.includes(params.privacy) ? params.privacy : undefined;

    const data = {
      title: params.title?.trim() || null,
      caption,
      videoUrl: params.videoUrl ? normalizeMediaUrl(params.videoUrl) : params.videoUrl ?? null,
      coverTimeMs: params.coverTimeMs ?? null,
      ...(privacy ? { privacy } : {}),
      disableComment: !!params.disableComment,
      disableDuet: !!params.disableDuet,
      disableStitch: !!params.disableStitch,
      brandContent: !!params.brandContent,
      brandOrganic: !!params.brandOrganic,
      isAigc: !!params.isAigc,
    };

    // Editing a draft invalidates a previous approval — otherwise someone could
    // approve a video and then swap the caption before it publishes.
    const row = params.id
      ? await prisma.tikTokPost.update({
          where: { id: params.id },
          data: { ...data, reviewed: false, reviewedBy: null, error: null },
        })
      : await prisma.tikTokPost.create({
          data: { ...data, projectSlug: project.slug, createdBy: username, status: "draft" },
        });

    revalidatePath("/tiktok");
    return { ok: true, row: toPlain(row) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The human gate — the scheduler ignores anything that isn't approved. */
export async function approveTikTokPost(
  id: string,
  approved: boolean,
): Promise<{ ok: true; row: TikTokRow } | { ok: false; error: string }> {
  try {
    const { project, username } = await authGate();
    const existing = await prisma.tikTokPost.findFirst({
      where: { id, projectSlug: project.slug },
    });
    if (!existing) return { ok: false, error: "Post not found." };
    if (approved && !existing.videoUrl) {
      return { ok: false, error: "Add the video before approving." };
    }
    if (existing.status === "published") {
      return { ok: false, error: "This post was already published." };
    }

    const row = await prisma.tikTokPost.update({
      where: { id },
      data: {
        reviewed: approved,
        reviewedBy: approved ? username : null,
        // Un-approving a scheduled post pulls it back out of the queue.
        ...(approved ? {} : { status: "draft", scheduledFor: null }),
      },
    });
    revalidatePath("/tiktok");
    return { ok: true, row: toPlain(row) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function scheduleTikTokPost(
  id: string,
  scheduledFor: string | null,
): Promise<{ ok: true; row: TikTokRow } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const existing = await prisma.tikTokPost.findFirst({
      where: { id, projectSlug: project.slug },
    });
    if (!existing) return { ok: false, error: "Post not found." };

    // Unschedule.
    if (!scheduledFor) {
      const row = await prisma.tikTokPost.update({
        where: { id },
        data: { status: "draft", scheduledFor: null },
      });
      revalidatePath("/tiktok");
      return { ok: true, row: toPlain(row) };
    }

    const when = new Date(scheduledFor);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date." };
    if (when.getTime() < Date.now() - 60_000) {
      return { ok: false, error: "Pick a time in the future." };
    }
    if (!existing.videoUrl) return { ok: false, error: "Add the video before scheduling." };
    if (!existing.reviewed) return { ok: false, error: "Approve the post before scheduling." };

    const row = await prisma.tikTokPost.update({
      where: { id },
      data: { status: "scheduled", scheduledFor: when, error: null, attempts: 0 },
    });
    revalidatePath("/tiktok");
    return { ok: true, row: toPlain(row) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteTikTokPost(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    await prisma.tikTokPost.deleteMany({ where: { id, projectSlug: project.slug } });
    revalidatePath("/tiktok");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Publish now — same path the scheduler takes, minus the wait.
// ---------------------------------------------------------------------------

export async function publishTikTokNow(
  id: string,
): Promise<{ ok: true; row: TikTokRow } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const post = await prisma.tikTokPost.findFirst({ where: { id, projectSlug: project.slug } });
    if (!post) return { ok: false, error: "Post not found." };
    if (!post.videoUrl) return { ok: false, error: "This post has no video." };
    if (!post.reviewed) return { ok: false, error: "Approve the post before publishing." };
    if (post.status === "published") return { ok: false, error: "Already published." };

    await prisma.tikTokPost.update({ where: { id }, data: { status: "publishing", error: null } });

    const result = await publishTikTokVideo(project, {
      caption: post.caption,
      videoUrl: post.videoUrl,
      privacy: post.privacy as TikTokPrivacy,
      disableComment: post.disableComment,
      disableDuet: post.disableDuet,
      disableStitch: post.disableStitch,
      brandContent: post.brandContent,
      brandOrganic: post.brandOrganic,
      isAigc: post.isAigc,
      coverTimeMs: post.coverTimeMs ?? undefined,
    });

    if (!result.ok) {
      await prisma.tikTokPost.update({
        where: { id },
        data: { status: "failed", error: result.error, attempts: { increment: 1 } },
      });
      revalidatePath("/tiktok");
      return { ok: false, error: result.error };
    }

    const row = await prisma.tikTokPost.update({
      where: { id },
      data: {
        status: "published",
        publishId: result.data.publishId,
        publishedAt: new Date(),
        scheduledFor: null,
        error: null,
        attempts: 0,
      },
    });
    revalidatePath("/tiktok");
    return { ok: true, row: toPlain(row) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ask TikTok how a submitted post is doing. Publishing is asynchronous — the
 * API returns a publish_id immediately and processes the video afterwards, so
 * the share URL only exists once TikTok reports PUBLISH_COMPLETE.
 */
export async function refreshTikTokStatus(
  id: string,
): Promise<{ ok: true; row: TikTokRow; state: string } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const post = await prisma.tikTokPost.findFirst({ where: { id, projectSlug: project.slug } });
    if (!post?.publishId) return { ok: false, error: "This post was never submitted to TikTok." };

    const res = await fetchPublishStatus(project, post.publishId);
    if (!res.ok) return { ok: false, error: res.error };

    const conn = await getTikTokConnection(project);
    const postId = res.data.publicaly_available_post_id?.[0];
    const shareUrl = tiktokPostUrl(conn?.username, postId);

    const row = await prisma.tikTokPost.update({
      where: { id },
      data: {
        ...(shareUrl ? { shareUrl } : {}),
        ...(res.data.status === "FAILED"
          ? { status: "failed", error: res.data.fail_reason ?? "TikTok reported FAILED" }
          : {}),
      },
    });
    revalidatePath("/tiktok");
    return { ok: true, row: toPlain(row), state: res.data.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Media upload — same signed-URL flow the Post Creator uses (browser → Pinata).
// ---------------------------------------------------------------------------

export async function createTikTokUploadUrl(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    await authGate();
    if (!mimeType.startsWith("video/")) {
      return { ok: false, error: "TikTok posts need a video file." };
    }
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Drops the stored connection so the brand can re-authorize from scratch. */
export async function disconnectTikTok(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    await prisma.tikTokAccount.updateMany({
      where: { projectSlug: project.slug },
      data: { status: "revoked" },
    });
    revalidatePath("/tiktok");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
