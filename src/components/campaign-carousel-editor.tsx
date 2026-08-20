"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  Images,
  Link2,
  Loader2,
  MoveLeft,
  MoveRight,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { sendCampaignArtifact, toggleArtifactPosted, updateDocumentContent } from "@/app/actions/campaigns";
import { signPostMediaUpload } from "@/app/actions/post-creator";
import type { CampaignPreviewBrand } from "@/components/campaign-document-preview";

// The Instagram-carousel "social post editor": a caption (EN + optional PT) plus
// an ordered list of slide image URLs. Seeded from the Weekly Stoken featured
// posts, then editable — reorder/add/remove slides, tweak the caption — and
// publishable as a real IG carousel via sendCampaignArtifact.

type Carousel = { caption: string; captionPt: string; slides: string[] };

function parseCarousel(raw: string): Carousel {
  try {
    const o = JSON.parse(raw) as Partial<Carousel>;
    return {
      caption: typeof o.caption === "string" ? o.caption : "",
      captionPt: typeof o.captionPt === "string" ? o.captionPt : "",
      slides: Array.isArray(o.slides) ? o.slides.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    // Legacy / hand-written docs: treat the whole thing as the caption.
    return { caption: raw, captionPt: "", slides: [] };
  }
}

async function uploadToPinata(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const signed = await signPostMediaUpload(file.name, file.size, file.type);
  if (!signed.ok) return signed;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("network", "public");
  const res = await fetch(signed.url, { method: "POST", body: fd });
  if (!res.ok) return { ok: false, error: `Pinata HTTP ${res.status}` };
  const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
  const cid = json?.data?.cid;
  if (!cid) return { ok: false, error: "Pinata não retornou CID." };
  return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
}

export function CampaignCarouselEditor({
  documentId,
  initialName,
  initialContent,
  initialPostedAt,
  brand,
  onContentChange,
}: {
  documentId: string;
  initialName: string;
  initialContent: string;
  initialPostedAt: Date | null;
  brand?: CampaignPreviewBrand;
  onContentChange?: (c: string) => void;
}) {
  const [data, setData] = useState<Carousel>(() => parseCarousel(initialContent));
  const [showPt, setShowPt] = useState(false);
  const [active, setActive] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [postedAt, setPostedAt] = useState<Date | null>(initialPostedAt);
  const [sendStatus, setSendStatus] = useState<null | { ok: true; url?: string } | { ok: false; error: string }>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  const { caption, captionPt, slides } = data;

  // Debounced autosave whenever the caption or slides change.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaveState("saving");
    const serialized = JSON.stringify(data);
    onContentChange?.(serialized);
    const t = setTimeout(async () => {
      await updateDocumentContent(documentId, serialized);
      setSaveState("saved");
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, documentId]);

  const clampActive = (n: number, len: number) => Math.max(0, Math.min(len - 1, n));

  function addUrl() {
    const u = urlInput.trim();
    if (!/^https?:\/\/\S+$/.test(u)) { setAddError("URL de imagem inválida."); return; }
    if (slides.length >= 10) { setAddError("Máximo de 10 imagens."); return; }
    setAddError(null);
    setData((d) => ({ ...d, slides: [...d.slides, u] }));
    setUrlInput("");
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setAddError("Selecione uma imagem."); return; }
    if (slides.length >= 10) { setAddError("Máximo de 10 imagens."); return; }
    setAddError(null);
    setUploading(true);
    try {
      const r = await uploadToPinata(f);
      if (r.ok) setData((d) => ({ ...d, slides: [...d.slides, r.url] }));
      else setAddError(r.error);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function move(idx: number, dir: -1 | 1) {
    setData((d) => {
      const next = [...d.slides];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...d, slides: next };
    });
  }
  function removeSlide(idx: number) {
    setData((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== idx) }));
    setActive((a) => clampActive(a > idx ? a - 1 : a, slides.length - 1));
  }

  function publish() {
    if (slides.length < 2) { setSendStatus({ ok: false, error: "Precisa de pelo menos 2 imagens." }); return; }
    if (!window.confirm(`Publicar este carrossel (${slides.length} imagens) no Instagram agora?`)) return;
    setSendStatus(null);
    startTransition(async () => {
      const res = await sendCampaignArtifact(documentId);
      if (res.ok) {
        setSendStatus({ ok: true, url: res.url });
        setPostedAt(new Date());
      } else {
        setSendStatus({ ok: false, error: res.error });
      }
    });
  }

  function togglePosted() {
    startTransition(async () => {
      const res = await toggleArtifactPosted(documentId);
      if (res.ok) setPostedAt(res.postedAt ? new Date(res.postedAt) : null);
    });
  }

  const cur = slides[clampActive(active, slides.length)] ?? null;
  const handle = brand?.handle ?? "skatehive";
  const displayName = brand?.displayName ?? "SkateHive";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-surface/70">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-pink-500/15 text-pink-400">
              <Images className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{initialName}</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
                Instagram carousel · {slides.length} {slides.length === 1 ? "imagem" : "imagens"}
                {saveState === "saving" ? " · salvando…" : saveState === "saved" ? " · salvo" : ""}
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          {/* ── Preview ── */}
          <div>
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-border bg-surface">
              {cur ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cur} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-foreground-faint">Sem imagens</div>
              )}
              {slides.length > 1 && (
                <>
                  <button type="button" onClick={() => setActive((a) => clampActive(a - 1, slides.length))} className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70" aria-label="Anterior">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setActive((a) => clampActive(a + 1, slides.length))} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70" aria-label="Próxima">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                    {slides.map((_, i) => (
                      <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === clampActive(active, slides.length) ? "bg-white" : "bg-white/40"}`} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="mt-2 flex items-start gap-2">
              {brand?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : null}
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">
                <span className="font-semibold">{handle}</span>{" "}
                {(showPt ? captionPt : caption) || <span className="text-foreground-faint">(sem legenda)</span>}
              </p>
            </div>
          </div>

          {/* ── Editor ── */}
          <div className="space-y-4">
            {/* caption */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">Legenda {showPt ? "(PT)" : "(EN)"}</label>
                <button type="button" onClick={() => setShowPt((v) => !v)} className="text-[11px] text-accent hover:underline">
                  {showPt ? "Ver EN" : "Ver PT"}
                </button>
              </div>
              <textarea
                value={showPt ? captionPt : caption}
                onChange={(e) => setData((d) => (showPt ? { ...d, captionPt: e.target.value } : { ...d, caption: e.target.value }))}
                rows={7}
                placeholder={showPt ? "Legenda em português…" : "Caption in English…"}
                className="w-full resize-y rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-foreground-faint">{displayName} · o carrossel publica com a legenda EN. A PT fica guardada para reaproveitar.</p>
            </div>

            {/* slides */}
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">Slides ({slides.length}/10)</label>
              <ul className="space-y-2">
                {slides.map((s, i) => (
                  <li key={`${s}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated p-1.5">
                    <span className="w-4 text-center text-[10px] text-foreground-faint">{i + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">{s}</span>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><MoveLeft className="h-3.5 w-3.5 rotate-90" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label="Descer" className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><MoveRight className="h-3.5 w-3.5 rotate-90" /></button>
                    <button type="button" onClick={() => removeSlide(i)} aria-label="Remover" className="rounded p-1 text-foreground-subtle hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
                {slides.length === 0 && <li className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-foreground-faint">Nenhum slide ainda.</li>}
              </ul>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || slides.length >= 10} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Enviar imagem
                </button>
                <div className="flex min-w-[180px] flex-1 items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }}
                    placeholder="Colar URL de imagem"
                    className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:outline-none"
                  />
                  <button type="button" onClick={addUrl} disabled={slides.length >= 10} aria-label="Adicionar URL" className="rounded p-1 text-accent hover:bg-accent-bg disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </div>
              {addError && <p className="mt-1 text-xs text-danger">{addError}</p>}
            </div>
          </div>
        </div>
      </section>

      {/* ── Publish actions ── */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/70 px-5 py-3">
        <button
          type="button"
          onClick={publish}
          disabled={pending || slides.length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 py-1.5 text-xs font-medium text-pink-400 transition hover:bg-pink-500/20 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Publicar carrossel
        </button>
        <button type="button" onClick={togglePosted} disabled={pending} className="inline-flex items-center gap-1.5 text-xs text-foreground-muted transition hover:text-foreground">
          {postedAt ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4" />}
          {postedAt ? "Publicado" : "Marcar publicado"}
        </button>
        {sendStatus?.ok && sendStatus.url && (
          <a href={sendStatus.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Ver no Instagram <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {sendStatus && !sendStatus.ok && <span className="text-xs text-danger">{sendStatus.error}</span>}
        {slides.length < 2 && <span className="text-[11px] text-foreground-faint">Adicione ao menos 2 imagens para publicar.</span>}
      </section>
    </div>
  );
}
