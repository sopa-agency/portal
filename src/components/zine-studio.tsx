"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Type,
  Plus,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Printer,
  Eye,
  Pencil,
  Loader2,
  HardDrive,
  Newspaper,
  Layers,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Grid3x3,
  Scissors,
  X,
} from "lucide-react";
import { signZineMediaUpload } from "@/app/actions/zine";
import { listZineBlogImages, type ZineBlogImage } from "@/app/actions/zine-blog";

// ---------------------------------------------------------------------------
// Zine Studio — page-based editor for printable zines (Reelflip-family brands).
// Compose pages with draggable image/text elements, import from upload + Google
// Drive, preview as spreads, and print to a real PDF (@page-sized, page-break
// per zine page). State persists to localStorage so a refresh never loses work.
// Imposition (saddle-stitch printer spreads) is the next slice — v1 prints in
// reading order at the chosen page size.
// ---------------------------------------------------------------------------

type ElKind = "image" | "text";
type Element = {
  id: string;
  kind: ElKind;
  x: number; // % of page width
  y: number; // % of page height
  w: number; // % of page width
  h: number; // % of page height (image only; text is auto)
  z: number;
  src?: string;
  fit?: "cover" | "contain";
  text?: string;
  fontSize?: number; // in cqw (% of page width) so it scales on screen + print
  color?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  font?: string; // CSS font-family; "" = page default sans
};

