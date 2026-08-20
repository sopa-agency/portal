"use client";

import { useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  X,
} from "lucide-react";
import type { PostType, UserTag } from "@/app/actions/post-creator";
import type { UploadState } from "@/lib/post-aspect";

// Instagram post preview card — the real one the Post Creator uses, extracted
// so the Lab (and any future composer) shows an identical, accurate IG preview.
export function IgPreview({
  handle,
  caption,
  uploads,
  type,
  aspectClass,
  collaborators,
  userTags,
  taggingActive,
  onTagClick,
  onRemoveTag,
  fit,
  onToggleFit,
}: {
  handle: string;
  caption: string;
  uploads: UploadState[];
  type: PostType;
  aspectClass: string;
  collaborators: string[];
  userTags: UserTag[];
  taggingActive: boolean;
  onTagClick: (x: number, y: number) => void;
  onRemoveTag: (username: string) => void;
  fit: "cover" | "contain";
  onToggleFit: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const mediaRef = useRef<HTMLDivElement>(null);

  // Reset the carousel to the first slide whenever the media set changes, using
  // the render-time "adjust state on prop change" pattern instead of an effect
  // (which would trigger a cascading re-render and trips react-hooks lint).
  const [prevUploadCount, setPrevUploadCount] = useState(uploads.length);
  if (prevUploadCount !== uploads.length) {
    setPrevUploadCount(uploads.length);
    setSlideIndex(0);
  }

  const current = uploads[slideIndex];
  const collabLine =
    collaborators.length > 0
      ? `with ${collaborators.map((u) => `@${u}`).join(", ")}`
      : null;

  function handleMediaClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!taggingActive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onTagClick(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
  }

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-bold uppercase text-accent">
          {handle.replace("@", "").slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-foreground">
            {handle.startsWith("@") ? handle : `@${handle}`}
            {collabLine && (
              <span className="ml-1 font-normal text-foreground-muted">{collabLine}</span>
            )}
          </p>
          <p className="text-[11px] text-foreground-faint">
            {type === "REELS" ? "Reel" : type === "CAROUSEL" ? "Carousel" : "Photo"}
          </p>
        </div>
      </div>

      {/* Media */}
      <div
        ref={mediaRef}
        className={`relative w-full bg-surface-elevated ${aspectClass} ${taggingActive && type === "IMAGE" ? "cursor-crosshair" : ""}`}
        onClick={handleMediaClick}
      >
        {current ? (
          current.isVideo ? (
            <video
              src={current.previewUrl}
              className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
              muted
              loop
              playsInline
              autoPlay
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.previewUrl}
              alt="Post preview"
              className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImagePlus className="h-8 w-8 text-foreground-faint" />
          </div>
        )}

        {/* Fill / Fit toggle — Fill (cover) simulates the feed crop, Fit
            (contain) shows the true exported frame uncropped. */}
        {current && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFit();
            }}
            className="absolute right-2 top-2 z-10 rounded-full bg-surface/85 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow backdrop-blur hover:bg-surface"
          >
            {fit === "contain" ? "Fit" : "Fill"}
          </button>
        )}

        {/* User tag pins — IMAGE only */}
        {type === "IMAGE" &&
          userTags.map((tag) => (
            <div
              key={tag.username}
              className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
              style={{ left: `${tag.x * 100}%`, top: `${tag.y * 100}%` }}
            >
              <div className="flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-[10px] font-semibold text-foreground shadow backdrop-blur">
                @{tag.username}
                <button
                  type="button"
                  aria-label={`Remove tag @${tag.username}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTag(tag.username);
                  }}
                  className="ml-0.5 text-foreground-muted hover:text-danger"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
              {/* Pin pointer */}
              <div className="h-1.5 w-0.5 bg-surface/90" />
            </div>
          ))}

        {/* Carousel navigation */}
        {type === "CAROUSEL" && uploads.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              disabled={slideIndex === 0}
              onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-1 backdrop-blur disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              disabled={slideIndex === uploads.length - 1}
              onClick={() => setSlideIndex((i) => Math.min(uploads.length - 1, i + 1))}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-1 backdrop-blur disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4 text-foreground" />
            </button>
            {/* Dots */}
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {uploads.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to slide ${i + 1}`}
                  onClick={() => setSlideIndex(i)}
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${i === slideIndex ? "bg-accent" : "bg-foreground/30"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 px-3 py-2">
        <Heart className="h-5 w-5 text-foreground-muted" />
        <MessageCircle className="h-5 w-5 text-foreground-muted" />
        <Share2 className="h-5 w-5 text-foreground-muted" />
        <Bookmark className="ml-auto h-5 w-5 text-foreground-muted" />
      </div>

      {/* Caption */}
      <div className="px-3 pb-4">
        <p className="text-[13px] leading-relaxed text-foreground">
          <span className="font-semibold">
            {handle.startsWith("@") ? handle.slice(1) : handle}
          </span>{" "}
          {caption ? (
            caption.split("\n").map((line, i) => (
              <span key={i}>
                {line}
                {i < caption.split("\n").length - 1 && <br />}
              </span>
            ))
          ) : (
            <span className="text-foreground-faint">Caption will appear here…</span>
          )}
        </p>
      </div>
    </div>
  );
}
