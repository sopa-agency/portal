"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ImagePlus,
  Loader2,
  Copy,
  Download,
  Send,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  Sparkles,
  Wand2,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowUp,
  ArrowDown,
  Clock,
  Tag,
  Music,
  MapPin,
  Handshake,
  CalendarCheck,
  FileEdit,
  LayoutList,
  CalendarDays,
  ExternalLink,
  Megaphone,
} from "lucide-react";
import {
  listDrafts,
  createDraft,
  updateDraft,
  deleteDraft,
  uploadPostMedia,
  signPostMediaUpload,
  generateCaption,
  improveCaption,
  publishDraft,
  scheduleDraft,
  unscheduleDraft,
  markPosted,
  type PostType,
  type DraftRow,
  type UserTag,
  listCalendarExtras,
  type CalendarExtra,
} from "@/app/actions/post-creator";
import { createCampaignFromInstagramPost } from "@/app/actions/campaigns";
import { CAPTION_MAX, COMMENT_MAX, POST_TYPES, toDatetimeLocalValue, formatLocalDatetime, computeSteps, type ViewTab, type StepId } from "@/components/post-creator-lib";
import { IgPreview } from "@/components/post/ig-preview";
import { ReelCoverPicker } from "@/components/post/reel-cover-picker";
import {
  type AspectRatio,
  type UploadState,
  aspectToClass,
  snapToFeedRatio,
} from "@/lib/post-aspect";
import {
  buildGenerateCaptionPrompt,
  buildImproveCaptionPrompt,
} from "@/lib/post-creator-prompts";
import dynamic from "next/dynamic";
import { Toaster as StudioToaster } from "@/components/studio/ui/sonner";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { ScheduledPostDialog } from "@/components/scheduled-post-dialog";
import { EmojiPicker } from "@/components/emoji-picker";

// Studio (vendored Figma-like design tool) — heavy + browser-only, so it loads
// on demand when the tab opens.
const StudioEditor = dynamic(
  () => import("@/components/studio/editor").then((m) => m.Editor),
  { ssr: false },
);
// Studio video editor — canvas/WebAudio/MediaRecorder, strictly browser-only.
const StudioVideoEditor = dynamic(
  () => import("@/components/studio/video-editor").then((m) => m.VideoEditor),
  { ssr: false },
);
import type { AspectKey } from "@/components/studio/video-editor";

// Map the Post Creator's post format ↔ the video editor's aspect keys
// (1.91:1 landscape feed ≈ 16:9 video).
function ratioToAspectKey(r: AspectRatio): AspectKey {
  return r === "1.91:1" ? "16:9" : (r as AspectKey);
}
function aspectKeyToRatio(a: AspectKey): AspectRatio {
  return a === "16:9" ? "1.91:1" : (a as AspectRatio);
}

/**
 * Direct browser→Pinata upload: ask the server for a short-lived signed URL,
 * then POST the file straight to Pinata. The media never flows through the
 * Next server, so big Reels videos aren't capped by the server-action body
 * limit (or Vercel's request cap).
 */