// Every studio/brand font (all registered as @font-face in globals.css) plus
// readable system stacks. Empty value = inherit the page's default sans.
const ZINE_FONTS: { label: string; value: string }[] = [
  { label: "Sans (padrão)", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', ui-monospace, monospace" },
  { label: "Joystix — SkateHive", value: "Joystix" },
  { label: "Ken Pixel — Gnars", value: "'Ken Pixel'" },
  { label: "Bazinga — Reelflip", value: "Bazinga" },
  { label: "TOOM — Reelflip", value: "TOOM" },
  { label: "MADE GoodTime", value: "'MADE GoodTime Grotesk'" },
];
type Page = { id: string; bg: string; elements: Element[] };
type Draft = { id: string; name: string; savedAt: number; pageSize: PageSizeId; pages: Page[] };

// Grid step in % of the page (20 cols/rows). Center (50%) and edges fall on it.
const GRID = 5;

// Zine formats. "loose" = one page per sheet (saddle-stitch / single pages).
// "mini8" = the classic 8-page mini-zine: edit 8 pages, print one A4 landscape
// sheet imposed 4×2 (top row rotated 180°), fold + one center cut → a booklet.
const PAGE_SIZES = [
  { id: "A6", label: "A6 (página solta)", css: "A6 portrait", kind: "loose" },
  { id: "A5", label: "A5 (página solta)", css: "A5 portrait", kind: "loose" },
  { id: "A4", label: "A4 (página solta)", css: "A4 portrait", kind: "loose" },
  { id: "mini8", label: "Mini-zine 8p · 1 folha A4", css: "A4 landscape", kind: "mini8" },
] as const;
type PageSizeId = (typeof PAGE_SIZES)[number]["id"];

// Mini-zine imposition: cell index (row-major, 4 cols × 2 rows) → 1-based page.
// Top row (cells 0-3) prints rotated 180°. Front cover (1) lands bottom-right.
const MINI8_ORDER = [5, 4, 3, 2, 6, 7, 8, 1] as const;

function uid() {
  return `${Date.now().toString(36)}${Math.floor(performance.now()).toString(36)}${(globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0).toString(36)}`;
}

function blankPage(): Page {
  return { id: uid(), bg: "#ffffff", elements: [] };
}

async function uploadZineImage(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signZineMediaUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) return { ok: false, error: `Pinata HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type DriveFile = { id: string; name: string; mimeType: string };

export function ZineStudio({
  projectSlug,
  projectName,
  accent,
}: {
  projectSlug: string;
  projectName: string;
  accent: string;
}) {
  const storeKey = `zine-studio:${projectSlug}`;
  const [pages, setPages] = useState<Page[]>([blankPage()]);
  const [active, setActive] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeId>("A5");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [grid, setGrid] = useState(false); // visual grid + snap-to-grid on drag/resize
  const [cropMarks, setCropMarks] = useState(true); // crop/fold helper marks on print
  const [assetTab, setAssetTab] = useState<"upload" | "drive" | "blog">("upload");
  const [uploading, setUploading] = useState(false);
  const [drive, setDrive] = useState<DriveFile[] | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [blog, setBlog] = useState<ZineBlogImage[] | null>(null);
  const [blogErr, setBlogErr] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- undo / redo history ----
  // Debounced checkpoint so drags + bursts of edits coalesce into one step.
  const past = useRef<Page[][]>([]);
  const future = useRef<Page[][]>([]);
  const lastCommitted = useRef<Page[]>(pages);
  const fromHistory = useRef(false); // skip checkpoint when the change came from undo/redo/load
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histLen, setHistLen] = useState({ p: 0, f: 0 });
  const syncHist = () => setHistLen({ p: past.current.length, f: future.current.length });

  const commitCheckpoint = useCallback(() => {
    if (checkpointTimer.current) { clearTimeout(checkpointTimer.current); checkpointTimer.current = null; }
    if (pages === lastCommitted.current) return;
    past.current.push(lastCommitted.current);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    lastCommitted.current = pages;
    syncHist();
  }, [pages]);

  useEffect(() => {
    if (fromHistory.current) { fromHistory.current = false; lastCommitted.current = pages; return; }
    if (pages === lastCommitted.current) return;
    if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
    checkpointTimer.current = setTimeout(commitCheckpoint, 350);
    return () => { if (checkpointTimer.current) clearTimeout(checkpointTimer.current); };
  }, [pages, commitCheckpoint]);

  const restoreSnapshot = useCallback((snap: Page[]) => {
    fromHistory.current = true;
    setActive((a) => Math.min(a, snap.length - 1));
    setSelectedId(null);
    setPages(snap);
  }, []);
  const undo = useCallback(() => {
    commitCheckpoint();
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(lastCommitted.current);
    lastCommitted.current = prev;
    syncHist();
    restoreSnapshot(prev);
  }, [commitCheckpoint, restoreSnapshot]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(lastCommitted.current);
    lastCommitted.current = next;
    syncHist();
    restoreSnapshot(next);
  }, [restoreSnapshot]);

  // undo/redo keyboard shortcuts (skip while typing in a field)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Load persisted state once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const saved = JSON.parse(raw) as { pages: Page[]; pageSize: PageSizeId };
        if (Array.isArray(saved.pages) && saved.pages.length) { fromHistory.current = true; setPages(saved.pages); }
        if (saved.pageSize) setPageSize(saved.pageSize);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [storeKey]);

  // Persist on change (after hydration so we don't overwrite with the blank).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ pages, pageSize }));
    } catch {
      /* quota */
    }
  }, [pages, pageSize, hydrated, storeKey]);

  const page = pages[active] ?? pages[0];
  const selected = page?.elements.find((e) => e.id === selectedId) ?? null;

  function mutatePage(fn: (p: Page) => Page) {
    setPages((prev) => prev.map((p, i) => (i === active ? fn(p) : p)));
  }
  function updateEl(id: string, patch: Partial<Element>) {
    mutatePage((p) => ({ ...p, elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }
  function addElement(el: Omit<Element, "id" | "z">) {
    const z = Math.max(0, ...page.elements.map((e) => e.z)) + 1;
    const id = uid();
    mutatePage((p) => ({ ...p, elements: [...p.elements, { ...el, id, z }] }));
    setSelectedId(id);
  }
  function addImage(src: string) {
    addElement({ kind: "image", x: 10, y: 10, w: 60, h: 40, src, fit: "cover" });
  }
  function addText() {
    addElement({ kind: "text", x: 12, y: 12, w: 60, h: 0, text: "Texto", fontSize: 6, color: "#000000", align: "left", bold: false });
  }

  // --- drag + resize ---------------------------------------------------------
  function onElPointerDown(e: React.PointerEvent, el: Element, mode: "move" | "resize") {
    if (view !== "edit") return;
    e.stopPropagation();
    setSelectedId(el.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { x: el.x, y: el.y, w: el.w, h: el.h };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    function onMove(ev: PointerEvent) {
      // Snap to the grid step when the grid is on (hold Alt/⌥ to move freely).
      const snap = (v: number) => (grid && !ev.altKey ? Math.round(v / GRID) * GRID : v);
      const dxPct = ((ev.clientX - startX) / rect!.width) * 100;
      const dyPct = ((ev.clientY - startY) / rect!.height) * 100;
      if (mode === "move") {
        updateEl(el.id, {
          x: Math.max(0, Math.min(100 - 2, snap(start.x + dxPct))),
          y: Math.max(0, Math.min(100 - 2, snap(start.y + dyPct))),
        });
      } else {
        updateEl(el.id, {
          w: Math.max(5, Math.min(100, snap(start.w + dxPct))),
          ...(el.kind === "image" ? { h: Math.max(5, Math.min(100, snap(start.h + dyPct))) } : {}),
        });
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    for (const f of files) {
      const r = await uploadZineImage(f);
      if (r.ok) addImage(r.url);
    }
    setUploading(false);
  }

  async function loadDrive() {
    setDriveErr(null);
    try {
      const res = await fetch("/api/brain/drive/list", { cache: "no-store" });
      const data = (await res.json()) as
        | { ok: true; files: DriveFile[] }
        | { ok: false; error?: string; reason?: string };
      if (data.ok) setDrive(data.files.filter((f) => f.mimeType.startsWith("image/")));
      else {
        setDrive([]);
        setDriveErr(data.error ?? data.reason ?? "Drive não conectado");
      }
    } catch (err) {
      setDriveErr(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadBlog() {
    setBlogErr(null);
    const r = await listZineBlogImages();
    if (r.ok) setBlog(r.images);
    else {
      setBlog([]);
      setBlogErr(r.error);
    }
  }

  // ---- named drafts (localStorage, per project) ----
  const draftsKey = `zine-drafts:${projectSlug}`;
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const draftsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftsKey);
      if (raw) setDrafts(JSON.parse(raw) as Draft[]);
    } catch {
      /* ignore */
    }
  }, [draftsKey]);

  const persistDrafts = useCallback(
    (next: Draft[]) => {
      setDrafts(next);
      try {
        localStorage.setItem(draftsKey, JSON.stringify(next));
      } catch {
        /* quota — drafts are URL-based JSON so this is unlikely */
      }
    },
    [draftsKey],
  );

  function saveDraft() {
    const name = draftName.trim() || `Zine ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString().slice(0, 5)}`;
    const draft: Draft = { id: uid(), name, savedAt: Date.now(), pageSize, pages: structuredClone(pages) };
    persistDrafts([draft, ...drafts].slice(0, 50));
    setDraftName("");
  }
  function loadDraft(d: Draft) {
    // Replace the working doc + reset undo history to this baseline.
    past.current = [];
    future.current = [];
    fromHistory.current = true;
    lastCommitted.current = d.pages;
    syncHist();
    setActive(0);
    setSelectedId(null);
    setPageSize(d.pageSize);
    setPages(structuredClone(d.pages));
    setDraftsOpen(false);
  }
  function deleteDraft(id: string) {
    persistDrafts(drafts.filter((d) => d.id !== id));
  }

  // close the drafts dropdown on outside click
  useEffect(() => {
    if (!draftsOpen) return;
    function onDoc(e: MouseEvent) {
      if (draftsRef.current && !draftsRef.current.contains(e.target as Node)) setDraftsOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [draftsOpen]);

  const sizeMeta = PAGE_SIZES.find((s) => s.id === pageSize)!;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col gap-3 md:h-[calc(100dvh-4rem)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookMark accent={accent} />
          <div>
            <h1 className="text-lg font-bold text-foreground">Zine Studio</h1>
            <p className="text-[11px] text-foreground-faint">
              {sizeMeta.kind === "mini8"
                ? `${projectName} · mini-zine 8p — pág 1 = capa, 8 = contracapa · imprime 1 folha A4, dobra + 1 corte`
                : `${projectName} · zine imprimível`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={undo}
              disabled={histLen.p === 0}
              title="Desfazer (⌘Z)"
              aria-label="Desfazer"
              className="rounded-md px-2 py-1 text-foreground-muted hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={histLen.f === 0}
              title="Refazer (⌘⇧Z)"
              aria-label="Refazer"
              className="rounded-md px-2 py-1 text-foreground-muted hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as PageSizeId)}
            className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <button type="button" onClick={() => setView("edit")} className={tab(view === "edit")}>
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
            <button type="button" onClick={() => { setSelectedId(null); setView("preview"); }} className={tab(view === "preview")}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
          </div>
          <button
            type="button"
            onClick={() => setGrid((g) => !g)}
            title="Grade + encaixe (segure Alt para mover livre)"
            aria-pressed={grid}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${grid ? "border-accent bg-accent-bg text-accent" : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground"}`}
          >
            <Grid3x3 className="h-3.5 w-3.5" /> Grade
          </button>
          <button
            type="button"
            onClick={() => setCropMarks((m) => !m)}
            title="Marcas de corte/dobra na impressão"
            aria-pressed={cropMarks}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${cropMarks ? "border-accent bg-accent-bg text-accent" : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground"}`}
          >
            <Scissors className="h-3.5 w-3.5" /> Marcas
          </button>
          <div className="relative" ref={draftsRef}>
            <button
              type="button"
              onClick={() => setDraftsOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Rascunhos{drafts.length ? ` (${drafts.length})` : ""}
            </button>
            {draftsOpen && (
              <div className="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-72 rounded-xl border border-border bg-surface-elevated p-2 shadow-lg">
                <div className="flex gap-1.5">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveDraft(); }}
                    placeholder="Nome do rascunho…"
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={saveDraft}
                    title="Salvar rascunho atual"
                    className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
                  >
                    <Save className="h-3.5 w-3.5" /> Salvar
                  </button>
                </div>
                <div className="mt-2 max-h-72 overflow-y-auto">
                  {drafts.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-foreground-faint">Nenhum rascunho salvo.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {drafts.map((d) => (
                        <li key={d.id} className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-foreground/5">
                          <button type="button" onClick={() => loadDraft(d)} className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-xs text-foreground">{d.name}</span>
                            <span className="block text-[10px] text-foreground-faint">{d.pages.length} pág · {new Date(d.savedAt).toLocaleDateString()}</span>
                          </button>
                          <button type="button" onClick={() => deleteDraft(d.id)} aria-label="Excluir rascunho" className="shrink-0 rounded p-1 text-foreground-faint hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90"
          >
            <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
          </button>
        </div>
      </div>

      {view === "preview" ? (
        <FlipbookPreview pages={pages} />
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[150px_1fr_230px]">
        {/* Pages rail */}
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-2">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setActive(i); setSelectedId(null); }}
              className={`relative aspect-[1/1.414] w-full overflow-hidden rounded-md border text-left ${i === active ? "border-accent ring-1 ring-accent" : "border-border"}`}
              style={{ backgroundColor: p.bg }}
            >
              <span className="absolute left-1 top-1 z-10 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{i + 1}</span>
              {p.elements.map((el) => (
                <ThumbEl key={el.id} el={el} />
              ))}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setPages((prev) => [...prev, blankPage()]); setActive(pages.length); setSelectedId(null); }}
            className="flex aspect-[1/1.414] w-full items-center justify-center rounded-md border border-dashed border-border text-foreground-faint hover:border-accent-border hover:text-accent"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {/* Canvas */}
        <div className="flex min-h-0 items-center justify-center overflow-auto rounded-xl border border-border bg-surface-elevated/40 p-4">
          <div
            ref={canvasRef}
            onPointerDown={() => setSelectedId(null)}
            className="relative aspect-[1/1.414] max-h-full w-auto shadow-lg"
            style={{ height: "100%", backgroundColor: page?.bg ?? "#fff", containerType: "inline-size" }}
          >
            {page?.elements
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((el) => (
                <ElementView
                  key={el.id}
                  el={el}
                  selected={view === "edit" && el.id === selectedId}
                  onPointerDown={(e) => onElPointerDown(e, el, "move")}
                  onResize={(e) => onElPointerDown(e, el, "resize")}
                  onChangeText={(t) => updateEl(el.id, { text: t })}
                  editable={view === "edit"}
                />
              ))}
            {/* Grid + center guides (edit only; never printed) */}
            {grid && view === "edit" && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    `repeating-linear-gradient(to right, rgba(127,127,127,0.22) 0 1px, transparent 1px ${GRID}%), repeating-linear-gradient(to bottom, rgba(127,127,127,0.22) 0 1px, transparent 1px ${GRID}%)`,
                }}
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent/40" />
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-accent/40" />
              </div>
            )}
          </div>
        </div>

        {/* Inspector / assets */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-3">
          {/* page actions */}
          <div className="flex flex-wrap gap-1.5">
            <IconBtn title="Adicionar texto" onClick={addText}><Type className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Duplicar página" onClick={() => { const c: Page = { ...page, id: uid(), elements: page.elements.map((e) => ({ ...e, id: uid() })) }; setPages((prev) => [...prev.slice(0, active + 1), c, ...prev.slice(active + 1)]); setActive(active + 1); }}><Copy className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Mover página ↑" disabled={active === 0} onClick={() => { setPages((prev) => { const n = [...prev]; [n[active - 1], n[active]] = [n[active], n[active - 1]]; return n; }); setActive(active - 1); }}><ChevronUp className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Mover página ↓" disabled={active >= pages.length - 1} onClick={() => { setPages((prev) => { const n = [...prev]; [n[active + 1], n[active]] = [n[active], n[active + 1]]; return n; }); setActive(active + 1); }}><ChevronDown className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Excluir página" disabled={pages.length <= 1} onClick={() => { setPages((prev) => prev.filter((_, i) => i !== active)); setActive(Math.max(0, active - 1)); }}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </div>

          {selected ? (
            <Inspector
              el={selected}
              onChange={(patch) => updateEl(selected.id, patch)}
              onDelete={() => { mutatePage((p) => ({ ...p, elements: p.elements.filter((e) => e.id !== selected.id) })); setSelectedId(null); }}
              onFront={() => updateEl(selected.id, { z: Math.max(0, ...page.elements.map((e) => e.z)) + 1 })}
            />
          ) : (
            <>
              <div className="flex items-center rounded-lg border border-border p-0.5 text-xs">
                <button type="button" onClick={() => setAssetTab("upload")} className={tab(assetTab === "upload")}>Upload</button>
                <button type="button" onClick={() => { setAssetTab("drive"); if (!drive) void loadDrive(); }} className={tab(assetTab === "drive")}><HardDrive className="h-3.5 w-3.5" /> Drive</button>
                <button type="button" onClick={() => { setAssetTab("blog"); if (!blog) void loadBlog(); }} className={tab(assetTab === "blog")}><Newspaper className="h-3.5 w-3.5" /> Blog</button>
              </div>
              {assetTab === "upload" ? (
                <div>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPickFiles} className="hidden" />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-6 text-xs text-foreground-muted hover:border-accent-border hover:text-accent disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {uploading ? "Enviando…" : "Enviar imagens"}
                  </button>
                  <p className="mt-2 text-[10px] text-foreground-faint">Importe imagens dos posts do blog na aba <b>Blog</b> (SkateHive / Gnars).</p>
                </div>
              ) : assetTab === "drive" ? (
                <div>
                  {driveErr ? (
                    <p className="text-[11px] text-danger">{driveErr}</p>
                  ) : drive === null ? (
                    <p className="flex items-center gap-1.5 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
                  ) : drive.length === 0 ? (
                    <p className="text-[11px] text-foreground-faint">Nenhuma imagem na raiz do Drive.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {drive.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => addImage(`/api/brain/drive/file?id=${encodeURIComponent(f.id)}&mode=raw`)}
                          className="aspect-square overflow-hidden rounded-md border border-border hover:border-accent-border"
                          title={f.name}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/brain/drive/file?id=${encodeURIComponent(f.id)}&mode=raw`} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {blogErr ? (
                    <p className="text-[11px] text-danger">{blogErr}</p>
                  ) : blog === null ? (
                    <p className="flex items-center gap-1.5 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando posts…</p>
                  ) : blog.length === 0 ? (
                    <p className="text-[11px] text-foreground-faint">Nenhuma imagem encontrada nos posts do blog.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {blog.map((img, i) => (
                        <button
                          key={`${img.url}-${i}`}
                          type="button"
                          onClick={() => addImage(img.url)}
                          className="aspect-square overflow-hidden rounded-md border border-border hover:border-accent-border"
                          title={img.title}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Print-only layout — each page at its real size, page-break between. */}
      <div className="zine-print">
        {sizeMeta.kind === "mini8" ? (
          // One A4-landscape sheet, 8 pages imposed 4×2 (top row rotated 180°).
          <div className="zine-print-mini">
            <div className="zine-mini-grid">
              {MINI8_ORDER.map((pageNum, cell) => {
                const p = pages[pageNum - 1];
                return (
                  <div
                    key={cell}
                    className="zine-mini-cell"
                    style={{ backgroundColor: p?.bg ?? "#ffffff", containerType: "inline-size", transform: cell < 4 ? "rotate(180deg)" : undefined }}
                  >
                    {p?.elements
                      .slice()
                      .sort((a, b) => a.z - b.z)
                      .map((el) => <ElementView key={el.id} el={el} selected={false} editable={false} />)}
                  </div>
                );
              })}
            </div>
            {cropMarks && <MiniZineGuides />}
          </div>
        ) : (
          pages.map((p) => (
            <div key={p.id} className="zine-print-page" style={{ backgroundColor: p.bg, containerType: "inline-size" }}>
              {p.elements
                .slice()
                .sort((a, b) => a.z - b.z)
                .map((el) => (
                  <ElementView key={el.id} el={el} selected={false} editable={false} />
                ))}
              {cropMarks && <CornerMarks />}
            </div>
          ))
        )}
      </div>

      <style>{`
        @media screen { .zine-print { display: none; } }
        @media print {
          body * { visibility: hidden; }
          .zine-print, .zine-print * { visibility: visible; }
          .zine-print { position: absolute; inset: 0; display: block; }
          @page { size: ${sizeMeta.css}; margin: 0; }
          .zine-print-page {
            position: relative; width: 100%; height: 100vh;
            page-break-after: always; overflow: hidden;
          }
          .zine-print-mini { position: relative; width: 100%; height: 100vh; overflow: hidden; }
          .zine-mini-grid {
            position: absolute; inset: 0; display: grid;
            grid-template-columns: repeat(4, 1fr); grid-template-rows: repeat(2, 1fr);
          }
          .zine-mini-cell { position: relative; overflow: hidden; }
        }
      `}</style>
    </div>
  );
}

function tab(activeState: boolean) {
  return `flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${activeState ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`;
}

function IconBtn({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="rounded-md border border-border p-1.5 text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40">
      {children}
    </button>
  );
}

function ElementView({
  el,
  selected,
  onPointerDown,
  onResize,
  onChangeText,
  editable,
}: {
  el: Element;
  selected: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResize?: (e: React.PointerEvent) => void;
  onChangeText?: (t: string) => void;
  editable: boolean;
}) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${el.x}%`,
    top: `${el.y}%`,
    width: `${el.w}%`,
    zIndex: el.z,
  };
  return (
    <div
      style={el.kind === "image" ? { ...base, height: `${el.h}%` } : base}
      onPointerDown={editable ? onPointerDown : undefined}
      className={`${editable ? "cursor-move" : ""} ${selected ? "outline outline-2 outline-accent" : ""}`}
    >
      {el.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={el.src} alt="" draggable={false} className="h-full w-full select-none" style={{ objectFit: el.fit ?? "cover", pointerEvents: "none" }} />
      ) : editable && selected ? (
        <textarea
          value={el.text}
          onChange={(e) => onChangeText?.(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full resize-none border-none bg-transparent outline-none"
          style={{ fontFamily: el.font || undefined, fontSize: `${el.fontSize}cqw`, color: el.color, textAlign: el.align, fontWeight: el.bold ? 700 : 400, lineHeight: 1.25 }}
          rows={2}
        />
      ) : (
        <p className="whitespace-pre-wrap" style={{ fontFamily: el.font || undefined, fontSize: `${el.fontSize}cqw`, color: el.color, textAlign: el.align, fontWeight: el.bold ? 700 : 400, lineHeight: 1.25 }}>
          {el.text}
        </p>
      )}
      {selected && el.kind === "image" && (
        <span
          onPointerDown={onResize}
          className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-full border border-white bg-accent"
        />
      )}
      {selected && el.kind === "text" && (
        <span
          onPointerDown={onResize}
          className="absolute -right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 cursor-ew-resize rounded-full border border-white bg-accent"
        />
      )}
    </div>
  );
}

function ThumbEl({ el }: { el: Element }) {
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${el.x}%`,
    top: `${el.y}%`,
    width: `${el.w}%`,
    zIndex: el.z,
  };
  if (el.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={el.src} alt="" style={{ ...base, height: `${el.h}%`, objectFit: el.fit ?? "cover" }} />;
  return (
    <span style={{ ...base, fontFamily: el.font || undefined, fontSize: `${(el.fontSize ?? 6) * 0.9}px`, color: el.color, fontWeight: el.bold ? 700 : 400, overflow: "hidden" }}>
      {el.text}
    </span>
  );
}

function Inspector({
  el,
  onChange,
  onDelete,
  onFront,
}: {
  el: Element;
  onChange: (patch: Partial<Element>) => void;
  onDelete: () => void;
  onFront: () => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          {el.kind === "image" ? <ImagePlus className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}
          {el.kind === "image" ? "Imagem" : "Texto"}
        </span>
        <button type="button" onClick={onDelete} className="text-foreground-faint hover:text-danger" title="Excluir elemento"><X className="h-4 w-4" /></button>
      </div>

      {el.kind === "text" && (
        <>
          <label className="block text-foreground-muted">Texto
            <textarea value={el.text} onChange={(e) => onChange({ text: e.target.value })} rows={3} className="mt-1 w-full resize-none rounded-md border border-border bg-surface-elevated p-2 text-foreground focus:border-border-strong focus:outline-none" />
          </label>
          <label className="block text-foreground-muted">Fonte
            <select
              value={el.font ?? ""}
              onChange={(e) => onChange({ font: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-surface-elevated p-1.5 text-foreground focus:border-border-strong focus:outline-none"
              style={{ fontFamily: el.font || undefined }}
            >
              {ZINE_FONTS.map((f) => (
                <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between text-foreground-muted">Tamanho
            <input type="range" min={2} max={18} step={0.5} value={el.fontSize ?? 6} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} />
          </label>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-foreground-muted">Cor
              <input type="color" value={el.color ?? "#000000"} onChange={(e) => onChange({ color: e.target.value })} className="h-6 w-8 rounded border border-border" />
            </label>
            <div className="flex items-center gap-1">
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" onClick={() => onChange({ align: a })} className={`rounded px-1.5 py-0.5 ${el.align === a ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>{a[0].toUpperCase()}</button>
              ))}
              <button type="button" onClick={() => onChange({ bold: !el.bold })} className={`rounded px-1.5 py-0.5 font-bold ${el.bold ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>B</button>
            </div>
          </div>
        </>
      )}

      {el.kind === "image" && (
        <div className="flex items-center gap-2">
          <span className="text-foreground-muted">Encaixe</span>
          {(["cover", "contain"] as const).map((f) => (
            <button key={f} type="button" onClick={() => onChange({ fit: f })} className={`rounded px-2 py-0.5 ${el.fit === f ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>{f === "cover" ? "Preencher" : "Caber"}</button>
          ))}
        </div>
      )}

      <button type="button" onClick={onFront} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border py-1.5 text-foreground-muted hover:border-border-strong hover:text-foreground">
        <Layers className="h-3.5 w-3.5" /> Trazer pra frente
      </button>
    </div>
  );
}

