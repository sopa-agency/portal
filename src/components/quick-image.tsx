"use client";

// Quick image generator UI — a simple, dependency-free horizontal/vertical/square
// image from a title + caption (+ optional background). Posts to /api/studio/quick.
// Pre-fills from ?caption. Copy PT-BR, theme-aware.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Download, ImageIcon, RectangleHorizontal, RectangleVertical, Square } from "lucide-react";

type Orientation = "landscape" | "portrait" | "square";

const ORIENTATIONS: { id: Orientation; label: string; icon: typeof Square }[] = [
  { id: "landscape", label: "Horizontal", icon: RectangleHorizontal },
  { id: "portrait", label: "Vertical", icon: RectangleVertical },
  { id: "square", label: "Quadrado", icon: Square },
];

export function QuickImage() {
  // Pre-fill from ?caption once — first line is the title, the rest the caption.
  const initLines = (useSearchParams().get("caption") ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [title, setTitle] = useState(initLines[0] ?? "");
  const [caption, setCaption] = useState(initLines.slice(1).join("\n").trim());
  const [imageUrl, setImageUrl] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/studio/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orientation, title, caption, imageUrl }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (src) URL.revokeObjectURL(src);
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao gerar.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint";

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <ImageIcon className="h-5 w-5 text-accent" /> Imagem rápida
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">Título + legenda → imagem horizontal, vertical ou quadrada. Sem depender do template do Figma.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Controls */}
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {ORIENTATIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOrientation(o.id)}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                  orientation === o.id ? "border-accent-border bg-accent-bg text-accent" : "border-border bg-surface-elevated text-foreground-muted hover:text-foreground"
                }`}
              >
                <o.icon className="h-4 w-4" /> {o.label}
              </button>
            ))}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (grande)" className={inputCls} />
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Legenda (menor)" rows={4} className={inputCls} />
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="URL de imagem de fundo (opcional)" className={inputCls} />
          <button
            type="button"
            onClick={generate}
            disabled={loading || (!title.trim() && !caption.trim() && !imageUrl.trim())}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent-border bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />} Gerar
          </button>
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>

        {/* Preview */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface p-4">
          {src ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="preview" className="max-h-[420px] w-full rounded-lg object-contain" />
              <a
                href={src}
                download={`imagem-${orientation}.jpg`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-foreground/5"
              >
                <Download className="h-3.5 w-3.5" /> Baixar
              </a>
            </>
          ) : (
            <p className="text-xs text-foreground-faint">A prévia aparece aqui depois de gerar.</p>
          )}
        </div>
      </div>
    </div>
  );
}
