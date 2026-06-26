"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma, withDbRetry } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { uploadMediaToPinata, createPinataSignedUploadUrl, normalizeMediaUrl } from "@/lib/social-publish";
import { publishInstagramPost, fetchRecentInstagramMedia } from "@/lib/instagram-publish";
import { recordIgCollaborators, syncIgCollaborators } from "@/app/actions/ig-collaborators";
import { publishFacebookPost, facebookCrosspostEnabled } from "@/lib/facebook-publish";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import {
  buildGenerateCaptionPrompt,
  buildImproveCaptionPrompt,
} from "@/lib/post-creator-prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostType = "IMAGE" | "CAROUSEL" | "REELS";
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type UserTag = { username: string; x: number; y: number };

export type DraftRow = {
  id: string;
  type: PostType;
  title: string; // short internal name — identifies the draft in lists
  caption: string;
  mediaUrls: string[];
  status: PostStatus;
  igMediaId: string | null;
  permalink: string | null;
  error: string | null;
  createdBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  firstComment: string;
  collaborators: string[];
  aspectRatio: string | null;
  // Scheduling + manual fallback
  scheduledFor: string | null; // ISO string
  publishMode: "auto" | "manual";
  userTags: UserTag[];
  coverUrl: string | null;
  thumbOffsetMs: number | null;
  musicNote: string;
  brandedPartner: string;
  locationNote: string;
  studioDoc: unknown | null; // Zine Studio carousel doc (rehydrates the studio on reload)
};

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

const PROMPT_OVERRIDE_MAX = 8000;

/**
 * Validate a custom prompt from the "Edit prompt" UI. Returns undefined when
 * none was provided (use the default prompt), an error result when invalid,
 * or the prompt to send verbatim.
 */
function resolvePromptOverride(
  raw: string | undefined,
): { ok: true; prompt: string } | { ok: false; error: string } | undefined {
  if (raw === undefined) return undefined;
  const prompt = raw.trim();
  if (!prompt) return { ok: false, error: "Custom prompt is empty." };
  if (prompt.length > PROMPT_OVERRIDE_MAX) {
    return { ok: false, error: `Custom prompt exceeds ${PROMPT_OVERRIDE_MAX} characters.` };
  }
  return { ok: true, prompt };
}

async function authGate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) throw new Error("Unauthorized");
  if (!project.postCreator) throw new Error("Post Creator is not enabled for this project.");
  return { project, username: session.username };
}

function rowToPlain(row: {
  id: string;
  type: string;
  title?: string | null;
  caption: string;
  mediaUrls: unknown;
  status: string;
  igMediaId: string | null;
  permalink: string | null;
  error: string | null;
  createdBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  firstComment: string | null;
  collaborators: unknown;
  aspectRatio: string | null;
  scheduledFor?: Date | null;
  publishMode?: string | null;
  userTags?: unknown;
  coverUrl?: string | null;
  thumbOffsetMs?: number | null;
  musicNote?: string | null;
  brandedPartner?: string | null;
  locationNote?: string | null;
  studioDoc?: unknown;
}): DraftRow {
  return {
    id: row.id,
    type: row.type as PostType,
    title: row.title ?? "",
    caption: row.caption,
    mediaUrls: Array.isArray(row.mediaUrls) ? (row.mediaUrls as string[]).map(normalizeMediaUrl) : [],
    status: row.status as PostStatus,
    igMediaId: row.igMediaId,
    permalink: row.permalink,
    error: row.error,
    createdBy: row.createdBy,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    firstComment: row.firstComment ?? "",
    collaborators: Array.isArray(row.collaborators) ? (row.collaborators as string[]) : [],
    aspectRatio: row.aspectRatio ?? null,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    publishMode: (row.publishMode === "manual" ? "manual" : "auto"),
    userTags: Array.isArray(row.userTags) ? (row.userTags as UserTag[]) : [],
    coverUrl: row.coverUrl ? normalizeMediaUrl(row.coverUrl) : null,
    thumbOffsetMs: row.thumbOffsetMs ?? null,
    musicNote: row.musicNote ?? "",
    brandedPartner: row.brandedPartner ?? "",
    locationNote: row.locationNote ?? "",
    studioDoc: row.studioDoc ?? null,
  };
}

