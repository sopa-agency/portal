"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Eye, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createHomepagePreviewToken,
  publishHomepage,
  saveHomepageSection,
  unpublishHomepage,
  type HomepageMeta,
  type HomepageVersionSummary,
} from "@/app/actions/homepage";
import type {
  BountyRef,
  HeroSlide,
  HomepageConfigDoc,
  JunkItem,
  StripCard,
} from "@/lib/homepage-config";
import { ImageSourcePicker } from "@/components/image-source-picker";
import { PostSearchModal } from "@/components/homepage/post-search-modal";
import {
  listHomepageBountyCandidates,
  listHomepageSpotCandidates,
  type PickerBounty,
  type PickerPost,
  type PickerSpot,
} from "@/app/actions/homepage-pickers";

// The homepage composer: edits a draft HomepageConfig section-by-section
// (each Save is an independent saveHomepageSection patch), previews it on
// skatehive.app/home?preview=<token>, and publishes. Portal semantic tokens
// (light+dark). Mirrors the magazine curator's optimistic-then-refetch feel.

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
const input = "w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50";
const accentBtn = "inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50";

type Msg = { ok: boolean; text: string } | null;

export function HomepageComposer({
  initialConfig,
  initialMeta,
  versions,
  activeId,
}: {
  initialConfig: HomepageConfigDoc;
  initialMeta: HomepageMeta;
  versions: HomepageVersionSummary[];
  activeId: string | null;
}) {
  const [config, setConfig] = useState<HomepageConfigDoc>(initialConfig);
  const [meta, setMeta] = useState<HomepageMeta>(initialMeta);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, startPublish] = useTransition();

  // Debounced persistence. Typing updates local state IMMEDIATELY (smooth,
  // controlled inputs) and only schedules a server save ~800ms later — the
  // server response is NOT echoed back into `config`, so an in-flight keystroke
  // is never clobbered (that was what stole focus / broke the keyboard).
  const pendingRef = useRef<Partial<HomepageConfigDoc>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const patch = pendingRef.current;
    if (Object.keys(patch).length === 0) return true;
    pendingRef.current = {};
    setSaving(true);
    const r = await saveHomepageSection(meta.id, patch);
    setSaving(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return false; }
    setMsg({ ok: true, text: "Salvo." });
    return true;
  }, [meta.id]);

  const save = useCallback(
    (patch: Partial<HomepageConfigDoc>) => {
      setConfig((c) => ({ ...c, ...patch }));
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { void flush(); }, 800);
    },
    [flush],
  );

  // Persist any pending edits when leaving the page.
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  function doPublish() {
    startPublish(async () => {
      if (!(await flush())) return; // persist latest edits before validating
      const r = await publishHomepage(meta.id);
      if (r.ok) { setMeta((m) => ({ ...m, status: "published" })); setMsg({ ok: true, text: `Publicado (v${r.version}).` }); }
      else setMsg({ ok: false, text: r.error });
    });
  }
  function doUnpublish() {
    startPublish(async () => {
      const r = await unpublishHomepage(meta.id);
      if (r.ok) { setMeta((m) => ({ ...m, status: "draft" })); setMsg({ ok: true, text: "Despublicado." }); }
      else setMsg({ ok: false, text: r.error });
    });
  }
  function doPreview() {
    startPublish(async () => {
      await flush(); // make sure the preview reflects the latest edits
      const r = await createHomepagePreviewToken(meta.id);
      if (r.ok) { window.open(r.url, "_blank", "noopener"); setMsg({ ok: true, text: "Preview aberto." }); }
      else setMsg({ ok: false, text: r.error });
    });
  }

  const published = meta.status === "published";

  return (
    <div className="space-y-6">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-sm">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${published ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {published ? "Publicada" : "Rascunho"}
          </span>
          <span className="text-foreground-subtle">v{meta.version}</span>
          {saving && <span className="inline-flex items-center gap-1 text-xs text-foreground-faint"><Loader2 className="h-3 w-3 animate-spin" /> salvando…</span>}
          {activeId && activeId !== meta.id && <span className="text-[11px] text-foreground-faint">(outra versão está no ar)</span>}
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          <button type="button" onClick={doPreview} disabled={publishing} className={btn}><Eye className="h-3.5 w-3.5" /> Preview</button>
          {published ? (
            <button type="button" onClick={doUnpublish} disabled={publishing} className={btn}>Despublicar</button>
          ) : (
            <button type="button" onClick={doPublish} disabled={publishing} className={accentBtn}>
              {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Publicar
            </button>
          )}
        </div>
      </div>

      <HeroSlidesEditor slides={config.heroSlides} onChange={(heroSlides) => save({ heroSlides })} />
      <StripEditor strip={config.strip} onChange={(strip) => save({ strip })} />
      <JunkDrawerEditor items={config.junkDrawer} onChange={(junkDrawer) => save({ junkDrawer })} />
      <FeaturedVideoEditor video={config.featuredVideo} onChange={(featuredVideo) => save({ featuredVideo })} />
      <SpotEditor spot={config.spot} onChange={(spot) => save({ spot })} />
      <BountiesEditor bounties={config.bounties} onChange={(bounties) => save({ bounties })} />
      <BannerEditor banner={config.banner} onChange={(banner) => save({ banner })} />
      <FooterEditor footer={config.footer} onChange={(footer) => save({ footer })} />
    </div>
  );
}

