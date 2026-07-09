"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X, Check } from "lucide-react";
import { signMagazineCoverUpload, setMagazineIssueMeta } from "@/app/actions/magazine";

// Cover art editor: upload an image, pan/zoom-crop it to the magazine's 3:4
// cover ratio, export the crop and upload it to Pinata, then save it as the
// edition's coverUrl. Works on freshly-uploaded files (object URLs) so the
// canvas isn't tainted — remote images can't be re-cropped here.
const OUT_W = 900;
const OUT_H = 1200; // 3:4
const VIEW_W = 300;
const VIEW_H = 400;

export function MagazineCoverEditor({
  issueId,
  onClose,
  onSaved,
}: {
  issueId: string;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // baseScale = "cover" the viewport at scale 1.
  const baseScale = img ? Math.max(VIEW_W / img.naturalWidth, VIEW_H / img.naturalHeight) : 1;
  const dispScale = baseScale * scale;
  const dispW = img ? img.naturalWidth * dispScale : 0;
  const dispH = img ? img.naturalHeight * dispScale : 0;

  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEW_W - dispW, x)),
      y: Math.min(0, Math.max(VIEW_H - dispH, y)),
    }),
    [dispW, dispH],
  );

  useEffect(() => {
    setPos((p) => clamp(p.x, p.y));
  }, [clamp]);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Selecione uma imagem."); return; }
    setError(null);
    const url = URL.createObjectURL(f);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setScale(1);
      setPos({ x: (VIEW_W - Math.max(VIEW_W / image.naturalWidth, VIEW_H / image.naturalHeight) * image.naturalWidth) / 2, y: (VIEW_H - Math.max(VIEW_W / image.naturalWidth, VIEW_H / image.naturalHeight) * image.naturalHeight) / 2 });
    };
    image.src = url;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setPos(clamp(dragRef.current.px + dx, dragRef.current.py + dy));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Map the viewport crop back to source-image pixels.
      const srcX = -pos.x / dispScale;
      const srcY = -pos.y / dispScale;
      const srcW = VIEW_W / dispScale;
      const srcH = VIEW_H / dispScale;
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível.");
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUT_W, OUT_H);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) throw new Error("Falha ao gerar a imagem.");
      const file = new File([blob], `magazine-cover-${issueId}.jpg`, { type: "image/jpeg" });

      const signed = await signMagazineCoverUpload(file.name, file.size, file.type);
      if (!signed.ok) throw new Error(signed.error);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("network", "public");
      const res = await fetch(signed.url, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Pinata HTTP ${res.status}`);
      const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
      const cid = json?.data?.cid;
      if (!cid) throw new Error("Pinata não retornou CID.");
      const url = `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}`;

      const meta = await setMagazineIssueMeta(issueId, { coverUrl: url });
      if (!meta.ok) throw new Error(meta.error);
      onSaved(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar a capa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Editar capa</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 flex flex-col items-center gap-3">
          {/* 3:4 crop viewport */}
          <div
            className="relative overflow-hidden rounded-lg border border-border bg-surface"
            style={{ width: VIEW_W, height: VIEW_H, touchAction: "none", cursor: img ? "grab" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.src} alt="" draggable={false} className="absolute select-none" style={{ left: pos.x, top: pos.y, width: dispW, height: dispH, maxWidth: "none" }} />
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 text-foreground-faint hover:text-foreground">
                <Upload className="h-6 w-6" />
                <span className="text-xs">Enviar imagem</span>
              </button>
            )}
          </div>

          {img && (
            <div className="flex w-full items-center gap-2">
              <span className="text-[10px] text-foreground-faint">Zoom</span>
              <input type="range" min={1} max={3} step={0.01} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1 accent-[var(--color-accent)]" />
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

          {error && <p className="w-full text-xs text-danger">{error}</p>}

          <div className="flex w-full items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">
              {img ? "Trocar imagem" : "Escolher arquivo"}
            </button>
            <button type="button" onClick={save} disabled={!img || busy} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Salvar capa
            </button>
          </div>
          <p className="text-[10px] text-foreground-faint">Corte 3:4 — arraste pra posicionar, use o zoom. Exporta {OUT_W}×{OUT_H}.</p>
        </div>
      </div>
    </div>
  );
}