function BookMark({ accent }: { accent: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}22`, color: accent }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
    </span>
  );
}

// Corner trim/registration marks for a printed loose page (helper for cutting).
function CornerMarks() {
  const L = 22; // tick length (px)
  const corners: { v: "top" | "bottom"; h: "left" | "right" }[] = [
    { v: "top", h: "left" }, { v: "top", h: "right" },
    { v: "bottom", h: "left" }, { v: "bottom", h: "right" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 9999 }}>
      {corners.map((c, i) => (
        <span key={i}>
          <span style={{ position: "absolute", [c.v]: 0, [c.h]: 0, width: 1, height: L, background: "#000" }} />
          <span style={{ position: "absolute", [c.v]: 0, [c.h]: 0, width: L, height: 1, background: "#000" }} />
        </span>
      ))}
    </div>
  );
}

// Fold + cut guides for the 8-page mini-zine sheet. Gray dashed = valley/mountain
// folds (4 cols, 2 rows); red dashed center segment = the single cut.
function MiniZineGuides() {
  const fold = "1px dashed rgba(0,0,0,0.45)";
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 9999 }}>
      {/* vertical fold lines at 25 / 50 / 75 % */}
      {[25, 50, 75].map((x) => (
        <span key={x} style={{ position: "absolute", top: 0, bottom: 0, left: `${x}%`, borderLeft: fold }} />
      ))}
      {/* horizontal fold line at 50% (only the outer quarters fold here) */}
      <span style={{ position: "absolute", left: 0, top: "50%", width: "25%", borderTop: fold }} />
      <span style={{ position: "absolute", right: 0, top: "50%", width: "25%", borderTop: fold }} />
      {/* the cut: center horizontal segment across the middle two panels */}
      <span style={{ position: "absolute", left: "25%", width: "50%", top: "50%", borderTop: "2px dashed #e11d48" }} />
      <span style={{ position: "absolute", left: "50%", top: "calc(50% - 18px)", transform: "translateX(-50%)", fontSize: 10, color: "#e11d48", fontWeight: 700, letterSpacing: 1 }}>
        ✂ CORTAR
      </span>
    </div>
  );
}

// A single zine page rendered read-only (used by the flipbook preview).
function PageFace({ page }: { page: Page }) {
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ backgroundColor: page.bg, containerType: "inline-size" }}>
      {page.elements
        .slice()
        .sort((a, b) => a.z - b.z)
        .map((el) => (
          <ElementView key={el.id} el={el} selected={false} editable={false} />
        ))}
    </div>
  );
}

// Flipbook preview — turn through the zine like a real booklet (3D page flip,
// arrow keys, click controls). Edit-only chrome is gone; this is the read view.
function FlipbookPreview({ pages }: { pages: Page[] }) {
  const [idx, setIdx] = useState(0);
  const [flip, setFlip] = useState<{ dir: "next" | "prev"; animate: boolean } | null>(null);
  const max = pages.length - 1;
  const cur = Math.min(idx, max);

  // Mount the leaf at its start angle, then flip to the target on the next
  // frame so the CSS transition actually runs.
  useEffect(() => {
    if (flip && !flip.animate) {
      const r = requestAnimationFrame(() =>
        requestAnimationFrame(() => setFlip((f) => (f ? { ...f, animate: true } : f))),
      );
      return () => cancelAnimationFrame(r);
    }
  }, [flip]);

  const go = (dir: "next" | "prev") => {
    if (flip) return;
    if (dir === "next" && cur >= max) return;
    if (dir === "prev" && cur <= 0) return;
    setFlip({ dir, animate: false });
  };
  const onEnd = () => {
    if (!flip) return;
    setIdx((i) => (flip.dir === "next" ? i + 1 : i - 1));
    setFlip(null);
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (flip) return;
      if (e.key === "ArrowRight" && cur < max) setFlip({ dir: "next", animate: false });
      else if (e.key === "ArrowLeft" && cur > 0) setFlip({ dir: "prev", animate: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, cur, max]);

  const beneath = flip ? (flip.dir === "next" ? cur + 1 : cur) : cur;
  const leaf = flip?.dir === "prev" ? cur - 1 : cur;
  const rot = !flip ? 0 : flip.animate ? (flip.dir === "prev" ? 0 : -180) : flip.dir === "prev" ? -180 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-elevated/40 p-4">
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center" style={{ perspective: 2200 }}>
        <div className="relative aspect-[1/1.414] w-auto" style={{ height: "100%" }}>
          {/* page underneath the turning leaf */}
          <div className="absolute inset-0 overflow-hidden rounded-md shadow-xl">
            <PageFace page={pages[beneath]} />
          </div>
          {/* the turning leaf */}
          {flip && (
            <div
              className="absolute inset-0 rounded-md shadow-2xl"
              style={{
                transformStyle: "preserve-3d",
                transformOrigin: "left center",
                transform: `rotateY(${rot}deg)`,
                transition: flip.animate ? "transform 0.7s cubic-bezier(0.4,0.1,0.3,1)" : "none",
              }}
              onTransitionEnd={onEnd}
            >
              <div className="absolute inset-0 overflow-hidden rounded-md" style={{ backfaceVisibility: "hidden" }}>
                <PageFace page={pages[leaf]} />
              </div>
              <div
                className="absolute inset-0 overflow-hidden rounded-md"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", backgroundColor: pages[leaf]?.bg ?? "#fff" }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => go("prev")}
          disabled={cur <= 0 || !!flip}
          aria-label="Página anterior"
          className="rounded-full border border-border bg-surface p-2 text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs tabular-nums text-foreground-muted">{cur + 1} / {pages.length}</span>
        <button
          type="button"
          onClick={() => go("next")}
          disabled={cur >= max || !!flip}
          aria-label="Próxima página"
          className="rounded-full border border-border bg-surface p-2 text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
