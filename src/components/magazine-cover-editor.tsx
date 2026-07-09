"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Folder,
  HardDrive,
  ImagePlus,
  Loader2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { signMagazineCoverUpload, setMagazineIssueMeta } from "@/app/actions/magazine";

// Feature-rich magazine cover studio (Thrasher-style): a base photo you crop,
// art layers on top (frames/logos), and text elements (masthead + cover lines)
// with font/color/outline/highlight controls. Everything is draggable with
// Canva-style snapping, then flattened onto a 900x1200 canvas and uploaded to
// Pinata as the edition's coverUrl. All image sources stay same-origin (object
// URLs or the Drive raw proxy) so the canvas is never tainted.
const OUT_W = 900;
const OUT_H = 1200; // 3:4
const VIEW_W = 396;
const VIEW_H = 528;
const SCALE_OUT = OUT_W / VIEW_W; // viewport px -> output px

// Canva-style snapping: snap an element's start/center/end edge to the cover's.
const SNAP = 6;
const VTARGETS = [0, VIEW_W / 2, VIEW_W];
const HTARGETS = [0, VIEW_H / 2, VIEW_H];
function snapAxis(pos: number, size: number, targets: number[]): { pos: number; guide: number } | null {
  let best: { d: number; pos: number; guide: number } | null = null;
  for (const t of targets) {
    for (const [anchor, off] of [[pos, 0], [pos + size / 2, size / 2], [pos + size, size]] as const) {
      const d = Math.abs(anchor - t);
      if (d <= SNAP && (!best || d < best.d)) best = { d, pos: t - off, guide: t };
    }
  }
  return best ? { pos: best.pos, guide: best.guide } : null;
}

const FONTS = [
  { label: "Impact", value: "Impact, Haettenschweiler, 'Arial Narrow', sans-serif" },
  { label: "Heavy", value: "'Arial Black', Arial, sans-serif" },
  { label: "Sans", value: "Helvetica, Arial, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', monospace" },
];

type DriveFile = { id: string; name: string; mimeType: string };
const FOLDER = "application/vnd.google-apps.folder";
const driveRaw = (id: string) => `/api/brain/drive/file?id=${encodeURIComponent(id)}&mode=raw`;

type ArtEl = { kind: "art"; id: number; img: HTMLImageElement; x: number; y: number; w: number; h: number };
type TextEl = {
  kind: "text";
  id: number;
  text: string;
  x: number;
  y: number;
  w: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineHeight: number;
  strokeWidth: number;
  strokeColor: string;
  bg: string | null;
};
type El = ArtEl | TextEl;

type PickTarget = "base" | "art";
type DragState =
  | { kind: "pan"; sx: number; sy: number; px: number; py: number }
  | { kind: "move"; id: number; sx: number; sy: number; ox: number; oy: number; w: number; h: number }
  | { kind: "resize-art"; id: number; sx: number; sy: number; ow: number; oh: number }
  | { kind: "resize-text"; id: number; sx: number; sy: number; ofs: number; ow: number };

