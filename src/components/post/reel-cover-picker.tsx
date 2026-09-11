"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, AlertCircle } from "lucide-react";

// Reel cover/thumbnail picker — frame scrubber or custom image. Extracted from
// the Post Creator so the Lab, the scheduled-post dialog and the cross-post
// curation reuse the exact same UX. The caller owns coverUrl + thumbOffsetMs
// (persisted) and provides the uploader.

const STRINGS = {
  en: {
    title: "Reel cover",
    customAlt: "Custom cover",
    remove: "Remove custom cover",
    firstFrame: "Cover: first frame. Drag the slider to pick a different frame.",
    frameAt: (s: string) => `Cover frame at ${s}s`,
    reset: "Reset to first frame",
    mustBeImage: "Cover must be an image.",
    uploading: "Uploading cover…",
    replace: "Replace custom cover",
    upload: "Upload custom cover image",
    slider: "Cover frame position",
    hint:
      "The profile grid shows a centered crop of this cover — Instagram's API has no separate grid-crop control, so use a 9:16 cover with the subject centered.",
  },
  pt: {
    title: "Capa do reel",
    customAlt: "Capa escolhida",
    remove: "Remover capa escolhida",
    firstFrame: "Capa: primeiro frame. Arraste para escolher outro momento do vídeo.",
    frameAt: (s: string) => `Capa no segundo ${s}`,
    reset: "Voltar ao primeiro frame",
    mustBeImage: "A capa precisa ser uma imagem.",
    uploading: "Enviando capa…",
    replace: "Trocar a capa",
    upload: "Enviar uma imagem de capa",
    slider: "Momento do vídeo usado como capa",
    hint:
      "No grid do perfil o Instagram mostra um recorte centralizado dessa capa — a API não tem controle separado do recorte, então use uma capa 9:16 com o assunto no centro.",
  },
} as const;

export function ReelCoverPicker({
  videoUrl,
  coverUrl,
  thumbOffsetMs,
  onCoverUrl,
  onThumbOffset,
  uploadImage,
  lang = "en",
  title,
}: {
  videoUrl: string;
  coverUrl: string | null;
  thumbOffsetMs: number | null;
  onCoverUrl: (url: string | null) => void;
  onThumbOffset: (ms: number | null) => void;
  /** Omit for frame-only platforms (TikTok's direct post takes a timestamp, never an image). */
  uploadImage?: (file: File) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
  /** UI language — the curation screens are in Portuguese, the Post Creator in English. */
  lang?: "en" | "pt";
  /** Section label override, e.g. "Capa do vídeo" for TikTok. */
  title?: string;
}) {
  const t = STRINGS[lang];
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
    if (!file || !uploadImage) return;
    if (!/^image\//.test(file.type)) {
      setError(t.mustBeImage);
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
        {title ?? t.title}
      </p>
      {coverUrl ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex w-full justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverUrl}
              alt={t.customAlt}
              className="h-44 w-[100px] rounded-lg border border-border object-cover"
            />
          </div>
          <button
            type="button"
            onClick={() => onCoverUrl(null)}
            className="text-center text-[12px] text-foreground-muted transition-colors hover:text-danger"
          >
            {t.remove}
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
            aria-label={t.slider}
          />
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-foreground-muted">
              {thumbOffsetMs === null ? t.firstFrame : t.frameAt((thumbOffsetMs / 1000).toFixed(1))}
            </p>
            {thumbOffsetMs !== null && (
              <button
                type="button"
                onClick={() => scrub(null)}
                className="text-[11px] text-foreground-muted underline transition-colors hover:text-foreground"
              >
                {t.reset}
              </button>
            )}
          </div>
        </div>
      )}
      {uploadImage && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? t.uploading : coverUrl ? t.replace : t.upload}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onFile(e.target.files)}
          />
        </>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {uploadImage && <p className="text-[11px] text-foreground-faint">{t.hint}</p>}
    </div>
  );
}