async function uploadMediaDirect(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signPostMediaUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata upload HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    // ?filename= keeps the original extension on the CID URL so consumers
    // (draft reload, carousel publish) can tell videos from images.
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: DraftRow["status"]) {
  const map: Record<string, string> = {
    draft: "bg-accent-bg text-accent border-accent-border",
    scheduled: "bg-warning/10 text-warning border-warning/30",
    publishing: "bg-warning/10 text-warning border-warning/30",
    published: "bg-success/10 text-success border-success/30",
    failed: "bg-danger/10 text-danger border-danger/30",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider tabular-nums ${map[status] ?? "border-border text-foreground-muted"}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PostDialog — modal for viewing/editing a scheduled post
// ---------------------------------------------------------------------------

function PostDialog({
  post,
  igHandle,
  onClose,
  onLoad,
  onCancel,
  onMarkPosted,
  onDelete,
  onRefresh,
}: {
  post: DraftRow;
  igHandle: string;
  onClose: () => void;
  onLoad: (d: DraftRow) => void;
  onCancel: (id: string) => void;
  onMarkPosted: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [dialogCaption, setDialogCaption] = useState(post.caption);
  const [dialogComment, setDialogComment] = useState(post.firstComment ?? "");
  const [dialogSchedule, setDialogSchedule] = useState(
    post.scheduledFor ? toDatetimeLocalValue(new Date(post.scheduledFor)) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [dialogFit, setDialogFit] = useState<"cover" | "contain">("cover");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPublishDialog, setConfirmPublishDialog] = useState(false);
  const [publishingDialog, setPublishingDialog] = useState(false);
  const [publishDialogError, setPublishDialogError] = useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  // Snapshot "now" at mount via a lazy state initializer — calling Date.now()
  // directly in render is an impure call (flagged by react-hooks lint) and a
  // mount-time snapshot is plenty for a dialog's due-state check.
  const [now] = useState(() => Date.now());
  const isDue = post.scheduledFor ? new Date(post.scheduledFor).getTime() <= now : false;
  const isManual = post.publishMode === "manual";
  const isPublished = post.status === "published";

  const appTasks: string[] = [];
  if (post.musicNote) appTasks.push(`Music: ${post.musicNote}`);
  if (post.brandedPartner) appTasks.push(`Paid partnership: @${post.brandedPartner}`);
  if (post.locationNote) appTasks.push(`Location: ${post.locationNote}`);

  // Derive uploads + aspect for IgPreview
  const dialogUploads = post.mediaUrls.map((url) => ({
    url,
    previewUrl: url,
    isVideo: /\.(mp4|mov|webm)(\?|$)/i.test(url),
  }));
  const dialogAspectClass = aspectToClass(
    (post.aspectRatio as AspectRatio) ?? (post.type === "REELS" ? "9:16" : "1:1")
  );

  // Focus close button on open
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Esc to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Sync state when post prop changes
  useEffect(() => {
    setDialogCaption(post.caption);
    setDialogComment(post.firstComment ?? "");
    setDialogSchedule(post.scheduledFor ? toDatetimeLocalValue(new Date(post.scheduledFor)) : "");
  }, [post.id, post.caption, post.firstComment, post.scheduledFor]);

  const captionChanged = dialogCaption !== post.caption;
  const commentChanged = dialogComment !== (post.firstComment ?? "");
  const scheduleChanged = dialogSchedule !== (post.scheduledFor ? toDatetimeLocalValue(new Date(post.scheduledFor)) : "");
  const hasChanges = captionChanged || commentChanged || scheduleChanged;

  async function handleSave() {
    setSaving(true);
    setSaveFlash(null);
    try {
      if (captionChanged || commentChanged) {
        await updateDraft(post.id, {
          caption: dialogCaption,
          firstComment: dialogComment,
        });
      }
      if (scheduleChanged && dialogSchedule) {
        const when = new Date(dialogSchedule);
        if (when <= new Date()) {
          setSaveFlash("Error: Scheduled time must be in the future.");
          setSaving(false);
          return;
        }
        await scheduleDraft(post.id, when.toISOString());
      }
      await onRefresh();
      setSaveFlash("Saved!");
      setTimeout(() => setSaveFlash(null), 2500);
    } catch {
      setSaveFlash("Error saving changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishDialog() {
    setPublishingDialog(true);
    setPublishDialogError(null);
    try {
      const res = await publishDraft(post.id);
      if (res.ok) {
        await onRefresh();
        onClose();
      } else {
        setPublishDialogError(res.error ?? "Publish failed.");
      }
    } catch {
      setPublishDialogError("Publish failed.");
    } finally {
      setPublishingDialog(false);
      setConfirmPublishDialog(false);
    }
  }

  async function handleCreateCampaign() {
    setCreatingCampaign(true);
    setCampaignError(null);
    try {
      const res = await createCampaignFromInstagramPost(post.id);
      if (res.ok) {
        router.push(`/campaign-creator/${res.campaignId}`);
      } else {
        setCampaignError(res.error);
        setCreatingCampaign(false);
      }
    } catch {
      setCampaignError("Failed to create campaign. Try again.");
      setCreatingCampaign(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm md:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl lg:max-w-4xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
            {post.type}
          </span>
          {statusBadge(post.status)}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              isManual
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-accent-border bg-accent-bg text-accent"
            }`}
          >
            {isManual ? "Manual" : "Auto"}
          </span>
          {post.scheduledFor && (
            <span className="ml-1 text-[11px] tabular-nums text-foreground-muted">
              {isManual && isDue ? (
                <span className="font-semibold text-warning">Ready — post manually</span>
              ) : (
                formatLocalDatetime(post.scheduledFor)
              )}
            </span>
          )}
          <button
            ref={closeRef}
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Side-by-side body: preview LEFT, tools RIGHT (stacked on mobile) */}
        <div className="flex max-h-[85vh] flex-col overflow-y-auto md:max-h-[80vh] md:flex-row md:overflow-hidden">
          {/* LEFT — IG Preview */}
          <div className="flex shrink-0 items-start justify-center border-b border-border bg-surface-elevated/40 px-6 py-6 md:w-[360px] md:border-b-0 md:border-r md:overflow-y-auto">
            <div className="w-full max-w-[340px]">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                Preview
              </p>
              <IgPreview
                handle={igHandle}
                caption={dialogCaption}
                uploads={dialogUploads}
                type={post.type}
                aspectClass={dialogAspectClass}
                collaborators={post.collaborators ?? []}
                userTags={post.userTags ?? []}
                taggingActive={false}
                onTagClick={() => {}}
                onRemoveTag={() => {}}
                fit={dialogFit}
                onToggleFit={() => setDialogFit((f) => (f === "cover" ? "contain" : "cover"))}
              />
            </div>
          </div>

          {/* RIGHT — Editing tools + actions */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {/* Scrollable edit area */}
            <div className="flex-1 space-y-4 p-5">
              {/* Metadata rows */}
              {(post.userTags?.length > 0 ||
                post.collaborators?.length > 0 ||
                post.musicNote ||
                post.brandedPartner ||
                post.locationNote ||
                post.firstComment) && (
                <div className="space-y-1 rounded-xl border border-border bg-surface-elevated p-3 text-[12px] text-foreground-muted">
                  {post.userTags && post.userTags.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span>{post.userTags.map((t) => `@${t.username}`).join(", ")}</span>
                    </div>
                  )}
                  {post.collaborators && post.collaborators.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Handshake className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span>With {post.collaborators.map((u) => `@${u}`).join(", ")}</span>
                    </div>
                  )}
                  {post.musicNote && (
                    <div className="flex items-center gap-2">
                      <Music className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span>{post.musicNote}</span>
                    </div>
                  )}
                  {post.brandedPartner && (
                    <div className="flex items-center gap-2">
                      <Handshake className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span>Paid partnership: @{post.brandedPartner}</span>
                    </div>
                  )}
                  {post.locationNote && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span>{post.locationNote}</span>
                    </div>
                  )}
                  {post.firstComment && (
                    <div className="flex items-start gap-2">
                      <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      <span className="line-clamp-2">{post.firstComment}</span>
                    </div>
                  )}
                </div>
              )}

              {isPublished ? (
                /* ── Published branch: read-only caption + comment ── */
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground-muted">Caption</label>
                    <div className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-foreground whitespace-pre-wrap">
                      {post.caption || <span className="text-foreground-faint italic">No caption</span>}
                    </div>
                  </div>

                  {post.firstComment && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground-muted">First comment</label>
                      <div className="w-full rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-foreground whitespace-pre-wrap">
                        {post.firstComment}
                      </div>
                    </div>
                  )}

                  {post.publishedAt && (
                    <p className="flex items-center gap-1.5 text-[12px] tabular-nums text-foreground-subtle">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      Published {formatLocalDatetime(post.publishedAt)}
                    </p>
                  )}

                  {/* Create Campaign helper text */}
                  <div className="rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-[12px] text-foreground-muted">
                    <span className="font-medium text-foreground-subtle">Create Campaign</span>
                    {" "}opens a campaign seeded with this post&apos;s content — then hit Generate to draft the X thread, Farcaster, Discord &amp; email.
                  </div>

                  {/* Campaign error */}
                  {campaignError && (
                    <p className="flex items-center gap-1.5 text-sm text-danger">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {campaignError}
                    </p>
                  )}
                </>
              ) : (
                /* ── Non-published branch: editable caption + comment + reschedule ── */
                <>
                  {/* Caption editor */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-foreground-muted">Caption</label>
                      <div className="flex items-center gap-2">
                        <EmojiPicker
                          align="right"
                          onPick={(emoji) => {
                            const el = captionRef.current;
                            const at = el ? el.selectionStart : dialogCaption.length;
                            const end = el ? el.selectionEnd : dialogCaption.length;
                            setDialogCaption(dialogCaption.slice(0, at) + emoji + dialogCaption.slice(end));
                          }}
                        />
                        <span className="text-[11px] tabular-nums text-foreground-faint">
                          {dialogCaption.length}/{CAPTION_MAX}
                        </span>
                      </div>
                    </div>
                    <textarea
                      ref={captionRef}
                      value={dialogCaption}
                      onChange={(e) => setDialogCaption(e.target.value)}
                      rows={4}
                      className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="Caption…"
                    />
                  </div>

                  {/* First comment editor */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground-muted">First comment</label>
                    <textarea
                      value={dialogComment}
                      onChange={(e) => setDialogComment(e.target.value)}
                      rows={2}
                      className="w-full resize-y rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="First comment (optional)…"
                    />
                  </div>

                  {/* Reschedule */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                      <Clock className="h-3.5 w-3.5" />
                      Reschedule
                    </label>
                    <input
                      type="datetime-local"
                      value={dialogSchedule}
                      min={toDatetimeLocalValue(new Date())}
                      onChange={(e) => setDialogSchedule(e.target.value)}
                      className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent-border tabular-nums"
                    />
                  </div>

                  {/* Save changes button (inline when there are changes) */}
                  {hasChanges && (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Save changes
                    </button>
                  )}

                  {/* Save flash */}
                  {saveFlash && (
                    <p
                      className={`flex items-center gap-1.5 text-sm ${
                        saveFlash.startsWith("Error") ? "text-danger" : "text-success"
                      }`}
                    >
                      {saveFlash.startsWith("Error") ? (
                        <AlertCircle className="h-4 w-4 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                      )}
                      {saveFlash}
                    </p>
                  )}

                  {/* Manual checklist */}
                  {isManual && isDue && appTasks.length > 0 && (
                    <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-warning">
                        Set in Instagram app
                      </p>
                      {appTasks.map((t) => (
                        <p key={t} className="flex items-start gap-1.5 text-[12px] text-warning">
                          <span className="mt-0.5">•</span>
                          <span>{t}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Publish dialog error */}
                  {publishDialogError && (
                    <p className="flex items-center gap-1.5 text-sm text-danger">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {publishDialogError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Footer actions — pinned to bottom of right column */}
            <div className="shrink-0 space-y-2 border-t border-border px-5 py-4">
              {isPublished ? (
                /* ── Published post footer actions ── */
                <div className="flex flex-wrap items-center gap-2">
                  {/* View on Instagram */}
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View on Instagram"
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View on Instagram
                    </a>
                  )}

                  {/* Copy caption */}
                  {post.caption && (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(post.caption)}
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy caption
                    </button>
                  )}

                  {/* Download media */}
                  {post.mediaUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        for (const url of post.mediaUrls) {
                          const a = document.createElement("a");
                          a.href = url;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          a.click();
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  )}

                  {/* Create Campaign */}
                  <button
                    type="button"
                    aria-label="Create campaign from this post"
                    onClick={handleCreateCampaign}
                    disabled={creatingCampaign}
                    className="flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {creatingCampaign ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Megaphone className="h-3.5 w-3.5" />
                    )}
                    {creatingCampaign ? "Creating campaign…" : "Create Campaign"}
                  </button>

                  {/* Delete */}
                  {confirmDelete ? (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[12px] text-danger">Delete post?</span>
                      <button
                        type="button"
                        onClick={() => { onDelete(post.id); onClose(); }}
                        className="rounded-lg bg-danger/10 border border-danger/30 px-2.5 py-1 text-[12px] font-semibold text-danger hover:bg-danger/20"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground-muted hover:text-foreground"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label="Delete post"
                      onClick={() => setConfirmDelete(true)}
                      className="ml-auto rounded-xl border border-border p-1.5 text-foreground-faint transition-colors hover:border-danger/30 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                /* ── Non-published footer actions (scheduled / draft) ── */
                <div className="flex flex-wrap items-center gap-2">
                  {/* Open in full editor */}
                  <button
                    type="button"
                    onClick={() => { onLoad(post); onClose(); }}
                    className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <FileEdit className="h-3.5 w-3.5" />
                    Open in editor
                  </button>

                  {/* Copy caption */}
                  {post.caption && (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(dialogCaption || post.caption)}
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy caption
                    </button>
                  )}

                  {/* Download media */}
                  {post.mediaUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        for (const url of post.mediaUrls) {
                          const a = document.createElement("a");
                          a.href = url;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          a.click();
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  )}

                  {/* Create Campaign (from a planned/draft post) */}
                  <button
                    type="button"
                    aria-label="Create campaign from this post"
                    onClick={handleCreateCampaign}
                    disabled={creatingCampaign}
                    className="flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-3 py-1.5 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {creatingCampaign ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Megaphone className="h-3.5 w-3.5" />
                    )}
                    {creatingCampaign ? "Creating campaign…" : "Create Campaign"}
                  </button>

                  {/* Mark as posted (manual) */}
                  {isManual && isDue && (
                    <button
                      type="button"
                      onClick={() => { onMarkPosted(post.id); onClose(); }}
                      className="flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-1.5 text-[12px] font-semibold text-warning transition-colors hover:bg-warning/20"
                    >
                      <CalendarCheck className="h-3.5 w-3.5" />
                      Mark posted
                    </button>
                  )}

                  {/* Publish now (auto mode only) */}
                  {!isManual && (
                    <>
                      {confirmPublishDialog ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] text-foreground-muted">Publish now?</span>
                          <button
                            type="button"
                            onClick={handlePublishDialog}
                            disabled={publishingDialog}
                            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {publishingDialog ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmPublishDialog(false)}
                            className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted hover:text-foreground"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmPublishDialog(true)}
                          className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-foreground transition-opacity hover:opacity-90"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Publish now
                        </button>
                      )}
                    </>
                  )}

                  {/* Cancel schedule */}
                  <button
                    type="button"
                    onClick={() => { onCancel(post.id); onClose(); }}
                    className="rounded-xl border border-border px-3 py-1.5 text-[12px] font-medium text-foreground-faint transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    Cancel schedule
                  </button>

                  {/* Delete */}
                  {confirmDelete ? (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-[12px] text-danger">Delete post?</span>
                      <button
                        type="button"
                        onClick={() => { onDelete(post.id); onClose(); }}
                        className="rounded-lg bg-danger/10 border border-danger/30 px-2.5 py-1 text-[12px] font-semibold text-danger hover:bg-danger/20"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground-muted hover:text-foreground"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label="Delete post"
                      onClick={() => setConfirmDelete(true)}
                      className="ml-auto rounded-xl border border-border p-1.5 text-foreground-faint transition-colors hover:border-danger/30 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              {!isPublished && campaignError && (
                <p className="flex items-center gap-1.5 text-[12px] text-danger">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {campaignError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScheduledCalendar — month grid view
// ---------------------------------------------------------------------------

function ScheduledCalendar({
  items,
  extras,
  onOpenPost,
}: {
  items: DraftRow[];
  extras: CalendarExtra[];
  onOpenPost: (id: string) => void;
}) {
  const [extraList, setExtraList] = useState<CalendarExtra[]>(extras);
  const [openExtra, setOpenExtra] = useState<CalendarExtra | null>(null);
  useEffect(() => setExtraList(extras), [extras]);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Determine the calendar date for a post: scheduledFor if scheduled, publishedAt if published
  function calendarDateFor(d: DraftRow): string | null {
    if (d.status === "scheduled" && d.scheduledFor) {
      const dt = new Date(d.scheduledFor);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
    if (d.status === "published" && d.publishedAt) {
      const dt = new Date(d.publishedAt);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
    return null;
  }

  // Group posts by local YYYY-MM-DD
  const postsByDay = useMemo(() => {
    const map: Record<string, DraftRow[]> = {};
    for (const d of items) {
      const key = calendarDateFor(d);
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    // Sort each day's posts by time asc (scheduled first, then published)
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const ta = a.scheduledFor
          ? new Date(a.scheduledFor).getTime()
          : a.publishedAt
          ? new Date(a.publishedAt).getTime()
          : 0;
        const tb = b.scheduledFor
          ? new Date(b.scheduledFor).getTime()
          : b.publishedAt
          ? new Date(b.publishedAt).getTime()
          : 0;
        return ta - tb;
      });
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Cross-source scheduled events (suggestions / repo / nested projects).
  const extrasByDay = useMemo(() => {
    const map: Record<string, CalendarExtra[]> = {};
    for (const e of extraList) {
      const dt = new Date(e.when);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      (map[key] ??= []).push(e);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => (a.when < b.when ? -1 : 1));
    }
    return map;
  }, [extraList]);

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  // Build the 6-week grid cells
  const gridDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay(); // 0=Sun
    const cells: Array<{ date: Date; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - startOffset + i);
      cells.push({ date: d, inMonth: d.getMonth() === month });
    }
    return cells;
  }, [year, month]);

  function prevMonth() {
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  function goToday() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    setCalendarMonth(d);
  }

  const monthLabel = calendarMonth.toLocaleString(undefined, { month: "long", year: "numeric" });
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = Date.now();
  const CHIP_LIMIT = 3;

  return (
    <div className="space-y-3">
      {/* Calendar nav header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={prevMonth}
          className="rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[160px] text-center text-sm font-semibold text-foreground tabular-nums">
          {monthLabel}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={nextMonth}
          className="rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goToday}
          className="ml-1 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          Today
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle"
            >
              {wd}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {gridDays.map(({ date, inMonth }, idx) => {
            const cellKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            const dayPosts = postsByDay[cellKey] ?? [];
            const dayExtras = extrasByDay[cellKey] ?? [];
            const extraSlots = Math.max(0, CHIP_LIMIT - dayPosts.length);
            const shownExtras = dayExtras.slice(0, extraSlots);
            const overflow = dayPosts.length + dayExtras.length - Math.min(dayPosts.length, CHIP_LIMIT) - shownExtras.length;
            const isToday = cellKey === todayKey;
            const isLastRow = idx >= 35;

            return (
              <div
                key={cellKey}
                className={`min-h-[80px] border-border p-1.5 ${
                  idx % 7 !== 6 ? "border-r" : ""
                } ${!isLastRow ? "border-b" : ""} ${
                  !inMonth ? "bg-surface-elevated/40" : ""
                }`}
              >
                {/* Day number */}
                <div className="mb-1 flex items-center justify-center">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] tabular-nums font-medium ${
                      isToday
                        ? "bg-accent text-accent-foreground"
                        : inMonth
                        ? "text-foreground"
                        : "text-foreground-faint"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                </div>

                {/* Post chips */}
                <div className="space-y-0.5">
                  {dayPosts.slice(0, CHIP_LIMIT).map((d) => {
                    const chipThumb = d.mediaUrls[0] ?? null;
                    const chipIsVideo = /\.(mp4|mov|webm)(\?|$)/i.test(chipThumb ?? "");
                    const chipIsPublished = d.status === "published";
                    const chipDue = !chipIsPublished && d.scheduledFor ? new Date(d.scheduledFor).getTime() <= now : false;
                    const chipManual = d.publishMode === "manual";
                    const chipDateIso = chipIsPublished ? d.publishedAt : d.scheduledFor;
                    const chipTime = chipDateIso
                      ? new Date(chipDateIso).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })
                      : "";
                    return (
                      <button
                        key={d.id}
                        type="button"
                        aria-label={`View ${chipIsPublished ? "published" : "scheduled"} post: ${d.caption?.slice(0, 40) ?? d.type}${chipTime ? ` at ${chipTime}` : ""}`}
                        onClick={() => onOpenPost(d.id)}
                        className={`flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-elevated ${
                          chipDue ? "ring-1 ring-warning/40" : ""
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="h-4 w-4 shrink-0 overflow-hidden rounded">
                          {chipThumb ? (
                            chipIsVideo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <video src={chipThumb} className="h-full w-full object-cover" muted />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={chipThumb} alt="" className="h-full w-full object-cover" />
                            )
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-surface-elevated">
                              <ImagePlus className="h-2.5 w-2.5 text-foreground-faint" />
                            </div>
                          )}
                        </div>
                        {/* Time */}
                        <span className="truncate text-[10px] tabular-nums text-foreground-muted leading-tight">
                          {chipTime}
                        </span>
                        {/* Status dot / check */}
                        {chipIsPublished ? (
                          <CheckCircle2
                            className="ml-auto h-3 w-3 shrink-0 text-success"
                            aria-label="Published"
                          />
                        ) : (
                          <span
                            className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
                              chipManual ? "bg-warning" : "bg-accent"
                            }`}
                            aria-label={chipManual ? "Manual" : "Auto"}
                          />
                        )}
                      </button>
                    );
                  })}
                  {shownExtras.map((e) => {
                    const eTime = new Date(e.when).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    });
                    const editable = e.kind === "suggestion" || e.kind === "repo";
                    const body = (
                      <>
                        <SocialBrandIcon platform={e.platform} className="h-3 w-3 shrink-0" />
                        <span className="truncate text-[10px] tabular-nums text-foreground-muted leading-tight">
                          {eTime}
                        </span>
                        <span className="ml-auto shrink-0 rounded bg-surface-elevated px-1 text-[8px] uppercase tracking-wide text-foreground-faint">
                          {e.kind === "instagram" ? e.projectSlug.slice(0, 4) : e.platform.slice(0, 4)}
                        </span>
                      </>
                    );
                    const label = `${e.platform} via ${e.kind} (${e.projectSlug}): ${e.title}`;
                    return editable ? (
                      <button
                        key={e.id}
                        type="button"
                        title={label}
                        onClick={() => setOpenExtra(e)}
                        className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-elevated"
                      >
                        {body}
                      </button>
                    ) : (
                      <div key={e.id} title={label} className="flex w-full items-center gap-1 rounded-md px-1 py-0.5">
                        {body}
                      </div>
                    );
                  })}
                  {overflow > 0 && (
                    <button
                      type="button"
                      aria-label={`${overflow} more posts on this day`}
                      onClick={() => dayPosts[CHIP_LIMIT] && onOpenPost(dayPosts[CHIP_LIMIT].id)}
                      className="w-full rounded-md px-1 py-0.5 text-left text-[10px] font-medium text-foreground-subtle transition-colors hover:bg-surface-elevated"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openExtra && (
        <ScheduledPostDialog
          event={openExtra}
          activeSlug=""
          onClose={() => setOpenExtra(null)}
          onChanged={(newWhen) =>
            setExtraList((prev) =>
              newWhen
                ? prev.map((x) => (x.id === openExtra.id ? { ...x, when: newWhen } : x))
                : prev.filter((x) => x.id !== openExtra.id),
            )
          }
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-foreground-faint">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent" />
          Auto-publish
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-warning" />
          Manual
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded ring-1 ring-warning/60" />
          Due
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" />
          Published
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled section
// ---------------------------------------------------------------------------

function ScheduledSection({
  items,
  onLoad,
  onCancel,
  onMarkPosted,
  onOpenPost,
}: {
  items: DraftRow[];
  onLoad: (d: DraftRow) => void;
  onCancel: (id: string) => void;
  onMarkPosted: (id: string) => void;
  onOpenPost: (id: string) => void;
}) {
  const now = Date.now();

  if (items.length === 0)
    return (
      <p className="text-sm text-foreground-faint">
        No scheduled posts yet.
      </p>
    );

  return (
    <div className="space-y-2">
      {items.map((d) => {
        const thumb = d.mediaUrls[0] ?? null;
        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(thumb ?? "");
        const isDue = d.scheduledFor ? new Date(d.scheduledFor).getTime() <= now : false;
        const isManual = d.publishMode === "manual";

        // Build "what to set in-app" checklist for manual+due posts
        const appTasks: string[] = [];
        if (d.musicNote) appTasks.push(`Music: ${d.musicNote}`);
        if (d.brandedPartner) appTasks.push(`Paid partnership: @${d.brandedPartner}`);
        if (d.locationNote) appTasks.push(`Location: ${d.locationNote}`);

        return (
          <div
            key={d.id}
            className={`rounded-xl border p-3 transition-colors ${
              isManual && isDue
                ? "border-warning/40 bg-warning/5"
                : "border-border bg-surface hover:border-border-strong"
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Thumbnail — click to open dialog */}
              <button
                type="button"
                aria-label="Open post dialog"
                onClick={() => onOpenPost(d.id)}
                className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                {thumb ? (
                  isVideo ? (
                    <video src={thumb} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImagePlus className="h-4 w-4 text-foreground-faint" />
                  </div>
                )}
              </button>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
                    {d.type}
                  </span>
                  {/* Mode chip */}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      isManual
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-accent-border bg-accent-bg text-accent"
                    }`}
                  >
                    {isManual ? "Manual" : "Auto"}
                  </span>
                  {d.scheduledFor && (
                    <span className="text-[11px] tabular-nums text-foreground-muted">
                      {isManual && isDue ? (
                        <span className="font-semibold text-warning">Ready — post manually</span>
                      ) : isManual ? (
                        `Reminder set for ${formatLocalDatetime(d.scheduledFor)}`
                      ) : (
                        `Auto-publishes ${formatLocalDatetime(d.scheduledFor)}`
                      )}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenPost(d.id)}
                  className="mt-0.5 w-full text-left text-[13px] text-foreground-muted hover:text-foreground truncate"
                >
                  {d.caption || <span className="text-foreground-faint italic">No caption</span>}
                </button>

                {/* Manual+due: in-app checklist */}
                {isManual && isDue && appTasks.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {appTasks.map((task) => (
                      <li key={task} className="flex items-start gap-1.5 text-[11px] text-warning">
                        <span className="mt-0.5">•</span>
                        <span>Set in Instagram app: {task}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onLoad(d)}
                className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-accent transition-colors hover:bg-accent-bg"
              >
                Load
              </button>
              <button
                type="button"
                onClick={() => onOpenPost(d.id)}
                className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                View
              </button>

              {isManual && isDue && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (d.caption) navigator.clipboard.writeText(d.caption);
                    }}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                    Copy caption
                  </button>
                  {d.mediaUrls.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        for (const url of d.mediaUrls) {
                          const a = document.createElement("a");
                          a.href = url;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          a.click();
                        }
                      }}
                      className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      <Download className="h-3 w-3" />
                      Download media
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onMarkPosted(d.id)}
                    className="flex items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1 text-[12px] font-semibold text-warning transition-colors hover:bg-warning/20"
                  >
                    <CalendarCheck className="h-3 w-3" />
                    Mark as posted
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onCancel(d.id)}
                className="ml-auto rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-faint transition-colors hover:border-border-strong hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drafts strip
// ---------------------------------------------------------------------------

function DraftStrip({
  drafts,
  onLoad,
  onDelete,
}: {
  drafts: DraftRow[];
  onLoad: (d: DraftRow) => void;
  onDelete: (id: string) => void;
}) {
  if (drafts.length === 0) {
    return (
      <p className="text-sm text-foreground-faint">
        No saved drafts yet — save one to see it here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        const urls = d.mediaUrls;
        const thumb = urls[0] ?? null;
        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(thumb ?? "");
        return (
          <div
            key={d.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong"
          >
            {/* Thumbnail */}
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-elevated">
              {thumb ? (
                isVideo ? (
                  <video
                    src={thumb}
                    className="h-full w-full object-cover"
                    muted
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImagePlus className="h-4 w-4 text-foreground-faint" />
                </div>
              )}
              {urls.length > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-surface/80 px-1 text-[9px] font-bold text-foreground tabular-nums">
                  {urls.length}
                </span>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
                  {d.type}
                </span>
                {statusBadge(d.status)}
                {d.aspectRatio && (
                  <span className="text-[10px] tabular-nums text-foreground-faint">
                    {d.aspectRatio}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-foreground-muted">
                {d.caption || <span className="text-foreground-faint italic">No caption</span>}
              </p>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onLoad(d)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-bg"
              >
                Load
              </button>
              <button
                type="button"
                aria-label="Delete draft"
                onClick={() => onDelete(d.id)}
                className="rounded-lg p-1.5 text-foreground-faint transition-colors hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline tag-username input — shown near the pin click location
// ---------------------------------------------------------------------------

function TagUsernameInput({
  onSave,
  onCancel,
}: {
  onSave: (username: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (val.trim()) onSave(val.trim());
    } else if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent-border bg-surface-elevated px-3 py-2">
      <Tag className="h-3.5 w-3.5 shrink-0 text-accent" />
      <input
        ref={inputRef}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="@username"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
      />
      <button
        type="button"
        onClick={() => { if (val.trim()) onSave(val.trim()); }}
        className="rounded bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20"
      >
        Add
      </button>
      <button type="button" onClick={onCancel} className="text-foreground-faint hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step-flow helpers
// ---------------------------------------------------------------------------

/** Compute the ordered list of steps to show, given the current post type. */
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PostCreator({
  agentName,
  igHandle,
  cardStyles = [],
  brandName = "",
  brandAccent = "#a3e635",
  spotStudio = false,
}: {
  agentName: string;
  igHandle: string;
  cardStyles?: ("holo" | "pixel" | "gold" | "bounty" | "skatecard")[];
  brandName?: string;
  brandAccent?: string;
  /** SkateHive: the design Studio defaults to the "Skate Spot Found!" template. */
  spotStudio?: boolean;
}) {
  // ── View state ──────────────────────────────────────────────────────────
  const [viewTab, setViewTab] = useState<ViewTab>("create");
  const [studioMode, setStudioMode] = useState<"design" | "video">("design");
  const [stepId, setStepId] = useState<StepId>("type");
  const [scheduledView, setScheduledView] = useState<"calendar" | "list">("calendar");
  const [dialogPostId, setDialogPostId] = useState<string | null>(null);

  // ── Post state ───────────────────────────────────────────────────────────
  const [postType, setPostType] = useState<PostType>("IMAGE");
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [caption, setCaption] = useState("");
  const [topic, setTopic] = useState("");
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

  // Prefill from a "Take action" hand-off (Morning Briefing → post): seed the
  // caption once on mount, then clear the stash so a reload starts blank.
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem("portal:post-draft");
      if (draft) { setCaption(draft); sessionStorage.removeItem("portal:post-draft"); }
    } catch { /* sessionStorage unavailable */ }
  }, []);
  const [loadedStatus, setLoadedStatus] = useState<DraftRow["status"] | null>(null);
  const [loadedPermalink, setLoadedPermalink] = useState<string | null>(null);

  // Base fields
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [aspectTouched, setAspectTouched] = useState(false);
  // When media has an intrinsic, baked-in aspect (a Studio/Figma export or any
  // video), the format is decided by the media — not a re-pickable crop. We
  // lock it to the real ratio and skip the "format" step so the user isn't
  // asked to choose again, and the preview obeys the actual exported aspect.
  const [aspectLocked, setAspectLocked] = useState(false);
  // Preview crop mode. Fill (cover) simulates the feed crop for manually-picked
  // ratios; Fit (contain) shows the true exported frame. Default to Fit when the
  // media carries a baked-in aspect so the preview never lies about cropping.
  const [previewFit, setPreviewFit] = useState<"cover" | "contain">("cover");
  // Reset the fit default when the lock flips (baked-in aspect → Fit), using the
  // render-time "adjust state on prop change" pattern so a manual toggle still
  // sticks until the media changes again.
  const [prevAspectLocked, setPrevAspectLocked] = useState(aspectLocked);
  if (prevAspectLocked !== aspectLocked) {
    setPrevAspectLocked(aspectLocked);
    setPreviewFit(aspectLocked ? "contain" : "cover");
  }
  const toggleFit = () =>
    setPreviewFit((f) => (f === "cover" ? "contain" : "cover"));
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [collabInput, setCollabInput] = useState("");
  const [firstComment, setFirstComment] = useState("");

  // Manual-only notes
  const [musicNote, setMusicNote] = useState("");
  const [brandedPartner, setBrandedPartner] = useState("");
  const [locationNote, setLocationNote] = useState("");

  // REELS cover — custom image (cover_url) wins over a frame offset (thumb_offset)
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [thumbOffsetMs, setThumbOffsetMs] = useState<number | null>(null);

  // User tags (IMAGE only)
  const [userTags, setUserTags] = useState<UserTag[]>([]);
  const [taggingActive, setTaggingActive] = useState(false);
  const [pendingTag, setPendingTag] = useState<{ x: number; y: number } | null>(null);

  // Schedule picker
  const [scheduleValue, setScheduleValue] = useState("");
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [schedulePending, startScheduleTransition] = useTransition();

  // Drafts
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);

  // UI states
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [genPending, startGenTransition] = useTransition();
  const [improvePending, startImproveTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [publishPending, startPublishTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<
    | { ok: true; permalink?: string; firstCommentPosted?: boolean }
    | { ok: false; error: string }
    | null
  >(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // "Edit prompt" UI for the AI actions: which action's dropdown is open, and
  // the custom-prompt editor (the edited text is sent verbatim instead of the
  // default prompt).
  const [aiMenuOpen, setAiMenuOpen] = useState<"generate" | "improve" | null>(null);
  const [promptEditor, setPromptEditor] = useState<{ action: "generate" | "improve"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Step animation direction (used for CSS transitions)
  const [stepDir, setStepDir] = useState<"forward" | "back">("forward");
  const [stepAnimKey, setStepAnimKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const stepContentRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Derived: requiresManual
  // ---------------------------------------------------------------------------
  const requiresManual = !!(musicNote.trim() || brandedPartner.trim() || locationNote.trim());

  const manualReasons: string[] = [];
  if (musicNote.trim()) manualReasons.push("music");
  if (brandedPartner.trim()) manualReasons.push("paid partnership");
  if (locationNote.trim()) manualReasons.push("location");

  // ---------------------------------------------------------------------------
  // Load drafts on mount
  // ---------------------------------------------------------------------------
  const [calendarExtras, setCalendarExtras] = useState<CalendarExtra[]>([]);
  useEffect(() => {
    listDrafts()
      .then((res) => {
        if (res.ok) setDrafts(res.drafts);
      })
      .finally(() => setDraftsLoading(false));
    // Non-Instagram + nested-project scheduled posts for the calendar.
    void listCalendarExtras().then((res) => {
      if (res.ok) setCalendarExtras(res.events);
    });
  }, []);

  // Studio seeding sets postType + uploads together — the type-reset effect
  // below must skip exactly that one transition.
  const studioSeedRef = useRef(false);

  // The actually-visible step sequence: drops "format" when the aspect is
  // locked to the media (Studio/Figma export or video) so there's no redundant
  // crop re-prompt.
  const visibleSteps = (pt: PostType = postType): StepId[] => {
    const seq = computeSteps(pt);
    return aspectLocked ? seq.filter((s) => s !== "format") : seq;
  };

  // Reset uploads when type changes (keep caption)
  useEffect(() => {
    if (studioSeedRef.current) {
      studioSeedRef.current = false;
      return;
    }
    setUploads([]);
    setUploadError(null);
    setUserTags([]);
    resetCover();
    setTaggingActive(false);
    setPendingTag(null);
    setAspectLocked(false); // fresh manual media — crop is choosable again
    if (postType === "REELS") {
      setAspectRatio("9:16");
      setAspectTouched(true);
    } else if (!aspectTouched) {
      setAspectRatio("1:1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postType]);

  // Sync step to valid sequence when postType OR the lock changes (locking
  // removes "format", so if we're sitting on it, move on).
  useEffect(() => {
    const seq = visibleSteps(postType);
    if (!seq.includes(stepId)) {
      setStepId(seq[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postType, aspectLocked]);

  // Focus first focusable element when step changes
  useEffect(() => {
    const el = stepContentRef.current?.querySelector<HTMLElement>(
      "button, input, textarea, select, [tabindex]:not([tabindex='-1'])"
    );
    el?.focus();
  }, [stepId]);

  // ---------------------------------------------------------------------------
  // Step navigation helpers
  // ---------------------------------------------------------------------------

  function navigate(targetId: StepId, dir: "forward" | "back") {
    setStepDir(dir);
    setStepAnimKey((k) => k + 1);
    setStepId(targetId);
  }

  function goNext() {
    const seq = visibleSteps(postType);
    const idx = seq.indexOf(stepId);
    if (idx < seq.length - 1) navigate(seq[idx + 1], "forward");
  }

  function goPrev() {
    const seq = visibleSteps(postType);
    const idx = seq.indexOf(stepId);
    if (idx > 0) navigate(seq[idx - 1], "back");
  }

  function jumpTo(id: StepId) {
    const seq = visibleSteps(postType);
    const cur = seq.indexOf(stepId);
    const target = seq.indexOf(id);
    navigate(id, target > cur ? "forward" : "back");
  }

  // ---------------------------------------------------------------------------
  // Media validation gate for Continue on the "media" step
  // ---------------------------------------------------------------------------
  const mediaReady = (() => {
    if (postType === "IMAGE") return uploads.length === 1;
    if (postType === "CAROUSEL") return uploads.length >= 2 && uploads.length <= 10;
    if (postType === "REELS") return uploads.length === 1;
    return false;
  })();

  // ---------------------------------------------------------------------------
  // Refresh helper
  // ---------------------------------------------------------------------------
  async function refreshDrafts() {
    const refreshed = await listDrafts();
    if (refreshed.ok) setDrafts(refreshed.drafts);
  }

  // ---------------------------------------------------------------------------
  // File upload
  // ---------------------------------------------------------------------------

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);

    const maxCount = postType === "CAROUSEL" ? 10 : 1;
    const remaining = maxCount - uploads.length;
    const toUpload = Array.from(files).slice(0, remaining);

    for (const file of toUpload) {
      const isVideo = /^video\//.test(file.type);
      const isImage = /^image\//.test(file.type);
      if (postType === "IMAGE" && !isImage) {
        setUploadError("Single Image posts take an image — switch to Reel for video.");
        return;
      }
      if (postType === "REELS" && !isVideo) {
        setUploadError("Reels take a video — switch to Single Image or Carousel for photos.");
        return;
      }
      if (!isImage && !isVideo) {
        setUploadError(`Unsupported file type: ${file.type || file.name}`);
        return;
      }
      setUploadingIndex(uploads.length);
      const preview = URL.createObjectURL(file);

      // Preferred path: signed-URL handshake, then the browser uploads straight
      // to Pinata — required for videos, which blow past the server-action body
      // limit. Falls back to the original through-the-server route if signing
      // is unavailable (older Pinata plans, etc.). The server-action calls can
      // THROW on transport errors (stale build, body too large) rather than
      // return {ok:false} — without the catch the spinner never clears.
      let result: { ok: true; url: string } | { ok: false; error: string };
      try {
        result = await uploadMediaDirect(file);
        if (!result.ok) {
          const formData = new FormData();
          formData.set("file", file);
          result = await uploadPostMedia(formData);
        }
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      if (!result.ok) {
        setUploadError(result.error);
        URL.revokeObjectURL(preview);
        setUploadingIndex(null);
        return;
      }

      // Measure image aspect ratio so we can warn on carousel mismatches
      let aspect: number | undefined;
      if (!isVideo) {
        aspect = await new Promise<number | undefined>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
          img.onerror = () => resolve(undefined);
          img.src = preview;
        });
      }

      setUploads((prev) => {
        const next = [...prev, { url: result.url, previewUrl: preview, isVideo, aspect }];
        if (next.length === 1 && aspect !== undefined) {
          setAspectTouched((touched) => {
            if (!touched) {
              setAspectRatio(snapToFeedRatio(aspect as number));
            }
            return touched;
          });
        }
        return next;
      });
      setUploadingIndex(null);
    }
  }

  function removeUpload(index: number) {
    setUploads((prev) => {
      if (prev[index]?.isVideo) resetCover();
      URL.revokeObjectURL(prev[index]?.previewUrl ?? "");
      return prev.filter((_, i) => i !== index);
    });
  }

  // ---------------------------------------------------------------------------
  // REELS cover
  // ---------------------------------------------------------------------------

  function resetCover() {
    setCoverUrl(null);
    setThumbOffsetMs(null);
  }

  // Uploader handed to ReelCoverPicker — direct→Pinata with the server fallback.
  async function coverUploader(
    file: File,
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    let result = await uploadMediaDirect(file);
    if (!result.ok) {
      const fd = new FormData();
      fd.set("file", file);
      result = await uploadPostMedia(fd);
    }
    return result;
  }

  function moveUpload(index: number, dir: -1 | 1) {
    setUploads((prev) => {
      const next = [...prev];
      const swap = index + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap], next[index]];
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Collaborator chips
  // ---------------------------------------------------------------------------

  function addCollaborator(raw: string) {
    const username = raw.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, "");
    if (!username) return;
    if (collaborators.includes(username)) return;
    if (collaborators.length >= 3) return;
    setCollaborators((prev) => [...prev, username]);
  }

  function handleCollabKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addCollaborator(collabInput);
      setCollabInput("");
    } else if (e.key === "Backspace" && !collabInput && collaborators.length > 0) {
      setCollaborators((prev) => prev.slice(0, -1));
    }
  }

  function removeCollaborator(username: string) {
    setCollaborators((prev) => prev.filter((u) => u !== username));
  }

  // ---------------------------------------------------------------------------
  // User tags (IMAGE only)
  // ---------------------------------------------------------------------------

  function handleTagClick(x: number, y: number) {
    if (userTags.length >= 20) return;
    setPendingTag({ x, y });
  }

  function handleTagSave(username: string) {
    if (!pendingTag) return;
    const clean = username.trim().replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._]/g, "");
    if (!clean) { setPendingTag(null); return; }
    setUserTags((prev) => {
      if (prev.some((t) => t.username === clean)) return prev; // no dups
      return [...prev, { username: clean, x: pendingTag.x, y: pendingTag.y }];
    });
    setPendingTag(null);
  }

  function handleTagCancel() {
    setPendingTag(null);
  }

  function removeTag(username: string) {
    setUserTags((prev) => prev.filter((t) => t.username !== username));
  }

  // ---------------------------------------------------------------------------
  // AI caption
  // ---------------------------------------------------------------------------

  /** Open the custom-prompt editor pre-filled with the default prompt. */
  function openPromptEditor(action: "generate" | "improve") {
    setAiMenuOpen(null);
    setPromptEditor({
      action,
      text:
        action === "generate"
          ? buildGenerateCaptionPrompt({ agentName, topic, type: postType })
          : buildImproveCaptionPrompt({ agentName, caption, type: postType }),
    });
  }

  function handleGenerateCaption() {
    const override = promptEditor?.action === "generate" ? promptEditor.text : undefined;
    if (override !== undefined ? !override.trim() : !topic.trim()) return;
    setAiError(null);
    startGenTransition(async () => {
      const res = await generateCaption({ topic, type: postType, promptOverride: override });
      if (res.ok) {
        setCaption(res.text);
      } else {
        setAiError(res.error);
      }
    });
  }

  function handleImproveCaption() {
    const override = promptEditor?.action === "improve" ? promptEditor.text : undefined;
    if (override !== undefined ? !override.trim() : !caption.trim()) return;
    setAiError(null);
    startImproveTransition(async () => {
      const res = await improveCaption({ caption, type: postType, promptOverride: override });
      if (res.ok) {
        setCaption(res.text);
      } else {
        setAiError(res.error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Studio → post: upload the rendered cards and seed the wizard
  // ---------------------------------------------------------------------------

  async function handleUseInPost(files: File[], legenda: string, aspectHint?: number) {
    const capped = files.slice(0, 10); // Instagram carousel hard limit
    const seeded: UploadState[] = [];
    // Real media probing — the Studio video editor sends videos through here
    // too, so kind and aspect can't be assumed (a video previewed as <img>
    // renders nothing).
    const probeAspect = (url: string, isVideo: boolean): Promise<number> =>
      new Promise((resolve) => {
        if (isVideo) {
          const v = document.createElement("video");
          v.onloadedmetadata = () => resolve(v.videoWidth / v.videoHeight || 1080 / 1350);
          v.onerror = () => resolve(1080 / 1350);
          v.src = url;
        } else {
          const i = new Image();
          i.onload = () => resolve(i.naturalWidth / i.naturalHeight || 1080 / 1350);
          i.onerror = () => resolve(1080 / 1350);
          i.src = url;
        }
      });
    for (const file of capped) {
      let result = await uploadMediaDirect(file);
      if (!result.ok) {
        const fd = new FormData();
        fd.set("file", file);
        result = await uploadPostMedia(fd);
      }
      if (!result.ok) throw new Error(result.error);
      const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
      const previewUrl = URL.createObjectURL(file);
      // Prefer the caller's known export aspect — probing video metadata can
      // fail and fall back to the wrong ratio (the "9:16 shows as 4:5" bug).
      const aspect = aspectHint ?? (await probeAspect(previewUrl, isVideo));
      seeded.push({ url: result.url, previewUrl, isVideo, aspect });
    }

    const hasVideo = seeded.some((u) => u.isVideo);
    const nextType: PostType =
      seeded.length > 1 ? "CAROUSEL" : hasVideo ? "REELS" : "IMAGE";
    if (nextType !== postType) studioSeedRef.current = true;
    setPostType(nextType);
    setUploads(seeded);
    if (legenda.trim()) setCaption(legenda.trim());
    // Pick the allowed ratio closest to the actual media.
    const mediaRatio = seeded[0]?.aspect ?? 1080 / 1350;
    const RATIOS: [string, number][] = [
      ["1:1", 1],
      ["4:5", 0.8],
      ["1.91:1", 1.91],
      ["9:16", 9 / 16],
    ];
    const nearest = RATIOS.reduce((best, r) =>
      Math.abs(r[1] - mediaRatio) < Math.abs(best[1] - mediaRatio) ? r : best,
    );
    setAspectRatio(nearest[0] as typeof aspectRatio);
    setAspectTouched(true);
    // The export already baked in its aspect — lock it so the user isn't asked
    // to re-pick a crop, and the preview obeys the real exported ratio.
    setAspectLocked(true);
    setUserTags([]);
    resetCover();
    setCurrentDraftId(null);
    setLoadedStatus(null);
    setLoadedPermalink(null);
    setPublishResult(null);
    setUploadError(null);
    setViewTab("create");
    // Land on media (the Reel cover/thumbnail picker lives there). The format
    // step is skipped — the export's aspect is already locked in.
    navigate("media", "forward");
  }

  // ---------------------------------------------------------------------------
  // Gather all draft fields
  // ---------------------------------------------------------------------------

  function gatherDraftParams() {
    return {
      type: postType,
      caption,
      mediaUrls: uploads.map((u) => u.url),
      firstComment,
      collaborators,
      aspectRatio,
      userTags: postType === "IMAGE" ? userTags : [],
      coverUrl: postType === "REELS" ? coverUrl : null,
      thumbOffsetMs: postType === "REELS" ? thumbOffsetMs : null,
      musicNote,
      brandedPartner,
      locationNote,
    };
  }

  // ---------------------------------------------------------------------------
  // Save draft
  // ---------------------------------------------------------------------------

  function handleSaveDraft() {
    startSaveTransition(async () => {
      setSaveMsg(null);
      const params = gatherDraftParams();

      let result: { ok: boolean; error?: string; id?: string };
      if (currentDraftId) {
        result = await updateDraft(currentDraftId, params);
      } else {
        const res = await createDraft(params);
        if (res.ok) setCurrentDraftId(res.id);
        result = res;
      }

      if (!result.ok) {
        setSaveMsg(`Error: ${result.error}`);
      } else {
        setSaveMsg("Saved!");
        await refreshDrafts();
        setTimeout(() => setSaveMsg(null), 2000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Load draft into composer
  // ---------------------------------------------------------------------------

  function handleLoadDraft(d: DraftRow) {
    setPostType(d.type);
    setCaption(d.caption);
    setCurrentDraftId(d.id);
    setLoadedStatus(d.status);
    setLoadedPermalink(d.permalink);
    setFirstComment(d.firstComment ?? "");
    setCollaborators(d.collaborators ?? []);
    setCollabInput("");
    setUserTags(d.userTags ?? []);
    setCoverUrl(d.coverUrl ?? null);
    setThumbOffsetMs(d.thumbOffsetMs ?? null);
    setMusicNote(d.musicNote ?? "");
    setBrandedPartner(d.brandedPartner ?? "");
    setLocationNote(d.locationNote ?? "");
    setTaggingActive(false);
    setPendingTag(null);

    if (d.scheduledFor) {
      setScheduleValue(toDatetimeLocalValue(new Date(d.scheduledFor)));
    } else {
      setScheduleValue("");
    }
    setScheduleMsg(null);

    if (d.aspectRatio) {
      setAspectRatio(d.aspectRatio as AspectRatio);
      setAspectTouched(true);
    } else if (d.type === "REELS") {
      setAspectRatio("9:16");
      setAspectTouched(true);
    } else {
      setAspectRatio("1:1");
      setAspectTouched(false);
    }

    setUploads(
      d.mediaUrls.map((url) => ({
        url,
        previewUrl: url,
        isVideo: /\.(mp4|mov|webm)(\?|$)/i.test(url),
      })),
    );
    setPublishResult(null);
    setSaveMsg(null);

    // Jump to Review step after loading
    setViewTab("create");
    navigate("review", "forward");
  }

  // Clear the composer to start a fresh post.
  function handleNewPost() {
    uploads.forEach((u) => {
      if (u.previewUrl.startsWith("blob:")) URL.revokeObjectURL(u.previewUrl);
    });
    setPostType("IMAGE");
    setUploads([]);
    setCaption("");
    setTopic("");
    setCurrentDraftId(null);
    setLoadedStatus(null);
    setLoadedPermalink(null);
    setPublishResult(null);
    setSaveMsg(null);
    setAiError(null);
    setUploadError(null);
    setAspectRatio("1:1");
    setAspectTouched(false);
    setCollaborators([]);
    setCollabInput("");
    setFirstComment("");
    setUserTags([]);
    resetCover();
    setMusicNote("");
    setBrandedPartner("");
    setLocationNote("");
    setTaggingActive(false);
    setPendingTag(null);
    setScheduleValue("");
    setScheduleMsg(null);
    setViewTab("create");
    navigate("type", "back");
  }

  // ---------------------------------------------------------------------------
  // Delete draft
  // ---------------------------------------------------------------------------

  function handleDeleteDraft(id: string) {
    startSaveTransition(async () => {
      await deleteDraft(id);
      if (currentDraftId === id) {
        setCurrentDraftId(null);
        setUploads([]);
        setCaption("");
        setTopic("");
      }
      await refreshDrafts();
    });
  }

  // ---------------------------------------------------------------------------
  // Publish (immediate)
  // ---------------------------------------------------------------------------

  function handlePublish() {
    setPublishResult(null);
    startPublishTransition(async () => {
      const params = gatherDraftParams();
      let id = currentDraftId;
      if (!id) {
        const created = await createDraft(params);
        if (!created.ok) {
          setPublishResult({ ok: false, error: created.error ?? "Failed to save draft" });
          setConfirmPublish(false);
          return;
        }
        id = created.id!;
        setCurrentDraftId(id);
      } else {
        await updateDraft(id, params);
      }
      const res = await publishDraft(id);
      if (res.ok) {
        setPublishResult({
          ok: true,
          permalink: res.permalink,
          firstCommentPosted: res.firstCommentPosted,
        });
        setLoadedStatus("published");
        setLoadedPermalink(res.permalink ?? null);
      } else {
        setPublishResult({ ok: false, error: res.error });
      }
      setConfirmPublish(false);
      await refreshDrafts();
    });
  }

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  function handleSchedule() {
    setScheduleMsg(null);
    if (!scheduleValue) {
      setScheduleMsg("Pick a date and time first.");
      return;
    }
    const when = new Date(scheduleValue);
    if (when <= new Date()) {
      setScheduleMsg("Scheduled time must be in the future.");
      return;
    }

    startScheduleTransition(async () => {
      const params = gatherDraftParams();
      let id = currentDraftId;
      if (!id) {
        const created = await createDraft(params);
        if (!created.ok) {
          setScheduleMsg(`Error: ${created.error}`);
          return;
        }
        id = created.id!;
        setCurrentDraftId(id);
      } else {
        await updateDraft(id, params);
      }
      const res = await scheduleDraft(id, when.toISOString());
      if (res.ok) {
        setScheduleMsg(
          requiresManual
            ? `Reminder set for ${formatLocalDatetime(when.toISOString())} — post manually in the Instagram app.`
            : `Scheduled for ${formatLocalDatetime(when.toISOString())} — will auto-publish.`,
        );
        setLoadedStatus("scheduled");
        await refreshDrafts();
      } else {
        setScheduleMsg(`Error: ${res.error}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Unschedule (cancel) a scheduled post
  // ---------------------------------------------------------------------------

  function handleCancelScheduled(id: string) {
    startSaveTransition(async () => {
      await unscheduleDraft(id);
      if (currentDraftId === id) setLoadedStatus("draft");
      await refreshDrafts();
    });
  }

  // ---------------------------------------------------------------------------
  // Mark as posted (manual posts)
  // ---------------------------------------------------------------------------

  function handleMarkPosted(id: string) {
    startSaveTransition(async () => {
      await markPosted(id);
      if (currentDraftId === id) {
        setLoadedStatus("published");
      }
      await refreshDrafts();
    });
  }

  // ---------------------------------------------------------------------------
  // Copy caption
  // ---------------------------------------------------------------------------

  async function handleCopyCaption() {
    if (!caption) return;
    await navigator.clipboard.writeText(caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const captionLen = caption.length;
  const captionOver = captionLen > CAPTION_MAX;
  const commentLen = firstComment.length;
  const commentOver = commentLen > COMMENT_MAX;

  const carouselAspectMismatch =
    postType === "CAROUSEL" &&
    (() => {
      const aspects = uploads.map((u) => u.aspect).filter((a): a is number => typeof a === "number");
      if (aspects.length < 2) return false;
      return Math.max(...aspects) - Math.min(...aspects) > 0.05;
    })();

  const alreadyPublished = loadedStatus === "published";
  const isScheduled = loadedStatus === "scheduled";

  const canPublish = (() => {
    if (alreadyPublished) return false;
    if (captionOver || commentOver) return false;
    if (uploadingIndex !== null) return false;
    if (!mediaReady) return false;
    if (requiresManual) return false;
    return true;
  })();

  const canSchedule = (() => {
    if (alreadyPublished) return false;
    if (captionOver || commentOver) return false;
    if (uploadingIndex !== null) return false;
    if (!mediaReady) return false;
    return true;
  })();

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const multipleFiles = postType === "CAROUSEL";
  const previewAspectClass = aspectToClass(aspectRatio);

  const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
    { value: "1:1", label: "Square 1:1" },
    { value: "4:5", label: "Portrait 4:5" },
    { value: "1.91:1", label: "Landscape 1.91:1" },
  ];

  const scheduledDrafts = drafts.filter((d) => d.status === "scheduled");
  const publishedDrafts = drafts.filter((d) => d.status === "published");
  const nonScheduledDrafts = drafts.filter(
    (d) => d.status !== "scheduled" && d.status !== "published",
  );
  // Calendar plots both scheduled (by scheduledFor) and published (by publishedAt)
  const calendarPosts = drafts.filter(
    (d) =>
      (d.status === "scheduled" && d.scheduledFor) ||
      (d.status === "published" && d.publishedAt),
  );

  // Current step sequence for the selected post type
  const stepSeq = visibleSteps(postType);
  const stepIndex = stepSeq.indexOf(stepId);
  const totalSteps = stepSeq.length;

  // Whether tagging is active on the preview (only on tag step)
  const previewTaggingActive = taggingActive && stepId === "tags" && postType === "IMAGE";

  // ---------------------------------------------------------------------------
  // Step content renderer
  // ---------------------------------------------------------------------------

  function renderStepContent() {
    switch (stepId) {
      // ── Step 1: Type ──────────────────────────────────────────────────────
      case "type":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">What are you posting?</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Choose a post format to get started.
              </p>
            </div>
            <div className="grid gap-3">
              {POST_TYPES.map((pt) => (
                <button
                  key={pt.value}
                  type="button"
                  aria-current={postType === pt.value ? "true" : undefined}
                  onClick={() => {
                    setPostType(pt.value);
                    // Auto-advance (Typeform feel)
                    const seq = computeSteps(pt.value);
                    navigate(seq[1], "forward");
                  }}
                  className={`flex flex-col items-start gap-0.5 rounded-2xl border px-5 py-4 text-left transition-all duration-150 ${
                    postType === pt.value
                      ? "border-accent-border bg-accent-bg ring-2 ring-accent/30"
                      : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <span className="text-[15px] font-semibold text-foreground">{pt.label}</span>
                  <span className="text-[13px] text-foreground-muted">{pt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        );

      // ── Step 2: Media ─────────────────────────────────────────────────────
      case "media":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                Add your{" "}
                {postType === "REELS" ? "video" : postType === "CAROUSEL" ? "media" : "photo"}.
              </h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                {postType === "IMAGE" && "Upload exactly 1 image."}
                {postType === "CAROUSEL" && `Upload 2–10 photos or videos — mix them freely. You can reorder them. (${uploads.length}/10)`}
                {postType === "REELS" && "Upload exactly 1 video."}
              </p>
            </div>

            {/* Thumbnails */}
            {uploads.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {uploads.map((u, i) => (
                  <div
                    key={i}
                    className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-elevated"
                  >
                    {u.isVideo ? (
                      <video src={u.previewUrl} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.previewUrl} alt="" className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      aria-label="Remove media"
                      onClick={() => removeUpload(i)}
                      className="absolute right-1 top-1 rounded-full bg-surface/80 p-0.5 backdrop-blur hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {postType === "CAROUSEL" && (
                      <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-0.5">
                        <button
                          type="button"
                          aria-label="Move earlier"
                          disabled={i === 0}
                          onClick={() => moveUpload(i, -1)}
                          className="rounded bg-surface/80 p-0.5 disabled:opacity-30"
                        >
                          <ArrowUp className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move later"
                          disabled={i === uploads.length - 1}
                          onClick={() => moveUpload(i, 1)}
                          className="rounded bg-surface/80 p-0.5 disabled:opacity-30"
                        >
                          <ArrowDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )}
                    {uploadingIndex === i && (
                      <div className="absolute inset-0 flex items-center justify-center bg-surface/60 backdrop-blur-sm">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add file button */}
            {(postType !== "IMAGE" || uploads.length < 1) &&
              (postType !== "REELS" || uploads.length < 1) &&
              (postType !== "CAROUSEL" || uploads.length < 10) && (
                <button
                  type="button"
                  onClick={() => {
                    if (postType === "REELS") videoInputRef.current?.click();
                    else fileInputRef.current?.click();
                  }}
                  disabled={uploadingIndex !== null}
                  className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {uploadingIndex !== null ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {uploadingIndex !== null
                    ? "Uploading…"
                    : postType === "REELS"
                    ? "Add video"
                    : postType === "CAROUSEL"
                    ? "Add photo / video"
                    : "Add image"}
                </button>
              )}

            <input
              ref={fileInputRef}
              type="file"
              accept={postType === "CAROUSEL" ? "image/*,video/*" : "image/*"}
              multiple={multipleFiles}
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(e) => handleFiles(e.target.files)}
            />

            {uploadError && (
              <p className="flex items-center gap-1.5 text-sm text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {uploadError}
              </p>
            )}

            {/* Reel cover picker — frame scrubber or custom image */}
            {postType === "REELS" && uploads[0]?.isVideo && (
              <ReelCoverPicker
                videoUrl={uploads[0].previewUrl}
                coverUrl={coverUrl}
                thumbOffsetMs={thumbOffsetMs}
                onCoverUrl={setCoverUrl}
                onThumbOffset={setThumbOffsetMs}
                uploadImage={coverUploader}
              />
            )}

            {carouselAspectMismatch && (
              <p className="flex items-center gap-1.5 text-sm text-warning">
                <AlertCircle className="h-4 w-4 shrink-0" />
                These images have different aspect ratios — Instagram crops a carousel to one shape,
                so some may be cut off.
              </p>
            )}

            {/* Hard gate hint */}
            {!mediaReady && (
              <p className="text-xs text-foreground-faint">
                {postType === "CAROUSEL"
                  ? `Add at least 2 images to continue (${uploads.length} added).`
                  : "Upload your media to continue."}
              </p>
            )}
          </div>
        );

      // ── Step 3: Format ────────────────────────────────────────────────────
      case "format":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Choose the crop.</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                The aspect ratio affects how your post looks in the feed. The auto-detected ratio is
                highlighted.
              </p>
            </div>
            <div className="grid gap-3">
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-current={aspectRatio === opt.value ? "true" : undefined}
                  onClick={() => {
                    setAspectRatio(opt.value);
                    setAspectTouched(true);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-all duration-150 ${
                    aspectRatio === opt.value
                      ? "border-accent-border bg-accent-bg ring-2 ring-accent/30"
                      : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <span className="text-[15px] font-semibold text-foreground">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        );

      // ── Step 4: Caption ───────────────────────────────────────────────────
      case "caption":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Write your caption.</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Optional — you can skip this and add it later. Use Cmd/Ctrl + Enter in the textarea
                or the Continue button to advance.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground-muted">Caption</span>
                <span
                  className={`text-xs tabular-nums ${
                    captionOver ? "text-danger" : captionLen > 1800 ? "text-warning" : "text-foreground-faint"
                  }`}
                >
                  {captionLen.toLocaleString()}/{CAPTION_MAX.toLocaleString()}
                </span>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    goNext();
                  }
                }}
                placeholder="Write your caption…"
                rows={6}
                className={`w-full resize-y rounded-xl border bg-surface-elevated px-4 py-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  captionOver ? "border-danger" : "border-border"
                }`}
              />
              {captionOver && (
                <p className="text-sm text-danger">
                  Caption exceeds {CAPTION_MAX} character limit by {captionLen - CAPTION_MAX}.
                </p>
              )}
            </div>

            {/* AI caption assist */}
            <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
                AI caption — {agentName} voice
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Topic or brief (e.g. 'post about skate aesthetics')"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGenerateCaption();
                  }}
                />
                <div className="relative flex shrink-0">
                  <button
                    type="button"
                    onClick={handleGenerateCaption}
                    disabled={genPending || (promptEditor?.action === "generate" ? !promptEditor.text.trim() : !topic.trim())}
                    className="flex items-center gap-1.5 rounded-l-lg bg-accent-bg px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {genPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Draft with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiMenuOpen(aiMenuOpen === "generate" ? null : "generate")}
                    aria-label="Draft with AI options"
                    className="flex items-center rounded-r-lg border-l border-accent-border bg-accent-bg px-1.5 py-2 text-accent transition-colors hover:bg-accent/20"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {aiMenuOpen === "generate" && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAiMenuOpen(null)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-surface-elevated py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => openPromptEditor("generate")}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                        >
                          <FileEdit className="h-3.5 w-3.5" />
                          Edit prompt
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="relative inline-flex">
                <button
                  type="button"
                  onClick={handleImproveCaption}
                  disabled={improvePending || (promptEditor?.action === "improve" ? !promptEditor.text.trim() : !caption.trim())}
                  className="flex items-center gap-1.5 rounded-l-lg border border-border px-3 py-2 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {improvePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Improve caption
                </button>
                <button
                  type="button"
                  onClick={() => setAiMenuOpen(aiMenuOpen === "improve" ? null : "improve")}
                  aria-label="Improve caption options"
                  className="flex items-center rounded-r-lg border border-l-0 border-border px-1.5 py-2 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                {aiMenuOpen === "improve" && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setAiMenuOpen(null)} />
                    <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-border bg-surface-elevated py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => openPromptEditor("improve")}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                      >
                        <FileEdit className="h-3.5 w-3.5" />
                        Edit prompt
                      </button>
                    </div>
                  </>
                )}
              </div>
              {promptEditor && (
                <div className="space-y-2 rounded-lg border border-border bg-surface-elevated p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                      Custom prompt · {promptEditor.action === "generate" ? "Draft with AI" : "Improve caption"}
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => openPromptEditor(promptEditor.action)}
                        className="text-[12px] text-foreground-muted transition-colors hover:text-foreground"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromptEditor(null)}
                        className="text-[12px] text-foreground-muted transition-colors hover:text-foreground"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={promptEditor.text}
                    onChange={(e) => setPromptEditor({ ...promptEditor, text: e.target.value })}
                    rows={10}
                    className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <p className="text-[11px] text-foreground-faint">
                    Sent to the agent exactly as written when you hit{" "}
                    {promptEditor.action === "generate" ? "Draft with AI" : "Improve caption"} — the
                    topic/caption fields above are no longer substituted in. Reset re-fills it from
                    their current values.
                  </p>
                </div>
              )}
              {aiError && (
                <p className="flex items-center gap-1.5 text-sm text-danger">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {aiError}
                </p>
              )}
            </div>
          </div>
        );

      // ── Step 5: First comment ─────────────────────────────────────────────
      case "firstComment":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Add a first comment?</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Optional — great for hashtags. Auto-posted immediately after publishing.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground-muted">First comment</span>
                <span
                  className={`text-xs tabular-nums ${
                    commentOver ? "text-danger" : commentLen > 1800 ? "text-warning" : "text-foreground-faint"
                  }`}
                >
                  {commentLen.toLocaleString()}/{COMMENT_MAX.toLocaleString()}
                </span>
              </div>
              <textarea
                value={firstComment}
                onChange={(e) => setFirstComment(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    goNext();
                  }
                }}
                placeholder="Auto-posted as the first comment after publishing — great for hashtags."
                rows={3}
                className={`w-full resize-y rounded-xl border bg-surface-elevated px-4 py-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                  commentOver ? "border-danger" : "border-border"
                }`}
              />
              {commentOver && (
                <p className="text-sm text-danger">
                  Comment exceeds {COMMENT_MAX} character limit by {commentLen - COMMENT_MAX}.
                </p>
              )}
            </div>
          </div>
        );

      // ── Step 6: Tags (IMAGE only) ─────────────────────────────────────────
      case "tags":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Tag accounts in the photo.</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Optional. Tap the photo on the right to place a tag pin, then type the username.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setTaggingActive((a) => !a);
                setPendingTag(null);
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                taggingActive
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface-elevated text-foreground-muted hover:text-foreground"
              }`}
            >
              <Tag className="h-4 w-4" />
              {taggingActive ? "Done tagging — click Continue" : "Start tagging"}
            </button>

            {taggingActive && (
              <p className="text-[13px] text-foreground-faint">
                Click anywhere on the preview image to drop a pin, then type the account username.
              </p>
            )}

            {/* Pending tag username input */}
            {pendingTag && (
              <TagUsernameInput onSave={handleTagSave} onCancel={handleTagCancel} />
            )}

            {/* Saved tags list */}
            {userTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {userTags.map((t) => (
                  <span
                    key={t.username}
                    className="flex items-center gap-1 rounded-full border border-accent-border bg-accent-bg px-2.5 py-1 text-[12px] font-medium text-accent"
                  >
                    @{t.username}
                    <button
                      type="button"
                      aria-label={`Remove tag @${t.username}`}
                      onClick={() => removeTag(t.username)}
                      className="ml-0.5 text-accent/60 hover:text-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {userTags.length === 0 && !taggingActive && (
              <p className="text-sm text-foreground-faint">No tags yet.</p>
            )}
          </div>
        );

      // ── Step 7: Collaborators ─────────────────────────────────────────────
      case "collaborators":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Invite collaborators?</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Optional — up to 3. They must accept in the Instagram app for the collab tag to
                appear.
              </p>
            </div>

            <div>
              <div
                className={`flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-3 py-2 focus-within:ring-2 focus-within:ring-accent/40 ${
                  collaborators.length >= 3 ? "opacity-60" : ""
                }`}
              >
                {collaborators.map((u) => (
                  <span
                    key={u}
                    className="flex items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 text-[12px] font-medium text-accent"
                  >
                    @{u}
                    <button
                      type="button"
                      aria-label={`Remove @${u}`}
                      onClick={() => removeCollaborator(u)}
                      className="ml-0.5 text-accent/60 hover:text-accent"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {collaborators.length < 3 && (
                  <input
                    type="text"
                    value={collabInput}
                    onChange={(e) => setCollabInput(e.target.value)}
                    onKeyDown={handleCollabKeyDown}
                    onBlur={() => {
                      if (collabInput.trim()) {
                        addCollaborator(collabInput);
                        setCollabInput("");
                      }
                    }}
                    placeholder={collaborators.length === 0 ? "@username" : ""}
                    className="min-w-[80px] flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
                  />
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-foreground-faint">
                Press Enter or comma to add.
              </p>
            </div>
          </div>
        );

      // ── Step 8: More options ──────────────────────────────────────────────
      case "more":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Anything else?</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Optional. These are notes for in-app settings that can&apos;t be set via the API.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
                In-app only — set in Instagram after posting
              </p>

              {/* Music — REELS only */}
              {postType === "REELS" && (
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                    <Music className="h-3.5 w-3.5" />
                    Music / audio
                    <span className="text-foreground-faint">(added in the Instagram app)</span>
                  </label>
                  <input
                    type="text"
                    value={musicNote}
                    onChange={(e) => setMusicNote(e.target.value)}
                    placeholder="e.g. 'Thrasher - Way' — note for yourself"
                    className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              )}

              {/* Paid partnership — all types */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                  <Handshake className="h-3.5 w-3.5" />
                  Paid partnership
                  <span className="text-foreground-faint">(label set in the Instagram app)</span>
                </label>
                <input
                  type="text"
                  value={brandedPartner}
                  onChange={(e) => setBrandedPartner(e.target.value)}
                  placeholder="@brand — paid partnership label"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              {/* Location — all types */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                  <MapPin className="h-3.5 w-3.5" />
                  Location
                  <span className="text-foreground-faint">(not available via API)</span>
                </label>
                <input
                  type="text"
                  value={locationNote}
                  onChange={(e) => setLocationNote(e.target.value)}
                  placeholder="Location name — add it in the Instagram app"
                  className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              {/* Manual-mode banner */}
              {requiresManual && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm text-warning">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This post uses {manualReasons.join(" / ")}, which Instagram only allows in the
                    app. You can schedule it and we&apos;ll remind you to post it manually.
                  </span>
                </div>
              )}
            </div>
          </div>
        );

      // ── Step 9: Review & publish ──────────────────────────────────────────
      case "review":
        return (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Review &amp; publish.</h2>
              <p className="mt-1.5 text-sm text-foreground-muted">
                Everything looks good? Publish now or schedule for later.
              </p>
            </div>

            {/* Summary rows */}
            <div className="rounded-xl border border-border bg-surface divide-y divide-border">
              <SummaryRow label="Type" value={postType} />
              <SummaryRow
                label="Media"
                value={`${uploads.length} file${uploads.length !== 1 ? "s" : ""}`}
              />
              <SummaryRow label="Aspect ratio" value={aspectRatio} />
              <SummaryRow
                label="Caption"
                value={
                  caption
                    ? caption.length > 80
                      ? caption.slice(0, 80) + "…"
                      : caption
                    : "—"
                }
              />
              {firstComment && (
                <SummaryRow
                  label="First comment"
                  value={firstComment.length > 60 ? firstComment.slice(0, 60) + "…" : firstComment}
                />
              )}
              {postType === "IMAGE" && userTags.length > 0 && (
                <SummaryRow
                  label="Tags"
                  value={userTags.map((t) => `@${t.username}`).join(", ")}
                />
              )}
              {collaborators.length > 0 && (
                <SummaryRow
                  label="Collaborators"
                  value={collaborators.map((u) => `@${u}`).join(", ")}
                />
              )}
              {musicNote && <SummaryRow label="Music note" value={musicNote} />}
              {brandedPartner && (
                <SummaryRow label="Paid partnership" value={`@${brandedPartner}`} />
              )}
              {locationNote && <SummaryRow label="Location" value={locationNote} />}
            </div>

            {/* Statuses */}
            {alreadyPublished && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>This post was already published.</span>
                {loadedPermalink && (
                  <a href={loadedPermalink} target="_blank" rel="noopener noreferrer" className="underline">
                    View on Instagram
                  </a>
                )}
              </div>
            )}

            {isScheduled && !alreadyPublished && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                <Clock className="h-4 w-4 shrink-0" />
                <span>This post is scheduled. Load it to edit or cancel.</span>
              </div>
            )}

            {requiresManual && !alreadyPublished && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This post uses {manualReasons.join(" / ")} — must be posted manually in the
                  Instagram app. Auto-publish is disabled.
                </span>
              </div>
            )}

            {/* Publish result */}
            {publishResult && (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  publishResult.ok
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-danger/30 bg-danger/10 text-danger"
                }`}
              >
                {publishResult.ok ? (
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Published!{" "}
                      {publishResult.permalink && (
                        <a
                          href={publishResult.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          View on Instagram
                        </a>
                      )}
                    </span>
                    {firstComment.trim() && publishResult.firstCommentPosted === false && (
                      <span className="flex items-center gap-2 text-warning">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Post published, but the first comment couldn&apos;t be posted — add it
                        manually.
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {publishResult.error}
                  </span>
                )}
              </div>
            )}

            {/* Schedule picker */}
            {!alreadyPublished && (
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                  <Clock className="h-3.5 w-3.5" />
                  Schedule
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={scheduleValue}
                    min={toDatetimeLocalValue(new Date())}
                    onChange={(e) => setScheduleValue(e.target.value)}
                    className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent-border"
                  />
                  <button
                    type="button"
                    onClick={handleSchedule}
                    disabled={!canSchedule || schedulePending || !scheduleValue}
                    title={
                      requiresManual
                        ? "Schedule for manual posting in the Instagram app"
                        : "Auto-publish at the selected time"
                    }
                    className="flex items-center gap-1.5 rounded-xl border border-accent-border bg-accent-bg px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {schedulePending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                    {requiresManual ? "Schedule for manual posting" : "Schedule"}
                  </button>
                </div>
                {scheduleMsg && (
                  <p
                    className={`flex items-center gap-1.5 text-sm ${
                      scheduleMsg.startsWith("Error") ? "text-danger" : "text-foreground-muted"
                    }`}
                  >
                    {scheduleMsg.startsWith("Error") ? (
                      <AlertCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    )}
                    {scheduleMsg}
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCaption}
                disabled={!caption}
                className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied!" : "Copy caption"}
              </button>

              {uploads.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    for (const u of uploads) {
                      const a = document.createElement("a");
                      a.href = u.url;
                      a.target = "_blank";
                      a.rel = "noopener noreferrer";
                      a.click();
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                  Download media
                </button>
              )}

              {/* Publish now */}
              {!alreadyPublished && (
                <button
                  type="button"
                  disabled={!canPublish || publishPending}
                  onClick={() => setConfirmPublish(true)}
                  title={
                    requiresManual
                      ? "Cannot auto-publish: this post has music, paid partnership, or location that must be set in the Instagram app."
                      : undefined
                  }
                  className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {publishPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Publish to Instagram
                </button>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Tiny summary row helper used on the Review step
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* -------------------------------------------------------------------- */}
      {/* Top view-switcher tab bar                                             */}
      {/* -------------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex rounded-xl border border-border bg-surface-elevated p-1 gap-1">
          <TabButton
            active={viewTab === "create"}
            onClick={() => setViewTab("create")}
            icon={<FileEdit className="h-3.5 w-3.5" />}
            label="Create"
          />
          <TabButton
            active={viewTab === "studio"}
            onClick={() => setViewTab("studio")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="Studio"
          />
          <TabButton
            active={viewTab === "drafts"}
            onClick={() => setViewTab("drafts")}
            icon={<LayoutList className="h-3.5 w-3.5" />}
            label={`Drafts${nonScheduledDrafts.length > 0 ? ` (${nonScheduledDrafts.length})` : ""}`}
          />
          <TabButton
            active={viewTab === "calendar"}
            onClick={() => setViewTab("calendar")}
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={`Calendar${scheduledDrafts.length > 0 ? ` (${scheduledDrafts.length})` : ""}`}
          />
        </div>

        {/* Persistent controls — always visible in Create view */}
        {viewTab === "create" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewPost}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              New post
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savePending || alreadyPublished}
              className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              {savePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saveMsg ?? (currentDraftId ? "Update draft" : "Save draft")}
            </button>
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Studio view — vendored reelflip-studio design tool                    */}
      {/* -------------------------------------------------------------------- */}
      {viewTab === "studio" && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
            <button
              type="button"
              onClick={() => setViewTab("create")}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Post Creator
            </button>

            <div className="flex flex-wrap items-center gap-3">
              {/* Format-first: pick the post format — the studio + export follow it. */}
              <div className="inline-flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Formato</span>
                <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
                  {(["1:1", "4:5", "9:16", "1.91:1"] as AspectRatio[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => { setAspectRatio(fmt); setAspectTouched(true); }}
                      className={`rounded-md px-2 py-1 font-medium transition-colors ${
                        aspectRatio === fmt ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Design (artwork) vs Video (timeline editor) */}
              <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs">
                {(["design", "video"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setStudioMode(m)}
                    className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                      studioMode === m ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-foreground-subtle">
              Studio
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {studioMode === "design" ? (
              <>
                {aspectRatio !== "4:5" && (
                  <div className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[11px] text-warning">
                    Os cards de design são 4:5. Para {aspectRatio}, use o <button type="button" onClick={() => setStudioMode("video")} className="font-semibold underline">Video</button> (ou volte o formato para 4:5).
                  </div>
                )}
                <StudioEditor onUseInPost={handleUseInPost} spotMode={spotStudio} />
              </>
            ) : (
              <StudioVideoEditor
                onUseInPost={handleUseInPost}
                cardStyles={cardStyles}
                brandName={brandName}
                brandAccent={brandAccent}
                aspect={ratioToAspectKey(aspectRatio)}
                onAspectChange={(a) => { setAspectRatio(aspectKeyToRatio(a)); setAspectTouched(true); }}
              />
            )}
          </div>
          <StudioToaster />
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Drafts view                                                           */}
      {/* -------------------------------------------------------------------- */}
      {viewTab === "drafts" && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Saved drafts</h2>
          {draftsLoading ? (
            <p className="flex items-center gap-2 text-sm text-foreground-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading drafts…
            </p>
          ) : (
            <DraftStrip
              drafts={nonScheduledDrafts}
              onLoad={handleLoadDraft}
              onDelete={handleDeleteDraft}
            />
          )}
        </section>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Calendar view (formerly Scheduled)                                   */}
      {/* -------------------------------------------------------------------- */}
      {viewTab === "calendar" && (
        <section className="space-y-4">
          {/* Header + view toggle */}
          <div className="flex items-center gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-accent" />
              Calendar
            </h2>
            {/* Segmented toggle: Calendar | List */}
            <div className="ml-auto flex rounded-lg border border-border bg-surface-elevated p-0.5 gap-0.5">
              <button
                type="button"
                aria-current={scheduledView === "calendar" ? "true" : undefined}
                onClick={() => setScheduledView("calendar")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  scheduledView === "calendar"
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Calendar
              </button>
              <button
                type="button"
                aria-current={scheduledView === "list" ? "true" : undefined}
                onClick={() => setScheduledView("list")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  scheduledView === "list"
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                <LayoutList className="h-3.5 w-3.5" />
                List
              </button>
            </div>
          </div>

          {draftsLoading ? (
            <p className="flex items-center gap-2 text-sm text-foreground-faint">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : scheduledView === "calendar" ? (
            <ScheduledCalendar
              items={calendarPosts}
              extras={calendarExtras}
              onOpenPost={(id) => setDialogPostId(id)}
            />
          ) : (
            <div className="space-y-6">
              {/* Scheduled list */}
              <ScheduledSection
                items={scheduledDrafts}
                onLoad={handleLoadDraft}
                onCancel={handleCancelScheduled}
                onMarkPosted={handleMarkPosted}
                onOpenPost={(id) => setDialogPostId(id)}
              />

              {/* Posted section */}
              {publishedDrafts.length > 0 && (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    Posted
                  </h3>
                  <div className="space-y-2">
                    {publishedDrafts
                      .slice()
                      .sort((a, b) => {
                        const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                        const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                        return tb - ta; // most recent first
                      })
                      .map((d) => {
                        const thumb = d.mediaUrls[0] ?? null;
                        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(thumb ?? "");
                        return (
                          <div
                            key={d.id}
                            className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong"
                          >
                            {/* Thumbnail — click to open dialog */}
                            <button
                              type="button"
                              aria-label="View published post"
                              onClick={() => setDialogPostId(d.id)}
                              className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-accent/40"
                            >
                              {thumb ? (
                                isVideo ? (
                                  <video src={thumb} className="h-full w-full object-cover" muted />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                                )
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <ImagePlus className="h-4 w-4 text-foreground-faint" />
                                </div>
                              )}
                              <CheckCircle2 className="absolute bottom-0.5 right-0.5 h-3 w-3 text-success drop-shadow" />
                            </button>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-medium uppercase tracking-wider text-foreground-subtle">
                                  {d.type}
                                </span>
                                {d.publishedAt && (
                                  <span className="text-[11px] tabular-nums text-foreground-muted">
                                    {formatLocalDatetime(d.publishedAt)}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setDialogPostId(d.id)}
                                className="mt-0.5 w-full text-left text-[13px] text-foreground-muted hover:text-foreground truncate"
                              >
                                {d.caption || <span className="text-foreground-faint italic">No caption</span>}
                              </button>
                            </div>

                            {/* Actions */}
                            <div className="flex shrink-0 items-center gap-1">
                              {d.permalink && (
                                <a
                                  href={d.permalink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="View on Instagram"
                                  className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Instagram
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => setDialogPostId(d.id)}
                                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent-bg"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Post dialog                                                            */}
      {/* -------------------------------------------------------------------- */}
      {dialogPostId && (() => {
        const dialogPost = drafts.find((d) => d.id === dialogPostId);
        if (!dialogPost) return null;
        return (
          <PostDialog
            post={dialogPost}
            igHandle={igHandle}
            onClose={() => setDialogPostId(null)}
            onLoad={handleLoadDraft}
            onCancel={handleCancelScheduled}
            onMarkPosted={handleMarkPosted}
            onDelete={handleDeleteDraft}
            onRefresh={refreshDrafts}
          />
        );
      })()}

      {/* -------------------------------------------------------------------- */}
      {/* Create view — stepped composer + sticky preview                       */}
      {/* -------------------------------------------------------------------- */}
      {viewTab === "create" && (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
          {/* ── LEFT: stepped flow ── */}
          <div className="min-w-0 space-y-5">
            {/* Progress bar + step dots */}
            <div className="space-y-3">
              {/* Thin progress bar */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
                />
              </div>

              {/* Step indicator row */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {stepSeq.map((sid, idx) => {
                  const isCompleted = idx < stepIndex;
                  const isCurrent = idx === stepIndex;
                  const labels: Record<StepId, string> = {
                    type: "Type",
                    media: "Media",
                    format: "Format",
                    caption: "Caption",
                    firstComment: "Comment",
                    tags: "Tags",
                    collaborators: "Collabs",
                    more: "More",
                    review: "Review",
                  };
                  return (
                    <button
                      key={sid}
                      type="button"
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`Go to step ${idx + 1}: ${labels[sid]}`}
                      onClick={() => {
                        if (isCompleted || isCurrent) jumpTo(sid);
                      }}
                      disabled={!isCompleted && !isCurrent}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ${
                        isCurrent
                          ? "bg-accent text-accent-foreground"
                          : isCompleted
                          ? "bg-accent-bg text-accent hover:bg-accent/20"
                          : "text-foreground-faint disabled:cursor-not-allowed"
                      }`}
                    >
                      <span className="tabular-nums">{idx + 1}</span>
                      <span className="hidden sm:inline">{labels[sid]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step content with fade+translate animation */}
            <div
              ref={stepContentRef}
              key={`step-${stepAnimKey}`}
              className={`step-enter-${stepDir}`}
            >
              {renderStepContent()}
            </div>

            {/* Step footer: Back + Continue */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIndex === 0}
                className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-0"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              {stepId !== "review" && (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={stepId === "media" && !mediaReady}
                  className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* ── RIGHT: sticky IG preview ── */}
          <div className="space-y-3 xl:sticky xl:top-6 xl:self-start">
            <h2 className="text-center text-sm font-semibold text-foreground-subtle">Preview</h2>
            <IgPreview
              handle={igHandle}
              caption={caption}
              uploads={uploads}
              type={postType}
              aspectClass={previewAspectClass}
              collaborators={collaborators}
              userTags={userTags}
              taggingActive={previewTaggingActive}
              onTagClick={handleTagClick}
              onRemoveTag={removeTag}
              fit={previewFit}
              onToggleFit={toggleFit}
            />
            {stepId === "tags" && postType === "IMAGE" && (
              <p className="text-center text-[11px] text-foreground-faint">
                {taggingActive
                  ? "Click on the photo above to drop a tag pin"
                  : "Enable tagging on the left to start"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Confirm publish modal                                                 */}
      {/* -------------------------------------------------------------------- */}
      {confirmPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Publish to Instagram?</h3>
            <p className="mt-2 text-sm text-foreground-muted">
              This will post immediately to{" "}
              <span className="font-medium text-foreground">{igHandle}</span>. You cannot undo a
              published post from this portal.
            </p>
            {collaborators.length > 0 && (
              <p className="mt-2 text-sm text-foreground-muted">
                Collaborators ({collaborators.map((u) => `@${u}`).join(", ")}) will need to accept
                the invite in the Instagram app.
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmPublish(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishPending}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
              >
                {publishPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Publish now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="w-28 shrink-0 text-[12px] font-medium text-foreground-subtle">{label}</span>
      <span className="min-w-0 text-[13px] text-foreground">{value}</span>
    </div>
  );
}