function textLines(el: TextEl): string[] {
  return (el.uppercase ? el.text.toUpperCase() : el.text).split("\n");
}
function textHeight(el: TextEl): number {
  return Math.max(1, textLines(el).length) * el.fontSize * el.lineHeight;
}
function bounds(el: El): { x: number; y: number; w: number; h: number } {
  return el.kind === "art" ? { x: el.x, y: el.y, w: el.w, h: el.h } : { x: el.x, y: el.y, w: el.w, h: textHeight(el) };
}

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
  const [els, setEls] = useState<El[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
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

  const selEl = els.find((e) => e.id === selected) ?? null;
  const patch = (id: number, up: Partial<ArtEl> & Partial<TextEl>) =>
    setEls((prev) => prev.map((e) => (e.id === id ? ({ ...e, ...up } as El) : e)));

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
        const w = VIEW_W * 0.5;
        const h = (image.naturalHeight / image.naturalWidth) * w;
        const id = nextId.current++;
        setEls((prev) => [...prev, { kind: "art", id, img: image, x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h }]);
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

  function addText(preset: "masthead" | "line") {
    const id = nextId.current++;
    const base: TextEl =
      preset === "masthead"
        ? {
            kind: "text", id, text: "SKATEHIVE", x: 0, y: 14, w: VIEW_W,
            fontSize: 66, fontFamily: FONTS[0].value, color: "#ff1f1f", bold: true, italic: false,
            uppercase: true, align: "center", letterSpacing: 0, lineHeight: 1, strokeWidth: 0, strokeColor: "#ffffff", bg: null,
          }
        : {
            kind: "text", id, text: "Cover line", x: VIEW_W * 0.08, y: VIEW_H * 0.72, w: VIEW_W * 0.84,
            fontSize: 34, fontFamily: FONTS[0].value, color: "#ffffff", bold: true, italic: false,
            uppercase: true, align: "left", letterSpacing: 0, lineHeight: 1.05, strokeWidth: 2, strokeColor: "#000000", bg: null,
          };
    setEls((prev) => [...prev, base]);
    setSelected(id);
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

  // ── Pointer interactions ──
  function startPan(e: React.PointerEvent) {
    if (!img) return;
    setSelected(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }
  function startMove(e: React.PointerEvent, el: El) {
    e.stopPropagation();
    setSelected(el.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const b = bounds(el);
    dragRef.current = { kind: "move", id: el.id, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, w: b.w, h: b.h };
  }
  function startResize(e: React.PointerEvent, el: El) {
    e.stopPropagation();
    setSelected(el.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current =
      el.kind === "art"
        ? { kind: "resize-art", id: el.id, sx: e.clientX, sy: e.clientY, ow: el.w, oh: el.h }
        : { kind: "resize-text", id: el.id, sx: e.clientX, sy: e.clientY, ofs: el.fontSize, ow: el.w };
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === "pan") {
      setPos(clampPan(d.px + dx, d.py + dy));
    } else if (d.kind === "move") {
      let nx = d.ox + dx;
      let ny = d.oy + dy;
      const sX = snapAxis(nx, d.w, VTARGETS);
      const sY = snapAxis(ny, d.h, HTARGETS);
      if (sX) nx = sX.pos;
      if (sY) ny = sY.pos;
      setGuides({ v: sX ? [sX.guide] : [], h: sY ? [sY.guide] : [] });
      patch(d.id, { x: nx, y: ny });
    } else if (d.kind === "resize-art") {
      patch(d.id, { w: Math.max(20, d.ow + dx), h: Math.max(20, d.oh + dy) });
    } else {
      patch(d.id, { fontSize: Math.max(8, d.ofs + dy * 0.4), w: Math.max(40, d.ow + dx) });
    }
  }
  function endDrag() {
    dragRef.current = null;
    setGuides({ v: [], h: [] });
  }

  function removeEl(id: number) {
    setEls((prev) => prev.filter((e) => e.id !== id));
    setSelected((s) => (s === id ? null : s));
  }
  function reorder(id: number, dir: -1 | 1) {
    setEls((prev) => {
      const i = prev.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function drawText(ctx: CanvasRenderingContext2D, el: TextEl) {
    const fs = el.fontSize * SCALE_OUT;
    ctx.save();
    ctx.font = `${el.italic ? "italic " : ""}${el.bold ? "700" : "400"} ${fs}px ${el.fontFamily}`;
    ctx.textBaseline = "top";
    ctx.textAlign = el.align;
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${el.letterSpacing * SCALE_OUT}px`;
    } catch {
      /* not supported — ignore */
    }
    const lines = textLines(el);
    const lh = fs * el.lineHeight;
    const boxX = el.x * SCALE_OUT;
    const boxY = el.y * SCALE_OUT;
    const boxW = el.w * SCALE_OUT;
    const ax = el.align === "center" ? boxX + boxW / 2 : el.align === "right" ? boxX + boxW : boxX;
    lines.forEach((line, i) => {
      const ly = boxY + i * lh;
      if (el.bg) {
        const tw = ctx.measureText(line).width;
        const rx = el.align === "center" ? ax - tw / 2 : el.align === "right" ? ax - tw : ax;
        ctx.fillStyle = el.bg;
        ctx.fillRect(rx - 8 * SCALE_OUT, ly, tw + 16 * SCALE_OUT, lh);
      }
      if (el.strokeWidth > 0) {
        ctx.lineWidth = el.strokeWidth * SCALE_OUT;
        ctx.strokeStyle = el.strokeColor;
        ctx.lineJoin = "round";
        ctx.strokeText(line, ax, ly);
      }
      ctx.fillStyle = el.color;
      ctx.fillText(line, ax, ly);
    });
    ctx.restore();
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
      ctx.drawImage(img, -pos.x / dispScale, -pos.y / dispScale, VIEW_W / dispScale, VIEW_H / dispScale, 0, 0, OUT_W, OUT_H);
      for (const el of els) {
        if (el.kind === "art") ctx.drawImage(el.img, el.x * SCALE_OUT, el.y * SCALE_OUT, el.w * SCALE_OUT, el.h * SCALE_OUT);
        else drawText(ctx, el);
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
    <button type="button" onClick={() => setTab(id)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">Estúdio de capa</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy || !img}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar capa
            </button>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Canvas */}
          <div className="flex flex-1 items-center justify-center overflow-auto bg-black/30 p-6">
            <div
              className="relative shrink-0 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
              style={{ width: VIEW_W, height: VIEW_H, touchAction: "none", cursor: img ? "grab" : "default" }}
              onPointerDown={startPan}
              onPointerMove={onMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.src} alt="" draggable={false} className="absolute select-none" style={{ left: pos.x, top: pos.y, width: dispW, height: dispH, maxWidth: "none" }} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground-faint">
                  <ImagePlus className="h-8 w-8" />
                  <span className="text-xs">Escolha uma foto de fundo</span>
                </div>
              )}

              {els.map((el) => {
                const b = bounds(el);
                const sel = selected === el.id;
                return (
                  <div
                    key={el.id}
                    className={sel ? "absolute outline outline-2 outline-accent" : "absolute"}
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h, cursor: "move" }}
                    onPointerDown={(e) => startMove(e, el)}
                    onPointerMove={onMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {el.kind === "art" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={el.img.src} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" style={{ maxWidth: "none" }} />
                    ) : (
                      <div
                        className="pointer-events-none select-none"
                        style={{
                          width: "100%",
                          fontFamily: el.fontFamily,
                          fontSize: el.fontSize,
                          lineHeight: el.lineHeight,
                          color: el.color,
                          fontWeight: el.bold ? 700 : 400,
                          fontStyle: el.italic ? "italic" : "normal",
                          textTransform: el.uppercase ? "uppercase" : "none",
                          textAlign: el.align,
                          letterSpacing: el.letterSpacing,
                          WebkitTextStroke: el.strokeWidth > 0 ? `${el.strokeWidth}px ${el.strokeColor}` : undefined,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {el.bg ? (
                          <span style={{ background: el.bg, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", padding: "0 8px" }}>{el.text}</span>
                        ) : (
                          el.text
                        )}
                      </div>
                    )}
                    {sel && (
                      <span onPointerDown={(e) => startResize(e, el)} className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white bg-accent shadow" />
                    )}
                  </div>
                );
              })}

              {/* snap guides */}
              {guides.v.map((v) => (
                <span key={`v${v}`} className="pointer-events-none absolute top-0 h-full w-px bg-accent/80" style={{ left: v }} />
              ))}
              {guides.h.map((h) => (
                <span key={`h${h}`} className="pointer-events-none absolute left-0 w-full border-t border-accent/80" style={{ top: h }} />
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="w-full shrink-0 space-y-4 overflow-y-auto border-t border-border p-4 md:w-80 md:border-l md:border-t-0">
            {/* Background */}
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Fundo</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setPicker("base"); setTab("drive"); }} className="flex-1 rounded-lg border border-border px-3 py-2 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                  {img ? "Trocar foto de fundo" : "Escolher foto de fundo"}
                </button>
              </div>
              {img && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-foreground-faint">Zoom</span>
                  <input type="range" min={1} max={3} step={0.01} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} className="flex-1" />
                </div>
              )}
            </section>

            {/* Add */}
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Adicionar</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setPicker("art"); setTab("drive"); }} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                  <ImagePlus className="h-3.5 w-3.5" /> Arte
                </button>
                <button type="button" onClick={() => addText("line")} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                  <Type className="h-3.5 w-3.5" /> Texto
                </button>
                <button type="button" onClick={() => addText("masthead")} className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-semibold text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                  Masthead (título grande)
                </button>
              </div>
            </section>

            {/* Selected element properties */}
            {selEl && selEl.kind === "text" && (
              <section className="space-y-2.5 rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Texto</p>
                  <button type="button" onClick={() => removeEl(selEl.id)} className="text-[11px] text-danger hover:underline">Remover</button>
                </div>
                <textarea value={selEl.text} onChange={(e) => patch(selEl.id, { text: e.target.value })} rows={2}
                  className="w-full resize-y rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground focus:border-accent-border focus:outline-none" />
                <select value={selEl.fontFamily} onChange={(e) => patch(selEl.id, { fontFamily: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground">
                  {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <label className="w-16 text-[10px] text-foreground-faint">Tamanho</label>
                  <input type="range" min={10} max={140} step={1} value={selEl.fontSize} onChange={(e) => patch(selEl.id, { fontSize: parseInt(e.target.value) })} className="flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-16 text-[10px] text-foreground-faint">Largura</label>
                  <input type="range" min={40} max={VIEW_W} step={1} value={selEl.w} onChange={(e) => patch(selEl.id, { w: parseInt(e.target.value) })} className="flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-16 text-[10px] text-foreground-faint">Espaço</label>
                  <input type="range" min={-2} max={12} step={0.5} value={selEl.letterSpacing} onChange={(e) => patch(selEl.id, { letterSpacing: parseFloat(e.target.value) })} className="flex-1" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button key={a} type="button" onClick={() => patch(selEl.id, { align: a })}
                      className={`rounded px-2 py-1 text-[11px] ${selEl.align === a ? "bg-accent-bg text-accent" : "border border-border text-foreground-muted"}`}>{a === "left" ? "◧" : a === "center" ? "▣" : "◨"}</button>
                  ))}
                  <button type="button" onClick={() => patch(selEl.id, { bold: !selEl.bold })} className={`rounded px-2 py-1 text-[11px] font-bold ${selEl.bold ? "bg-accent-bg text-accent" : "border border-border text-foreground-muted"}`}>B</button>
                  <button type="button" onClick={() => patch(selEl.id, { italic: !selEl.italic })} className={`rounded px-2 py-1 text-[11px] italic ${selEl.italic ? "bg-accent-bg text-accent" : "border border-border text-foreground-muted"}`}>I</button>
                  <button type="button" onClick={() => patch(selEl.id, { uppercase: !selEl.uppercase })} className={`rounded px-2 py-1 text-[11px] ${selEl.uppercase ? "bg-accent-bg text-accent" : "border border-border text-foreground-muted"}`}>AA</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint">Cor
                    <input type="color" value={selEl.color} onChange={(e) => patch(selEl.id, { color: e.target.value })} className="h-6 w-8 rounded border border-border bg-transparent" />
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint">Contorno
                    <input type="color" value={selEl.strokeColor} onChange={(e) => patch(selEl.id, { strokeColor: e.target.value })} className="h-6 w-8 rounded border border-border bg-transparent" />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-16 text-[10px] text-foreground-faint">Borda</label>
                  <input type="range" min={0} max={10} step={0.5} value={selEl.strokeWidth} onChange={(e) => patch(selEl.id, { strokeWidth: parseFloat(e.target.value) })} className="flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint">Caixa
                    <input type="color" value={selEl.bg ?? "#ffff00"} onChange={(e) => patch(selEl.id, { bg: e.target.value })} className="h-6 w-8 rounded border border-border bg-transparent" />
                  </label>
                  <button type="button" onClick={() => patch(selEl.id, { bg: selEl.bg ? null : "#ff1f1f" })} className={`rounded px-2 py-1 text-[11px] ${selEl.bg ? "bg-accent-bg text-accent" : "border border-border text-foreground-muted"}`}>{selEl.bg ? "Caixa on" : "Caixa off"}</button>
                </div>
              </section>
            )}
            {selEl && selEl.kind === "art" && (
              <section className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Arte selecionada</p>
                <button type="button" onClick={() => removeEl(selEl.id)} className="text-[11px] text-danger hover:underline">Remover</button>
              </section>
            )}

            {/* Layers */}
            {els.length > 0 && (
              <section>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">Camadas</p>
                <ul className="space-y-1">
                  {[...els].reverse().map((el) => (
                    <li key={el.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${selected === el.id ? "border-accent-border bg-accent-bg" : "border-border"}`}>
                      <button type="button" onClick={() => setSelected(el.id)} className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground">
                        {el.kind === "art" ? "🖼 Arte" : `🅣 ${el.text.slice(0, 18) || "Texto"}`}
                      </button>
                      <button type="button" onClick={() => reorder(el.id, 1)} aria-label="Trazer à frente" className="rounded p-0.5 text-foreground-subtle hover:text-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => reorder(el.id, -1)} aria-label="Enviar pra trás" className="rounded p-0.5 text-foreground-subtle hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => removeEl(el.id)} aria-label="Remover" className="rounded p-0.5 text-foreground-subtle hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {error && <p className="text-xs text-danger">{error}</p>}
            <p className="text-[10px] text-foreground-faint">Arraste os elementos — eles grudam nas bordas e no centro. Exporta {OUT_W}×{OUT_H}.</p>
          </div>
        </div>

        {/* Image picker overlay (background OR art) */}
        {picker && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4" onClick={() => img && setPicker(null)}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">{picker === "art" ? "Adicionar arte" : "Foto de fundo"}</h4>
                {img && <button type="button" onClick={() => setPicker(null)} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>}
              </div>
              <div className="flex gap-1 rounded-lg border border-border p-0.5">
                {tabBtn("upload", "Enviar", Upload)}
                {tabBtn("drive", "Drive", HardDrive)}
              </div>
              {tab === "upload" ? (
                <button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-foreground-faint transition hover:border-border-strong hover:text-foreground">
                  <Upload className="h-6 w-6" />
                  <span className="text-xs">{picker === "art" ? "Enviar arte (PNG)" : "Enviar imagem"}</span>
                </button>
              ) : (
                <div className="mt-3">
                  <div className="mb-2 flex items-center gap-2">
                    <button type="button" onClick={driveBack} disabled={driveStack.length === 0 || driveLoading} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted disabled:opacity-40 hover:border-border-strong hover:text-foreground">
                      <ArrowLeft className="h-3 w-3" /> Voltar
                    </button>
                    <span className="text-[10px] text-foreground-faint">Escolha no Drive</span>
                  </div>
                  <div className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
                    {driveLoading && <div className="col-span-3 flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
                    {!driveLoading && drive?.map((f) =>
                      f.mimeType === FOLDER ? (
                        <button key={f.id} type="button" onClick={() => openFolder(f.id)} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface p-1 text-foreground-muted transition hover:border-border-strong hover:text-foreground">
                          <Folder className="h-5 w-5" />
                          <span className="line-clamp-2 text-center text-[9px] leading-tight">{f.name}</span>
                        </button>
                      ) : (
                        <button key={f.id} type="button" onClick={() => addImage(driveRaw(f.id), picker)} title={f.name} className="aspect-square overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={driveRaw(f.id)} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ),
                    )}
                    {!driveLoading && drive && drive.length === 0 && <p className="col-span-3 py-4 text-center text-[11px] text-foreground-faint">{driveErr ?? "Pasta vazia."}</p>}
                  </div>
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0], picker)} />
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
