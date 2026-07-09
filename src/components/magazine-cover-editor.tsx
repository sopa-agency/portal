"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X, Check, Folder, ArrowLeft, HardDrive, ImagePlus, Trash2 } from "lucide-react";
import { signMagazineCoverUpload, setMagazineIssueMeta } from "@/app/actions/magazine";

// Cover art editor: pick a base image (upload OR Google Drive), pan/zoom-crop it
// to the magazine's 3:4 cover ratio, layer art on top (frames/logos from Drive,
// draggable + resizable — like the Zine Studio), then flatten everything and
// upload to Pinata as the edition's coverUrl. All sources are same-origin
// (object URLs or the Drive raw proxy) so the crop canvas is never tainted.
const OUT_W = 900;
const OUT_H = 1200; // 3:4
const VIEW_W = 300;
const VIEW_H = 400;
const SCALE_OUT = OUT_W / VIEW_W; // viewport px -> output px (3x)

type DriveFile = { id: string; name: string; mimeType: string };
const FOLDER = "application/vnd.google-apps.folder";
const driveRaw = (id: string) => `/api/brain/drive/file?id=${encodeURIComponent(id)}&mode=raw`;

type Overlay = { id: number; img: HTMLImageElement; x: number; y: number; w: number; h: number };
type PickTarget = "base" | "overlay";
type DragState =
  | { kind: "pan"; sx: number; sy: number; px: number; py: number }
  | { kind: "move"; id: number; sx: number; sy: number; ox: number; oy: number }
  | { kind: "resize"; id: number; sx: number; sy: number; ow: number; oh: number };

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
  const [picker, setPicker] = useState<PickTarget | null>("base");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const nextId = useRef(1);
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

  const clampPan = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEW_W - dispW, x)),
      y: Math.min(0, Math.max(VIEW_H - dispH, y)),
    }),
    [dispW, dispH],
  );

  useEffect(() => {
    setPos((p) => clampPan(p.x, p.y));
  }, [clampPan]);

  function addImage(src: string, target: PickTarget) {
    setError(null);
    const image = new Image();
    image.onload = () => {
      if (target === "base") {
        const bs = Math.max(VIEW_W / image.naturalWidth, VIEW_H / image.naturalHeight);
        setImg(image);
        setScale(1);
        setPos({ x: (VIEW_W - bs * image.naturalWidth) / 2, y: (VIEW_H - bs * image.naturalHeight) / 2 });
      } else {
        // Center the overlay at ~60% of the viewport width, preserving aspect.
        const w = VIEW_W * 0.6;
        const h = (image.naturalHeight / image.naturalWidth) * w;
        const id = nextId.current++;
        setOverlays((prev) => [...prev, { id, img: image, x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h }]);
        setSelected(id);
      }
      setPicker(null);
    };
    image.onerror = () => setError("Falha ao carregar a imagem.");
    image.src = src;
  }

  function onFile(f: File | undefined, target: PickTarget) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Selecione uma imagem."); return; }
    addImage(URL.createObjectURL(f), target);
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

  // Load the Drive root the first time the Drive tab is opened inside a picker.
  useEffect(() => {
    if (picker && tab === "drive" && drive === null && !driveLoading) void loadDrive(driveStack[driveStack.length - 1]);
  }, [picker, tab, drive, driveLoading, driveStack, loadDrive]);

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

  // ── Pointer interactions on the viewport ──
  function startPan(e: React.PointerEvent) {
    if (!img) return;
    setSelected(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }
  function startMove(e: React.PointerEvent, o: Overlay) {
    e.stopPropagation();
    setSelected(o.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "move", id: o.id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y };
  }
  function startResize(e: React.PointerEvent, o: Overlay) {
    e.stopPropagation();
    setSelected(o.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "resize", id: o.id, sx: e.clientX, sy: e.clientY, ow: o.w, oh: o.h };
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === "pan") {
      setPos(clampPan(d.px + dx, d.py + dy));
    } else if (d.kind === "move") {
      setOverlays((prev) => prev.map((o) => (o.id === d.id ? { ...o, x: d.ox + dx, y: d.oy + dy } : o)));
    } else {
      setOverlays((prev) => prev.map((o) => (o.id === d.id ? { ...o, w: Math.max(20, d.ow + dx), h: Math.max(20, d.oh + dy) } : o)));
    }
  }
  function endDrag() {
    dragRef.current = null;
  }

  function removeOverlay(id: number) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    setSelected((s) => (s === id ? null : s));
  }

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível.");
      // Base crop
      ctx.drawImage(img, -pos.x / dispScale, -pos.y / dispScale, VIEW_W / dispScale, VIEW_H / dispScale, 0, 0, OUT_W, OUT_H);
      // Art layers on top (viewport px -> output px)
      for (const o of overlays) {
        ctx.drawImage(o.img, o.x * SCALE_OUT, o.y * SCALE_OUT, o.w * SCALE_OUT, o.h * SCALE_OUT);
      }
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

  const pickerTarget = picker ?? "base";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{picker === "overlay" ? "Adicionar arte" : "Editar capa"}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {picker ? (
          /* ── Source picker (base image OR overlay art) ── */
          <div className="mt-3">
            <div className="flex gap-1 rounded-lg border border-border p-0.5">
              {tabBtn("upload", "Enviar", Upload)}
              {tabBtn("drive", "Drive", HardDrive)}
            </div>

            {tab === "upload" ? (
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-foreground-faint transition hover:border-border-strong hover:text-foreground">
                <Upload className="h-6 w-6" />
                <span className="text-xs">{picker === "overlay" ? "Enviar arte (PNG)" : "Enviar imagem"}</span>
              </button>
            ) : (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  <button type="button" onClick={driveBack} disabled={driveStack.length === 0 || driveLoading} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted disabled:opacity-40 hover:border-border-strong hover:text-foreground">
                    <ArrowLeft className="h-3 w-3" /> Voltar
                  </button>
                  <span className="text-[10px] text-foreground-faint">{picker === "overlay" ? "Escolha a arte no Drive" : "Escolha a imagem no Drive"}</span>
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
                      <button key={f.id} type="button" onClick={() => addImage(driveRaw(f.id), pickerTarget)} title={f.name} className="aspect-square overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={driveRaw(f.id)} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    ),
                  )}
                  {!driveLoading && drive && drive.length === 0 && <p className="col-span-3 py-4 text-center text-[11px] text-foreground-faint">{driveErr ?? "Pasta vazia."}</p>}
                </div>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0], pickerTarget)} />
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            {img && (
              <button type="button" onClick={() => { setPicker(null); setError(null); }} className="mt-3 w-full rounded-lg border border-border py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">Cancelar</button>
            )}
          </div>
        ) : (
          /* ── Crop + layer view ── */
          <div className="mt-4 flex flex-col items-center gap-3">
            <div
              className="relative overflow-hidden rounded-lg border border-border bg-surface"
              style={{ width: VIEW_W, height: VIEW_H, touchAction: "none", cursor: "grab" }}
              onPointerDown={startPan}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* base */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img!.src} alt="" draggable={false} className="absolute select-none" style={{ left: pos.x, top: pos.y, width: dispW, height: dispH, maxWidth: "none" }} />
              {/* art layers */}
              {overlays.map((o) => (
                <div
                  key={o.id}
                  className={`absolute ${selected === o.id ? "outline outline-2 outline-accent" : ""}`}
                  style={{ left: o.x, top: o.y, width: o.w, height: o.h, cursor: "move" }}
                  onPointerDown={(e) => startMove(e, o)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.img.src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" style={{ maxWidth: "none" }} />
                  {selected === o.id && (
                    <>
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeOverlay(o.id)} aria-label="Remover arte" className="absolute -right-2 -top-2 rounded-full bg-danger p-0.5 text-white shadow">
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <span
                        onPointerDown={(e) => startResize(e, o)}
                        className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white bg-accent shadow"
                      />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="flex w-full items-center gap-2">
              <span className="text-[10px] text-foreground-faint">Zoom</span>
              <input type="range" min={1} max={3} step={0.01} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1" />
            </div>

            <button type="button" onClick={() => { setPicker("overlay"); setTab("drive"); setError(null); }} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">
              <ImagePlus className="h-3.5 w-3.5" /> Adicionar arte por cima {overlays.length > 0 ? `(${overlays.length})` : ""}
            </button>

            {error && <p className="w-full text-xs text-danger">{error}</p>}

            <div className="flex w-full items-center justify-between gap-2 pt-1">
              <button type="button" onClick={() => { setImg(null); setOverlays([]); setSelected(null); setError(null); setPicker("base"); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">Trocar imagem</button>
              <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar capa
              </button>
            </div>
            <p className="text-[10px] text-foreground-faint">Foto: arraste/zoom pra enquadrar 3:4. Arte: arraste, use a alça pra redimensionar. Exporta {OUT_W}×{OUT_H}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