// ---------------------------------------------------------------------------
// Collaborator sanitisation — server-side mirror of the publish helper
// ---------------------------------------------------------------------------

function sanitiseCollaboratorsSrv(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const cleaned = raw
    .map((u) => u.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, ""))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, 3);
}

// ---------------------------------------------------------------------------
// User-tag sanitisation — IMAGE only; max 20; x/y clamped to 0..1
// ---------------------------------------------------------------------------

function sanitiseUserTagsSrv(raw: UserTag[] | undefined): UserTag[] {
  if (!raw || raw.length === 0) return [];
  return raw
    .map((t) => ({
      username: t.username.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, ""),
      x: Math.max(0, Math.min(1, t.x)),
      y: Math.max(0, Math.min(1, t.y)),
    }))
    .filter((t) => t.username.length > 0)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Derive publishMode: "manual" if any manual-only note is set
// ---------------------------------------------------------------------------

function derivePublishMode(
  musicNote?: string | null,
  brandedPartner?: string | null,
  locationNote?: string | null,
): "auto" | "manual" {
  const requiresManual = !!(musicNote?.trim() || brandedPartner?.trim() || locationNote?.trim());
  return requiresManual ? "manual" : "auto";
}

// ---------------------------------------------------------------------------
// listDrafts
// ---------------------------------------------------------------------------