// ── Section shell ───────────────────────────────────────────────────────────
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface/60 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <div className="h-14 w-20 shrink-0 overflow-hidden rounded border border-border bg-surface-elevated">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full items-center justify-center text-foreground-faint"><ImagePlus className="h-4 w-4" /></div>
      )}
    </div>
  );
}

// ── 1. Hero slides ────────────────────────────────────────────────────────
function HeroSlidesEditor({ slides, onChange }: { slides: HeroSlide[]; onChange: (s: HeroSlide[]) => void }) {
  const [postPickerFor, setPostPickerFor] = useState<"new" | null>(null);
  const [imgPickerFor, setImgPickerFor] = useState<string | null>(null);

  const patch = (id: string, up: Partial<HeroSlide>) => onChange(slides.map((s) => (s.id === id ? { ...s, ...up } : s)));
  const remove = (id: string) => onChange(slides.filter((s) => s.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = slides.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= slides.length) return;
    const next = [...slides];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const addFromPost = (p: PickerPost) => {
    onChange([...slides, {
      id: uid(), image: p.thumbnail ?? "", tag: "", title: p.title, subtitle: "", meta: `@${p.author}`,
      cta: { kind: "post", author: p.author, permlink: p.permlink }, postRef: { author: p.author, permlink: p.permlink },
    }]);
    setPostPickerFor(null);
  };
  const addBlank = () => onChange([...slides, { id: uid(), image: "", tag: "", title: "", subtitle: "", meta: "", cta: null }]);

  const editing = slides.find((s) => s.id === imgPickerFor);

  return (
    <Section title="Hero (carrossel)" hint="Slides do topo. Arraste a ordem; cada slide = imagem + tag + título + subtítulo + CTA.">
      <div className="space-y-3">
        {slides.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex gap-3">
              <button type="button" onClick={() => setImgPickerFor(s.id)} title="Trocar imagem"><Thumb url={s.image || null} /></button>
              <div className="min-w-0 flex-1 space-y-2">
                <input className={input} placeholder="Título" value={s.title} onChange={(e) => patch(s.id, { title: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <input className={input} placeholder="Tag (ex: VIDEO PART)" value={s.tag} onChange={(e) => patch(s.id, { tag: e.target.value })} />
                  <input className={input} placeholder="Meta (ex: 5h ago · 239 votos)" value={s.meta} onChange={(e) => patch(s.id, { meta: e.target.value })} />
                </div>
                <input className={input} placeholder="Subtítulo" value={s.subtitle} onChange={(e) => patch(s.id, { subtitle: e.target.value })} />
                <CtaEditor cta={s.cta} onChange={(cta) => patch(s.id, { cta })} />
              </div>
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => move(s.id, -1)} disabled={i === 0} className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(s.id, 1)} disabled={i === slides.length - 1} className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => remove(s.id)} className="rounded p-1 text-foreground-subtle hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        ))}
        {slides.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-foreground-faint">Nenhum slide ainda.</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setPostPickerFor("new")} className={accentBtn}><Plus className="h-3.5 w-3.5" /> De um post</button>
          <button type="button" onClick={addBlank} className={btn}><Plus className="h-3.5 w-3.5" /> Em branco</button>
        </div>
      </div>

      {postPickerFor && <PostSearchModal onPick={addFromPost} onClose={() => setPostPickerFor(null)} />}
      {editing && <ImageSourcePicker title="Imagem do slide" postRef={editing.postRef} onPick={(url) => { patch(editing.id, { image: url }); setImgPickerFor(null); }} onClose={() => setImgPickerFor(null)} />}
    </Section>
  );
}

function CtaEditor({ cta, onChange }: { cta: HeroSlide["cta"]; onChange: (c: HeroSlide["cta"]) => void }) {
  const kind = cta?.kind ?? "none";
  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground"
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          if (k === "none") onChange(null);
          else if (k === "url") onChange({ kind: "url", url: "" });
          else if (k === "post") onChange({ kind: "post", author: "", permlink: "" });
          else onChange({ kind: "spot", id: "" });
        }}
      >
        <option value="none">Sem CTA</option>
        <option value="url">URL</option>
        <option value="post">Post</option>
        <option value="spot">Spot</option>
      </select>
      {cta?.kind === "url" && <input className={input} placeholder="https://…" value={cta.url} onChange={(e) => onChange({ kind: "url", url: e.target.value })} />}
      {cta?.kind === "post" && (
        <input className={input} placeholder="@autor/permlink" value={cta.author ? `${cta.author}/${cta.permlink}` : ""}
          onChange={(e) => { const m = e.target.value.replace(/^@/, "").match(/^([^/]+)\/(.+)$/); onChange({ kind: "post", author: m?.[1] ?? "", permlink: m?.[2] ?? "" }); }} />
      )}
      {cta?.kind === "spot" && <input className={input} placeholder="ID do spot" value={cta.id} onChange={(e) => onChange({ kind: "spot", id: e.target.value })} />}
    </div>
  );
}

