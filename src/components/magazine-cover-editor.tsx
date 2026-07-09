"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X, Check, Folder, ArrowLeft, HardDrive } from "lucide-react";
import { signMagazineCoverUpload, setMagazineIssueMeta } from "@/app/actions/magazine";

// Cover art editor: pick an image (upload OR Google Drive), pan/zoom-crop it to
// the magazine's 3:4 cover ratio, export the crop and upload it to Pinata, then
// save it as the edition's coverUrl. Drive images are proxied same-origin
// (/api/brain/drive/file?mode=raw) so the crop canvas isn't tainted.
const OUT_W = 900;
const OUT_H = 1200; // 3:4
const VIEW_W = 300;
const VIEW_H = 400;

type DriveFile = { id: string; name: string; mimeType: string };
const FOLDER = "application/vnd.google-apps.folder";
const driveRaw = (id: string) => `/api/brain/drive/file?id=${encodeURIComponent(id)}&mode=raw`;

export function MagazineCoverEditor({
  issueId,
  onClose,
  onSaved,
}: {
  issueId: string;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const [tab, setTab] = useState<"upload" | "drive">("upload");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drive browser state
  const [drive, setDrive] = useState<DriveFile[] | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [driveStack, setDriveStack] = useState<string[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);

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

  function loadImageSrc(src: string, crossOrigin = false) {
    setError(null);
    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => {
      const bs = Math.max(VIEW_W / image.naturalWidth, VIEW_H / image.naturalHeight);
      setImg(image);
      setScale(1);
      setPos({ x: (VIEW_W - bs * image.naturalWidth) / 2, y: (VIEW_H - bs * image.naturalHeight) / 2 });
    };
    image.onerror = () => setError("Falha ao carregar a imagem.");
    image.src = src;
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Selecione uma imagem."); return; }
    loadImageSrc(URL.createObjectURL(f));
  }

  const loadDrive = useCallback(async (folderId?: string) => {
    setDriveErr(null);
    setDrive(null);
    setDriveLoading(true);
    try {
      const res = await fetch(`/api/brain/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; files?: DriveFile[]; error?: string; reason?: string };
      if (data.ok && data.files) setDrive(data.files.filter((f) => f.mimeType === FOLDER || f.mimeType.startsWith("image/")));
      else { setDrive([]); setDriveErr(data.error ?? data.reason ?? "Drive não conectado."); }
    } catch (e) {
      setDrive([]);
      setDriveErr(e instanceof Error ? e.message : "Falha ao listar o Drive.");
    } finally {
      setDriveLoading(false);
    }
  }, []);

  // Load the Drive root the first time the Drive tab is opened.
  useEffect(() => {
    if (tab === "drive" && drive === null && !driveLoading) void loadDrive(driveStack[driveStack.length - 1]);
  }, [tab, drive, driveLoading, driveStack, loadDrive]);

  function openFolder(id: string) {
    setDriveStack((prev) => [...prev, id]);
    void loadDrive(id);
  }
  function driveBack() {
    setDriveStack((prev) => {
      const next = prev.slice(0, -1);
      void loadDrive(next[next.length - 1]);
      return next;
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    setPos(clamp(dragRef.current.px + (e.clientX - dragRef.current.x), dragRef.current.py + (e.clientY - dragRef.current.y)));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    setError(null);
    try {
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
      if (!blob) throw new Error("Falha ao gerar a imagem (imagem protegida?).");
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

  const tabBtn = (id: "upload" | "drive", label: string, Icon: typeof Upload) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Editar capa</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {img ? (
          /* ── Crop view ── */
          <div className="mt-4 flex flex-col items-center gap-3">
            <div
              className="relative overflow-hidden rounded-lg border border-border bg-surface"
              style={{ width: VIEW_W, height: VIEW_H, touchAction: "none", cursor: "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" draggable={false} className="absolute select-none" style={{ left: pos.x, top: pos.y, width: dispW, height: dispH, maxWidth: "none" }} />
            </div>
            <div className="flex w-full items-center gap-2">
              <span className="text-[10px] text-foreground-faint">Zoom</span>
              <input type="range" min={1} max={3} step={0.01} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1" />
            </div>
            {error && <p className="w-full text-xs text-danger">{error}</p>}
            <div className="flex w-full items-center justify-between gap-2 pt-1">
              <button type="button" onClick={() => { setImg(null); setError(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">Trocar imagem</button>
              <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar capa
              </button>
            </div>
            <p className="text-[10px] text-foreground-faint">Corte 3:4 — arraste pra posicionar, use o zoom. Exporta {OUT_W}×{OUT_H}.</p>
          </div>
        ) : (
          /* ── Source picker ── */
          <div className="mt-3">
            <div className="flex gap-1 rounded-lg border border-border p-0.5">
              {tabBtn("upload", "Enviar", Upload)}
              {tabBtn("drive", "Drive", HardDrive)}
            </div>

            {tab === "upload" ? (
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-foreground-faint transition hover:border-border-strong hover:text-foreground">
                <Upload className="h-6 w-6" />
                <span className="text-xs">Enviar imagem</span>
              </button>
            ) : (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  <button type="button" onClick={driveBack} disabled={driveStack.length === 0 || driveLoading} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted disabled:opacity-40 hover:border-border-strong hover:text-foreground">
                    <ArrowLeft className="h-3 w-3" /> Voltar
                  </button>
                  <span className="text-[10px] text-foreground-faint">Escolha a arte no Drive</span>
                </div>
                <div className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto">
                  {driveLoading && <div className="col-span-3 flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
                  {!driveLoading && drive?.map((f) =>
                    f.mimeType === FOLDER ? (
                      <button key={f.id} type="button" onClick={() => openFolder(f.id)} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface p-1 text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                        <Folder className="h-5 w-5" />
                        <span className="line-clamp-2 text-center text-[9px] leading-tight">{f.name}</span>
                      </button>
                    ) : (
                      <button key={f.id} type="button" onClick={() => loadImageSrc(driveRaw(f.id))} title={f.name} className="aspect-square overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={driveRaw(f.id)} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    ),
                  )}
                  {!driveLoading && drive && drive.length === 0 && <p className="col-span-3 py-4 text-center text-[11px] text-foreground-faint">{driveErr ?? "Pasta vazia."}</p>}
                </div>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
