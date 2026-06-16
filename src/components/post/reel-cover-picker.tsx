"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, AlertCircle } from "lucide-react";

// Reel cover/thumbnail picker — frame scrubber or custom image. Extracted from
// the Post Creator so the Lab (and anything else) reuses the exact same UX. The
// caller owns coverUrl + thumbOffsetMs (persisted) and provides the uploader.
export function ReelCoverPicker({
  videoUrl,
  coverUrl,
  thumbOffsetMs,
  onCoverUrl,
  onThumbOffset,
  uploadImage,
}: {
  videoUrl: string;
  coverUrl: string | null;
  thumbOffsetMs: number | null;
  onCoverUrl: (url: string | null) => void;
  onThumbOffset: (ms: number | null) => void;
  uploadImage: (file: File) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function scrub(ms: number | null) {
    onThumbOffset(ms);
    const v = videoRef.current;
    if (v) v.currentTime = (ms ?? 0) / 1000;
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      setError("Cover must be an image.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const result = await uploadImage(file);
      if (result.ok) {
        onCoverUrl(result.url);
        onThumbOffset(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
        Reel cover
      </p>
      {coverUrl ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverUrl}
              alt="Custom cover"
              className="h-44 w-[100px] rounded-lg border border-border object-cover"
            />
          </div>
          <button
            type="button"
            onClick={() => onCoverUrl(null)}
            className="text-center text-[12px] text-foreground-muted transition-colors hover:text-danger"
          >
            Remove custom cover
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex w-full justify-center">
            <video
              ref={videoRef}
              src={videoUrl}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) setDurationMs(Math.floor(d * 1000));
              }}
              className="h-44 w-[100px] rounded-lg border border-border bg-surface-elevated object-cover"
            />
          </div>
          <input
            type="range"
            min={0}
            max={durationMs ?? 0}
            step={100}
            value={thumbOffsetMs ?? 0}
            disabled={!durationMs}
            onChange={(e) => scrub(Number(e.target.value))}
            className="w-full accent-current text-accent"
            aria-label="Cover frame position"
          />
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-foreground-muted">
              {thumbOffsetMs === null
                ? "Cover: first frame. Drag the slider to pick a different frame."
                : `Cover frame at ${(thumbOffsetMs / 1000).toFixed(1)}s`}
            </p>
            {thumbOffsetMs !== null && (
              <button
                type="button"
                onClick={() => scrub(null)}
                className="text-[11px] text-foreground-muted underline transition-colors hover:text-foreground"
              >
                Reset to first frame
              </button>
            )}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        {uploading ? "Uploading cover…" : coverUrl ? "Replace custom cover" : "Upload custom cover image"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => onFile(e.target.files)}
      />
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <p className="text-[11px] text-foreground-faint">
        The profile grid shows a centered crop of this cover — Instagram&apos;s API has no separate
        grid-crop control, so use a 9:16 cover with the subject centered.
      </p>
    </div>
  );
}