// ── 2. Featured strip (exactly 4) ───────────────────────────────────────────
function StripEditor({ strip, onChange }: { strip: StripCard[]; onChange: (s: StripCard[]) => void }) {
  const [pickFor, setPickFor] = useState<number | null>(null); // slot index
  const [imgFor, setImgFor] = useState<number | null>(null);
  const slots = [0, 1, 2, 3];

  const setSlot = (i: number, card: StripCard | null) => {
    const next = [...strip];
    if (card) next[i] = card; else next.splice(i, 1);
    onChange(next.filter(Boolean).slice(0, 4));
  };
  const pick = (p: PickerPost) => {
    if (pickFor === null) return;
    const card: StripCard = { id: uid(), postRef: { author: p.author, permlink: p.permlink }, image: p.thumbnail ?? "", title: p.title };
    const next = [...strip];
    next[pickFor] = card;
    onChange(next.slice(0, 4));
    setPickFor(null);
  };
  const editing = imgFor !== null ? strip[imgFor] : undefined;

  return (
    <Section title="Faixa em destaque (4 cards)" hint="Exatamente 4 posts. Clique num slot para escolher o post; a miniatura vem do post (pode trocar).">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {slots.map((i) => {
          const c = strip[i];
          return (
            <div key={i} className="rounded-xl border border-border bg-surface p-2">
              {c ? (
                <>
                  <button type="button" onClick={() => setImgFor(i)} className="block w-full">
                    <div className="aspect-[4/3] w-full overflow-hidden rounded border border-border bg-surface-elevated">
                      {c.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.image} alt="" className="h-full w-full object-cover" />
                      ) : <div className="flex h-full items-center justify-center text-foreground-faint"><ImagePlus className="h-5 w-5" /></div>}
                    </div>
                  </button>
                  <input className={`${input} mt-2`} value={c.category ?? ""} onChange={(e) => setSlot(i, { ...c, category: e.target.value })} placeholder="Categoria (ex: STREET LIFE)" />
                  <input className={`${input} mt-1.5`} value={c.title} onChange={(e) => setSlot(i, { ...c, title: e.target.value })} placeholder="Título" />
                  <div className="mt-1 flex justify-between">
                    <button type="button" onClick={() => setPickFor(i)} className="text-[11px] text-accent hover:underline">Trocar post</button>
                    <button type="button" onClick={() => setSlot(i, null)} className="text-[11px] text-danger hover:underline">Remover</button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => setPickFor(i)} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-foreground-faint hover:border-border-strong hover:text-foreground">
                  <Plus className="h-5 w-5" /><span className="text-[11px]">Card {i + 1}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      {pickFor !== null && <PostSearchModal onPick={pick} onClose={() => setPickFor(null)} />}
      {editing && <ImageSourcePicker title="Imagem do card" postRef={editing.postRef} onPick={(url) => { setSlot(imgFor!, { ...editing, image: url }); setImgFor(null); }} onClose={() => setImgFor(null)} />}
    </Section>
  );
}

// ── 3. Junk drawer ──────────────────────────────────────────────────────────
function JunkDrawerEditor({ items, onChange }: { items: JunkItem[]; onChange: (i: JunkItem[]) => void }) {
  const [pickNew, setPickNew] = useState(false);
  const [imgFor, setImgFor] = useState<string | null>(null);
  const patch = (id: string, up: Partial<JunkItem>) => onChange(items.map((it) => (it.id === id ? { ...it, ...up } : it)));
  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = items.findIndex((it) => it.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  const add = (p: PickerPost) => { onChange([...items, { id: uid(), postRef: { author: p.author, permlink: p.permlink }, thumb: p.thumbnail ?? "", title: p.title, blurb: "" }]); setPickNew(false); };
  const editing = items.find((it) => it.id === imgFor);
  return (
    <Section title="Junk Drawer" hint="Lista lateral (até 6). Miniatura + título + blurb curto.">
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={it.id} className="flex gap-3 rounded-xl border border-border bg-surface p-2">
            <button type="button" onClick={() => setImgFor(it.id)}><Thumb url={it.thumb || null} /></button>
            <div className="min-w-0 flex-1 space-y-1.5">
              <input className={input} placeholder="Título" value={it.title} onChange={(e) => patch(it.id, { title: e.target.value })} />
              <input className={input} placeholder="Blurb" value={it.blurb} onChange={(e) => patch(it.id, { blurb: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" onClick={() => move(it.id, -1)} disabled={i === 0} className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => move(it.id, 1)} disabled={i === items.length - 1} className="rounded p-1 text-foreground-subtle hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => remove(it.id)} className="rounded p-1 text-foreground-subtle hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
        {items.length < 6 && <button type="button" onClick={() => setPickNew(true)} className={accentBtn}><Plus className="h-3.5 w-3.5" /> Adicionar item</button>}
      </div>
      {pickNew && <PostSearchModal onPick={add} onClose={() => setPickNew(false)} />}
      {editing && <ImageSourcePicker title="Miniatura" postRef={editing.postRef} onPick={(url) => { patch(editing.id, { thumb: url }); setImgFor(null); }} onClose={() => setImgFor(null)} />}
    </Section>
  );
}

// ── 4. Featured video ────────────────────────────────────────────────────────
function FeaturedVideoEditor({ video, onChange }: { video: HomepageConfigDoc["featuredVideo"]; onChange: (v: HomepageConfigDoc["featuredVideo"]) => void }) {
  const [pick, setPick] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  return (
    <Section title="Vídeo em destaque" hint="O card grande de vídeo ao lado do Junk Drawer.">
      {video ? (
        <div className="flex gap-3 rounded-xl border border-border bg-surface p-3">
          <button type="button" onClick={() => setImgOpen(true)}><Thumb url={video.cover || null} /></button>
          <div className="min-w-0 flex-1 space-y-2">
            <input className={input} placeholder="Título" value={video.title} onChange={(e) => onChange({ ...video, title: e.target.value })} />
            <input className={input} placeholder="Legenda" value={video.caption} onChange={(e) => onChange({ ...video, caption: e.target.value })} />
            <div className="flex gap-3">
              <button type="button" onClick={() => setPick(true)} className="text-[11px] text-accent hover:underline">Trocar post</button>
              <button type="button" onClick={() => onChange(null)} className="text-[11px] text-danger hover:underline">Remover</button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setPick(true)} className={accentBtn}><Plus className="h-3.5 w-3.5" /> Escolher post</button>
      )}
      {pick && <PostSearchModal onPick={(p) => { onChange({ postRef: { author: p.author, permlink: p.permlink }, cover: p.thumbnail ?? "", title: p.title, caption: video?.caption ?? "" }); setPick(false); }} onClose={() => setPick(false)} />}
      {imgOpen && video && <ImageSourcePicker title="Capa do vídeo" postRef={video.postRef} onPick={(url) => { onChange({ ...video, cover: url }); setImgOpen(false); }} onClose={() => setImgOpen(false)} />}
    </Section>
  );
}

// ── 5. Spot ───────────────────────────────────────────────────────────────
function SpotEditor({ spot, onChange }: { spot: HomepageConfigDoc["spot"]; onChange: (s: HomepageConfigDoc["spot"]) => void }) {
  const [open, setOpen] = useState(false);
  const [spots, setSpots] = useState<PickerSpot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    setOpen(true);
    if (spots || loading) return;
    setLoading(true); setErr(null);
    const r = await listHomepageSpotCandidates();
    if (r.ok) setSpots(r.spots); else setErr(r.error);
    setLoading(false);
  };
  return (
    <Section title="Spot em destaque" hint="Escolha um spot. Vazio = o site usa o spot em destaque ao vivo.">
      {spot ? (
        <div className="flex gap-3 rounded-xl border border-border bg-surface p-3">
          <Thumb url={spot.image || null} />
          <div className="flex-1"><p className="text-sm text-foreground">{spot.name}</p><p className="text-[11px] text-foreground-subtle">{spot.coords ?? ""}</p></div>
          <div className="flex gap-3"><button type="button" onClick={load} className="text-[11px] text-accent hover:underline">Trocar</button><button type="button" onClick={() => onChange(null)} className="text-[11px] text-danger hover:underline">Limpar</button></div>
        </div>
      ) : (
        <button type="button" onClick={load} className={accentBtn}><Plus className="h-3.5 w-3.5" /> Escolher spot</button>
      )}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold text-foreground">Spots</p>
            {loading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
            {err && <p className="text-xs text-danger">{err}</p>}
            <div className="grid grid-cols-2 gap-2">
              {spots?.map((s) => (
                <button key={s.id} type="button" onClick={() => { onChange({ id: s.id, name: s.name, image: s.image ?? "", author: s.author, permlink: s.permlink, coords: s.coords }); setOpen(false); }}
                  className="overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:border-accent-border">
                  <div className="aspect-video w-full overflow-hidden bg-surface-elevated">
                    {s.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <p className="truncate px-2 py-1.5 text-xs text-foreground">{s.name}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── 6. Bounties ─────────────────────────────────────────────────────────────
function BountiesEditor({ bounties, onChange }: { bounties: BountyRef[]; onChange: (b: BountyRef[]) => void }) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<PickerBounty[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    setOpen(true);
    if (cands || loading) return;
    setLoading(true); setErr(null);
    const r = await listHomepageBountyCandidates();
    if (r.ok) setCands(r.bounties); else setErr(r.error);
    setLoading(false);
  };
  const has = (id: string) => bounties.some((b) => b.source === "poidh" && b.id === id);
  const toggle = (c: PickerBounty) => {
    if (has(c.id)) onChange(bounties.filter((b) => !(b.source === "poidh" && b.id === c.id)));
    else onChange([...bounties, { source: "poidh", id: c.id, chainId: c.chainId, name: c.name, issuer: c.issuer, image: c.image ?? undefined, amount: c.amount }]);
  };
  return (
    <Section title="Bounties" hint="Bounties abertos exibidos no card de recompensas. O valor em USD é calculado ao vivo no site.">
      <div className="space-y-2">
        {bounties.map((b, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
            <span className="truncate text-sm text-foreground">{b.source === "poidh" ? b.name || `Bounty ${b.id}` : b.title}</span>
            <button type="button" onClick={() => onChange(bounties.filter((_, j) => j !== i))} className="text-[11px] text-danger hover:underline">Remover</button>
          </div>
        ))}
        <button type="button" onClick={load} className={accentBtn}><Plus className="h-3.5 w-3.5" /> Escolher bounties</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold text-foreground">Bounties abertos</p>
            {loading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
            {err && <p className="text-xs text-danger">{err}</p>}
            <div className="space-y-2">
              {cands?.map((c) => (
                <button key={c.id} type="button" onClick={() => toggle(c)} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${has(c.id) ? "border-accent-border bg-accent-bg" : "border-border bg-surface hover:border-border-strong"}`}>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.name || `Bounty ${c.id}`}</span>
                  {has(c.id) && <Check className="h-4 w-4 text-accent" />}
                </button>
              ))}
              {cands && cands.length === 0 && <p className="py-4 text-center text-[11px] text-foreground-faint">Nenhum bounty aberto.</p>}
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

// ── 7 + 8. Banner + footer ───────────────────────────────────────────────────
function BannerEditor({ banner, onChange }: { banner: HomepageConfigDoc["banner"]; onChange: (b: HomepageConfigDoc["banner"]) => void }) {
  return (
    <Section title="Banner da comunidade" hint="O bloco verde de chamada para o feed.">
      <div className="space-y-2">
        <input className={input} placeholder="Título" value={banner.headline} onChange={(e) => onChange({ ...banner, headline: e.target.value })} />
        <input className={input} placeholder="Subtexto" value={banner.subtext} onChange={(e) => onChange({ ...banner, subtext: e.target.value })} />
        <input className={input} placeholder="Rótulo do botão" value={banner.ctaLabel} onChange={(e) => onChange({ ...banner, ctaLabel: e.target.value })} />
      </div>
    </Section>
  );
}

function FooterEditor({ footer, onChange }: { footer: HomepageConfigDoc["footer"]; onChange: (f: HomepageConfigDoc["footer"]) => void }) {
  return (
    <Section title="Rodapé" hint="Tagline do rodapé.">
      <input className={input} placeholder="Tagline" value={footer.tagline} onChange={(e) => onChange({ tagline: e.target.value })} />
    </Section>
  );
}