export async function listDrafts(): Promise<
  { ok: true; drafts: DraftRow[] } | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();
    const rows = await prisma.instagramPost.findMany({
      where: { projectSlug: project.slug },
      orderBy: [{ updatedAt: "desc" }],
      omit: { studioDoc: true }, // doc pesado (data-URIs) só é buscado on-demand via getPost
    });
    // Sort: scheduled first (by scheduledFor asc), then draft/failed, then published
    const sorted = [...rows].sort((a, b) => {
      const priority = (s: string) => {
        if (s === "scheduled") return 0;
        if (s === "draft" || s === "failed" || s === "publishing") return 1;
        return 2; // published
      };
      const p = priority(a.status) - priority(b.status);
      if (p !== 0) return p;
      // Within scheduled, sort by scheduledFor asc
      if (a.status === "scheduled" && b.status === "scheduled") {
        const at = a.scheduledFor?.getTime() ?? 0;
        const bt = b.scheduledFor?.getTime() ?? 0;
        return at - bt;
      }
      return 0;
    });
    return { ok: true, drafts: sorted.map(rowToPlain) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// getPost
// ---------------------------------------------------------------------------

export async function getPost(
  id: string,
): Promise<{ ok: true; post: DraftRow } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const row = await prisma.instagramPost.findUnique({ where: { id } });
    if (!row) return { ok: false, error: "Post not found." };
    if (row.projectSlug !== project.slug) return { ok: false, error: "Not found." };
    return { ok: true, post: rowToPlain(row) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

export async function createDraft(params: {
  type: PostType;
  title?: string;
  caption: string;
  mediaUrls: string[];
  firstComment?: string;
  collaborators?: string[];
  aspectRatio?: string;
  userTags?: UserTag[];
  coverUrl?: string | null;
  thumbOffsetMs?: number | null;
  musicNote?: string;
  brandedPartner?: string;
  locationNote?: string;
  studioDoc?: unknown;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { project, username } = await authGate();
    const publishMode = derivePublishMode(params.musicNote, params.brandedPartner, params.locationNote);
    const row = await withDbRetry(() => prisma.instagramPost.create({
      data: {
        projectSlug: project.slug,
        type: params.type,
        title: params.title?.trim() || null,
        caption: params.caption,
        mediaUrls: params.mediaUrls,
        status: "draft",
        createdBy: username,
        firstComment: params.firstComment?.trim() ?? null,
        collaborators: sanitiseCollaboratorsSrv(params.collaborators),
        aspectRatio: params.aspectRatio ?? null,
        userTags: params.type === "IMAGE" ? sanitiseUserTagsSrv(params.userTags) : [],
        coverUrl: params.type === "REELS" ? (params.coverUrl ?? null) : null,
        thumbOffsetMs: params.type === "REELS" ? (params.thumbOffsetMs ?? null) : null,
        musicNote: params.musicNote?.trim() ?? null,
        brandedPartner: params.brandedPartner?.trim() ?? null,
        locationNote: params.locationNote?.trim() ?? null,
        ...(params.studioDoc != null ? { studioDoc: params.studioDoc as Prisma.InputJsonValue } : {}),
        publishMode,
      },
    }));
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// updateDraft
// ---------------------------------------------------------------------------

export async function updateDraft(
  id: string,
  params: {
    type?: PostType;
    title?: string;
    caption?: string;
    mediaUrls?: string[];
    firstComment?: string;
    collaborators?: string[];
    aspectRatio?: string | null;
    userTags?: UserTag[];
    coverUrl?: string | null;
    thumbOffsetMs?: number | null;
    musicNote?: string;
    brandedPartner?: string;
    locationNote?: string;
    studioDoc?: unknown;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Draft not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };

    // Re-derive publishMode from the merged state (use updated values if provided,
    // else fall back to existing stored values).
    const mergedMusicNote = params.musicNote !== undefined ? params.musicNote : (existing.musicNote ?? "");
    const mergedBrandedPartner = params.brandedPartner !== undefined ? params.brandedPartner : (existing.brandedPartner ?? "");
    const mergedLocationNote = params.locationNote !== undefined ? params.locationNote : (existing.locationNote ?? "");
    const publishMode = derivePublishMode(mergedMusicNote, mergedBrandedPartner, mergedLocationNote);

    // Resolve the effective type to decide whether userTags apply
    const effectiveType = params.type ?? existing.type;

    await withDbRetry(() => prisma.instagramPost.update({
      where: { id },
      data: {
        ...(params.type !== undefined ? { type: params.type } : {}),
        ...(params.title !== undefined ? { title: params.title.trim() || null } : {}),
        ...(params.caption !== undefined ? { caption: params.caption } : {}),
        ...(params.mediaUrls !== undefined ? { mediaUrls: params.mediaUrls } : {}),
        ...(params.firstComment !== undefined ? { firstComment: params.firstComment.trim() || null } : {}),
        ...(params.collaborators !== undefined ? { collaborators: sanitiseCollaboratorsSrv(params.collaborators) } : {}),
        ...(params.aspectRatio !== undefined ? { aspectRatio: params.aspectRatio ?? null } : {}),
        ...(params.userTags !== undefined ? { userTags: effectiveType === "IMAGE" ? sanitiseUserTagsSrv(params.userTags) : [] } : {}),
        ...(params.coverUrl !== undefined ? { coverUrl: effectiveType === "REELS" ? params.coverUrl : null } : {}),
        ...(params.thumbOffsetMs !== undefined ? { thumbOffsetMs: effectiveType === "REELS" ? params.thumbOffsetMs : null } : {}),
        ...(params.musicNote !== undefined ? { musicNote: params.musicNote.trim() || null } : {}),
        ...(params.brandedPartner !== undefined ? { brandedPartner: params.brandedPartner.trim() || null } : {}),
        ...(params.locationNote !== undefined ? { locationNote: params.locationNote.trim() || null } : {}),
        ...(params.studioDoc != null ? { studioDoc: params.studioDoc as Prisma.InputJsonValue } : {}),
        publishMode,
      },
    }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// deleteDraft
// ---------------------------------------------------------------------------

export async function deleteDraft(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();
    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Draft not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };
    await prisma.instagramPost.delete({ where: { id } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// uploadPostMedia — wraps Pinata for both images and videos
// ---------------------------------------------------------------------------

export async function uploadPostMedia(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await authGate();
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file provided." };
    return await uploadMediaToPinata(file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Signed-URL handshake for DIRECT browser→Pinata uploads. The file itself never
 * touches the server action transport, so large videos (Reels) work even past
 * the server-action body limit / Vercel request cap.
 */
export async function signPostMediaUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    await authGate();
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// generateCaption
// ---------------------------------------------------------------------------

export async function generateCaption(params: {
  topic: string;
  type: PostType;
  /** Custom prompt from the "Edit prompt" UI — sent to the agent as-is. */
  promptOverride?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();

    const override = resolvePromptOverride(params.promptOverride);
    if (override && !override.ok) return override;
    const prompt = override
      ? override.prompt
      : buildGenerateCaptionPrompt({
          agentName: project.agent.displayName,
          topic: params.topic,
          type: params.type,
        });

    const text = await callOpenClaw(prompt, project.agent.id, {
      project,
      timeoutMs: 60_000,
    });

    if (!text) return { ok: false, error: "Agent returned an empty response." };
    return { ok: true, text: text.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// improveCaption
// ---------------------------------------------------------------------------

export async function improveCaption(params: {
  caption: string;
  type: PostType;
  /** Custom prompt from the "Edit prompt" UI — sent to the agent as-is. */
  promptOverride?: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();

    const override = resolvePromptOverride(params.promptOverride);
    if (override && !override.ok) return override;
    const prompt = override
      ? override.prompt
      : buildImproveCaptionPrompt({
          agentName: project.agent.displayName,
          caption: params.caption,
          type: params.type,
        });

    const text = await callOpenClaw(prompt, project.agent.id, {
      project,
      timeoutMs: 60_000,
    });

    if (!text) return { ok: false, error: "Agent returned an empty response." };
    return { ok: true, text: text.trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------------

const CAPTION_MAX = 2200;

function validateForPublish(post: DraftRow): string | null {
  if (post.caption.length > CAPTION_MAX) {
    return `Caption too long (${post.caption.length}/${CAPTION_MAX} chars).`;
  }
  if (post.type === "IMAGE") {
    if (post.mediaUrls.length !== 1) return "Single image post requires exactly 1 image.";
  } else if (post.type === "CAROUSEL") {
    if (post.mediaUrls.length < 2 || post.mediaUrls.length > 10) {
      return "Carousel requires 2–10 items (photos or videos).";
    }
  } else if (post.type === "REELS") {
    if (post.mediaUrls.length !== 1) return "Reel requires exactly 1 video.";
  }
  return null;
}

export async function publishDraft(
  id: string,
): Promise<
  | { ok: true; igMediaId: string; permalink?: string; firstCommentPosted?: boolean; facebook?: { ok: boolean; error?: string; permalink?: string } }
  | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();

    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Draft not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };

    const post = rowToPlain(existing);

    // Reject manual-mode posts — they require music/paid-partnership/location
    // to be set inside the Instagram app and cannot be auto-published.
    if (post.publishMode === "manual") {
      return {
        ok: false,
        error:
          "This post needs music / paid-partnership / location, which must be set in the Instagram app — schedule it for manual posting instead.",
      };
    }

    const validationError = validateForPublish(post);
    if (validationError) return { ok: false, error: validationError };

    // Transcode any videos to IG-safe MP4 (ffmpeg, where available) before publishing.
    const { ensureInstagramMedia } = await import("@/lib/transcode-ig");
    const publishMediaUrls = await ensureInstagramMedia(post.mediaUrls);

    const result = await publishInstagramPost(project, {
      type: post.type,
      caption: post.caption,
      mediaUrls: publishMediaUrls,
      collaborators: post.collaborators.length > 0 ? post.collaborators : undefined,
      firstComment: post.firstComment || undefined,
      userTags: post.userTags.length > 0 ? post.userTags : undefined,
      coverUrl: post.coverUrl ?? undefined,
      thumbOffsetMs: post.thumbOffsetMs ?? undefined,
    });

    if (result.ok) {
      // The post is LIVE on Instagram now — persist that with retry so a Neon
      // cold-start drop doesn't leave the DB thinking it failed (and risk a re-publish).
      await withDbRetry(() => prisma.instagramPost.update({
        where: { id },
        data: {
          status: "published",
          igMediaId: result.igMediaId,
          permalink: result.permalink ?? null,
          publishedAt: new Date(),
          scheduledFor: null,
          error: null,
        },
      }));
      // Grow the collaborator suggestion pool from this post: record who we
      // tagged, and re-sync userbase + recent commenters. Best-effort — never
      // let it affect the publish result.
      await recordIgCollaborators(post.collaborators).catch(() => {});
      await syncIgCollaborators().catch(() => {});

      // Cross-publish to the Facebook Page (best-effort — never undo IG success).
      // IG's native share-to-FB doesn't fire for API posts, so we post directly.
      let facebook: { ok: boolean; error?: string; permalink?: string } | undefined;
      if (facebookCrosspostEnabled(project)) {
        const fb = await publishFacebookPost(project, {
          type: post.type,
          caption: post.caption,
          mediaUrls: publishMediaUrls,
        }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
        facebook = fb.ok ? { ok: true, permalink: fb.permalink } : { ok: false, error: fb.error };
      }
      return {
        ok: true,
        igMediaId: result.igMediaId,
        permalink: result.permalink,
        firstCommentPosted: result.firstCommentPosted,
        facebook,
      };
    } else {
      await withDbRetry(() => prisma.instagramPost.update({
        where: { id },
        data: { status: "failed", error: result.error },
      }));
      return { ok: false, error: result.error };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// scheduleDraft — validate + set status="scheduled" with a future time
// ---------------------------------------------------------------------------

export async function scheduleDraft(
  id: string,
  whenISO: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();

    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Draft not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };

    const when = new Date(whenISO);
    if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid date/time." };
    if (when <= new Date()) return { ok: false, error: "Scheduled time must be in the future." };

    const post = rowToPlain(existing);
    const validationError = validateForPublish(post);
    if (validationError) return { ok: false, error: validationError };

    const publishMode = post.publishMode; // already persisted from last save

    await prisma.instagramPost.update({
      where: { id },
      data: {
        status: "scheduled",
        scheduledFor: when,
        publishMode,
        error: null,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// unscheduleDraft — revert a scheduled post back to draft
// ---------------------------------------------------------------------------

export async function unscheduleDraft(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();

    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Post not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };
    if (existing.status !== "scheduled") {
      return { ok: false, error: "Post is not currently scheduled." };
    }

    await prisma.instagramPost.update({
      where: { id },
      data: { status: "draft", scheduledFor: null },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// markPosted — for manual posts: mark as published without igMediaId
// ---------------------------------------------------------------------------

export async function markPosted(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { project } = await authGate();

    const existing = await prisma.instagramPost.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Post not found." };
    if (existing.projectSlug !== project.slug) return { ok: false, error: "Not found." };
    if (existing.publishMode !== "manual") {
      return { ok: false, error: "markPosted is only for manual posts." };
    }

    await prisma.instagramPost.update({
      where: { id },
      data: {
        status: "published",
        publishedAt: new Date(),
        scheduledFor: null,
        error: null,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// listCalendarExtras — everything scheduled that ISN'T an own-project
// Instagram post, so the calendar shows the whole picture: posts scheduled
// from Post Suggestions and Repo to Social (any platform), plus the scheduled
// Instagram posts of nested projects (Reelflip sees Gnars + SkateHive).
// ---------------------------------------------------------------------------

export type CalendarExtra = {
  id: string;
  kind: "suggestion" | "repo" | "instagram" | "lab";
  /** Origin project (badged in the calendar when not the active one). */
  projectSlug: string;
  platform: string;
  title: string;
  when: string; // ISO
};

export async function listCalendarExtras(): Promise<
  { ok: true; events: CalendarExtra[] } | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();
    const { getAllProjects } = await import("@/projects/index");
    const childSlugs = getAllProjects()
      .filter((p) => p.switcher?.parent === project.slug)
      .map((p) => p.slug);
    const family = [project.slug, ...childSlugs];
    const events: CalendarExtra[] = [];

    const [sugRuns, repoRuns] = await Promise.all([
      prisma.marketingSuggestionRun.findMany({
        where: { configId: { in: family } },
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { id: true, configId: true, tweets: true, tweetStates: true },
      }),
      prisma.repoToSocialRun.findMany({
        where: { configId: { in: family } },
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { id: true, configId: true, tweets: true, tweetStates: true },
      }),
    ]);

    const harvest = (
      runs: { id: string; configId: string; tweets: unknown; tweetStates: unknown }[],
      kind: "suggestion" | "repo",
    ) => {
      for (const run of runs) {
        const tweets = Array.isArray(run.tweets) ? (run.tweets as unknown[]) : [];
        const states =
          run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
            ? (run.tweetStates as Record<string, { scheduledFor?: Record<string, unknown> }>)
            : {};
        for (const [idx, st] of Object.entries(states)) {
          for (const [platform, iso] of Object.entries(st?.scheduledFor ?? {})) {
            if (typeof iso !== "string") continue;
            events.push({
              id: `${kind}:${run.id}:${idx}:${platform}`,
              kind,
              projectSlug: run.configId,
              platform,
              title: String(tweets[Number(idx)] ?? "").slice(0, 1000),
              when: iso,
            });
          }
        }
      }
    };
    harvest(sugRuns, "suggestion");
    harvest(repoRuns, "repo");

    if (childSlugs.length > 0) {
      const rows = await prisma.instagramPost.findMany({
        where: { projectSlug: { in: childSlugs }, status: "scheduled" },
        select: { id: true, projectSlug: true, caption: true, scheduledFor: true },
      });
      for (const r of rows) {
        if (!r.scheduledFor) continue;
        events.push({
          id: `ig:${r.id}`,
          kind: "instagram",
          projectSlug: r.projectSlug,
          platform: "instagram",
          title: r.caption.slice(0, 600),
          when: r.scheduledFor.toISOString(),
        });
      }
    }

    // Lab-scheduled cross-network posts (non-IG), family-wide.
    const labPosts = await prisma.labScheduledPost.findMany({
      where: { projectSlug: { in: family }, status: { in: ["scheduled", "publishing"] } },
      select: { id: true, projectSlug: true, network: true, text: true, scheduledFor: true },
    });
    for (const lp of labPosts) {
      events.push({
        id: `lab:${lp.id}`,
        kind: "lab",
        projectSlug: lp.projectSlug,
        platform: lp.network,
        title: lp.text.slice(0, 600),
        when: lp.scheduledFor.toISOString(),
      });
    }

    events.sort((a, b) => (a.when < b.when ? -1 : 1));
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Unified calendar feed: own Instagram posts (scheduled + published) AND all
 *  cross-source extras — for calendars outside the Post Creator. */
export async function listUnifiedCalendar(): Promise<
  { ok: true; events: CalendarExtra[] } | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();
    const own = await prisma.instagramPost.findMany({
      where: { projectSlug: project.slug, status: { in: ["scheduled", "published"] } },
      select: { id: true, caption: true, scheduledFor: true, publishedAt: true, status: true },
    });
    const extrasRes = await listCalendarExtras();
    const events: CalendarExtra[] = extrasRes.ok ? [...extrasRes.events] : [];
    for (const r of own) {
      const when = r.status === "published" ? r.publishedAt : r.scheduledFor;
      if (!when) continue;
      events.push({
        id: `own:${r.id}`,
        kind: "instagram",
        projectSlug: project.slug,
        platform: "instagram",
        title: r.caption.slice(0, 600),
        when: when.toISOString(),
      });
    }
    events.sort((a, b) => (a.when < b.when ? -1 : 1));
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// importRecentInstagramPosts — backfill the calendar/feed with the last N posts
// actually published on the brand's IG account (via Graph API). Idempotent:
// dedups by igMediaId, so re-running (or a later Neon→Supabase data migration
// that carries the same igMediaId) won't create duplicates. Imported rows are
// real `published` posts tagged createdBy="instagram-import".
// ---------------------------------------------------------------------------

export async function importRecentInstagramPosts(
  limit = 10,
): Promise<
  | { ok: true; imported: number; skipped: number; total: number }
  | { ok: false; error: string }
> {
  try {
    const { project } = await authGate();
    const res = await fetchRecentInstagramMedia(project, limit);
    if (!res.ok) return res;

    const ids = res.media.map((m) => m.igMediaId);
    if (ids.length === 0) return { ok: true, imported: 0, skipped: 0, total: 0 };

    // Which of these are already in the DB (by igMediaId, scoped to project)?
    const existing = await withDbRetry(() =>
      prisma.instagramPost.findMany({
        where: { projectSlug: project.slug, igMediaId: { in: ids } },
        select: { igMediaId: true },
      }),
    );
    const seen = new Set(existing.map((r) => r.igMediaId));
    const fresh = res.media.filter((m) => !seen.has(m.igMediaId));

    let imported = 0;
    for (const m of fresh) {
      await withDbRetry(() =>
        prisma.instagramPost.create({
          data: {
            projectSlug: project.slug,
            type: m.type,
            caption: m.caption,
            mediaUrls: m.mediaUrls,
            status: "published",
            igMediaId: m.igMediaId,
            permalink: m.permalink,
            publishedAt: new Date(m.publishedAt),
            coverUrl: m.coverUrl,
            publishMode: "auto",
            createdBy: "instagram-import",
          },
        }),
      );
      imported++;
    }

    return {
      ok: true,
      imported,
      skipped: res.media.length - imported,
      total: res.media.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
