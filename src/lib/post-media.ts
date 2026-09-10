// Media-kind helpers shared by the Post Creator composer, the scheduled-post
// dialog, the drafts lists and the cross-post curation. Plain module: no React,
// no server-only imports.
//
// The portal tells videos from images by the URL's extension. Its own uploads
// keep that working on extensionless IPFS CID URLs with a `?filename=` hint
// (see upload-media-client.ts). Cross-posts arrive from the SkateHive app as
// bare CIDs, so their videos used to read as images everywhere on the client:
// no cover picker, a broken <img> for a preview. `tagMediaKind` gives them the
// same hint at approval time; `mediaUploads` covers rows tagged before that.
import type { UploadState } from "@/lib/post-aspect";

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)(\?|#|&|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif)(\?|#|&|$)/i;

/** True when the URL carries a video extension, on the path or in `?filename=`. */
export function isVideoUrl(url: string | null | undefined): boolean {
  return !!url && VIDEO_EXT_RE.test(url);
}

/**
 * Append `?filename=<last segment>.<ext>` to a URL that has no recognisable
 * media extension, so `isVideoUrl` (and every preview built on it) can tell
 * what it is. IPFS gateways ignore the query. No-op when the URL already has
 * an extension or already carries a query string.
 */
export function tagMediaKind(url: string, kind: "image" | "video"): string {
  if (!url || url.includes("?") || VIDEO_EXT_RE.test(url) || IMAGE_EXT_RE.test(url)) return url;
  const base = url.split("#")[0].replace(/\/+$/, "").split("/").pop() || "media";
  return `${url}?filename=${encodeURIComponent(base)}.${kind === "video" ? "mp4" : "jpg"}`;
}

/**
 * Rows for the composer / dialog preview from a stored draft. Index 0 of a
 * Reel is always its video, whatever the URL looks like — a cross-post approved
 * before URLs were tagged stores a bare CID there.
 */
export function mediaUploads(type: string, mediaUrls: string[]): UploadState[] {
  return mediaUrls.map((url, i) => ({
    url,
    previewUrl: url,
    isVideo: isVideoUrl(url) || (type === "REELS" && i === 0),
  }));
}

/**
 * What a list or feed cell shows for a draft. A Reel with a chosen cover shows
 * the cover: it is what Instagram will show, and an <img> beats a <video> in a
 * 48px thumbnail.
 */
export function draftThumb(d: { type: string; mediaUrls: string[]; coverUrl?: string | null }): {
  url: string | null;
  isVideo: boolean;
} {
  if (d.type === "REELS" && d.coverUrl) return { url: d.coverUrl, isVideo: false };
  const url = d.mediaUrls[0] ?? null;
  return { url, isVideo: !!url && (isVideoUrl(url) || d.type === "REELS") };
}
