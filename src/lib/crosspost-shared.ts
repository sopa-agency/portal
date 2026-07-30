// Plain module (no "server-only"): types + limits shared between the cross-post
// curation server actions and the client UI.
//
// Instagram only. The `userbase_crosspost_queue` table in the SkateHive app's
// Supabase also carries Farcaster rows, but those publish on the requesting
// user's OWN account with a signer that lives in the app — the portal has no
// business holding it, so it never loads them.

export type CrossPostTarget = "instagram" | "farcaster";

export type CrossPostStatus =
  | "pending_review"
  | "approved"
  | "publishing"
  | "published"
  | "rejected"
  | "failed";

export const IG_CAPTION_MAX = 2200;
export const IG_MAX_COLLABORATORS = 3;

export type MediaItem = { type: "image" | "video"; url: string };

export type InstagramPayload = {
  caption: string;
  collaborators: string[];
  image_url: string | null;
  video_url: string | null;
  media_items?: MediaItem[];
  ig_media_type: "IMAGE" | "REELS" | "CAROUSEL";
  /** Link to the snap on SkateHive — context while curating, not published. */
  permalink_url: string;
};

export type CrossPostResult = { ig_media_id?: string; ig_permalink?: string };

export type CrossPostItem = {
  id: string;
  userId: string | null;
  requestedByHandle: string;
  target: CrossPostTarget;
  hiveAuthor: string | null;
  hivePermlink: string;
  status: CrossPostStatus;
  payload: InstagramPayload;
  reviewedByHandle: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  attempts: number;
  publishedAt: string | null;
  publishError: string | null;
  result: CrossPostResult | null;
  createdAt: string;
  updatedAt: string;
};

/** Every media URL on an item, in render order (carousel keeps its ordering). */
export function mediaOf(payload: InstagramPayload): MediaItem[] {
  if (payload.media_items?.length) return payload.media_items;
  if (payload.video_url) return [{ type: "video", url: payload.video_url }];
  if (payload.image_url) return [{ type: "image", url: payload.image_url }];
  return [];
}

export const STATUS_LABEL: Record<CrossPostStatus, string> = {
  pending_review: "Aguardando",
  approved: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  rejected: "Recusado",
  failed: "Falhou",
};

/** Tailwind classes per status — readable on both light and dark surfaces. */
export const STATUS_CLASS: Record<CrossPostStatus, string> = {
  pending_review: "border-border bg-surface-elevated text-foreground-muted",
  approved: "border-accent-border bg-accent-bg text-accent",
  publishing: "border-amber-400/30 bg-amber-400/10 text-amber-500",
  published: "border-emerald-400/30 bg-emerald-400/10 text-emerald-500",
  rejected: "border-border bg-surface-elevated text-foreground-faint",
  failed: "border-danger/30 bg-danger/10 text-danger",
};
