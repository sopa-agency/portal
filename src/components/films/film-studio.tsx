"use client";

// Estúdio de filmes de feature: menu de cenas, prévia com scrubber, formato,
// exportação em MP4 no navegador (captureStream + MediaRecorder, sem servidor),
// legenda com "Copiar tweet" e o playbook num painel lateral. A parte de
// gravação é a do FeatureStudio.tsx do swaps.pro (@ 38c1644), adaptada.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, Check, Copy, Film, HardDrive, Loader2, Pause, Pencil, Play, RotateCcw, Save, Sparkles, Square, Undo2, X } from "lucide-react";
import { resetFilmText, saveFilmText } from "@/app/actions/films";
import { useLocale } from "@/components/locale-provider";
import { MarkdownContent } from "@/components/markdown-content";
import { fetchDriveIndex, loadFilmAssets, type DriveIndex } from "@/lib/films/assets";
import { filmsForProject } from "@/lib/films";
import { renderFilm } from "@/lib/films/render";
import { applyText, captionOf, FORMATS, sceneAt, supportedVideoType, textOf, totalSeconds, type AssetSource, type FeatureFilm, type FilmAsset, type FilmAssets, type FilmBrand, type FilmFormat, type FilmText } from "@/lib/films/types";

const STR = {
  pt: {
    title: "Filmes de feature",
    subtitle: "Um filme curto por página do produto, pareado com o tweet da campanha. Exporta em MP4 aqui mesmo, sem servidor.",
    sequence: "CENAS",
    preview: "PRÉVIA",
    recording: "GERANDO VÍDEO",
    format: "Formato do vídeo",
    play: "Reproduzir",
    pause: "Pausar",
    reset: "Reiniciar",
    position: "Posição do vídeo",
    all: "Todas as cenas",
    generate: "Gerar vídeo",
    cancel: "Cancelar",
    download: "Baixar",
    tweet: "TWEET DESTA CENA",
    copy: "Copiar tweet",
    copied: "Copiado",
    exampleValues: "Este filme mostra valores de exemplo. A legenda precisa dizer isso (\"scripted walkthrough, example amounts\") antes de postar.",
    fromCampaign: "Legenda do documento",
    playbook: "Playbook",
    assetsLoading: "Preparando logo e assets…",
    retry: "Tentar novamente",
    drive: "Drive",
    driveMissing: (n: number) => `${n} asset(s) do Drive não encontrados; a cena desenha sem eles.`,
    driveOk: (n: number) => `Drive conectado · ${n} arquivo(s) na pasta 🎬 Filmes`,
    noteMp4: (s: number) => `Exportação local em MP4. Leva ${s} s; mantenha esta aba visível. Vídeo sem áudio.`,
    noteWebm: (s: number) => `Exportação local em WebM (converta para MP4 antes de postar no X). Leva ${s} s; mantenha esta aba visível. Vídeo sem áudio.`,
    noRecorder: "Se a exportação não estiver disponível, reproduza a cena e grave a tela.",
    ready: "Filme pronto. Baixe o arquivo para publicar.",
    hidden: "Exportação cancelada porque a aba ficou oculta. Mantenha esta aba visível e tente de novo.",
    failed: "Não foi possível concluir o vídeo. Tente de novo ou grave a prévia.",
    empty: "O navegador devolveu um arquivo vazio. Tente outro formato.",
    noSupport: "Este navegador não conseguiu exportar. Tente outro navegador.",
    cancelled: "Exportação cancelada.",
    copyFail: "Selecione e copie o texto manualmente.",
    noFilms: "Este projeto ainda não tem roteiros. O playbook explica como escrever os primeiros.",
    films: (n: number, s: number) => `${n} filmes · ${s} s`,
    edit: "Editar texto",
    save: "Salvar",
    saving: "Salvando…",
    restore: "Restaurar roteiro",
    close: "Fechar",
    headline1: "Manchete, linha 1",
    headline2: "Manchete, linha 2",
    subtitleField: "Subtítulo",
    captions: "Legendas, uma por estágio",
    tweetField: "Tweet (legenda do post)",
    edited: "editado",
    saved: "Texto salvo. A prévia e a exportação já usam o novo.",
    restored: "Roteiro restaurado.",
  },
  en: {
    title: "Feature films",
    subtitle: "One short film per product page, paired with the campaign tweet. Exports to MP4 right here, no server.",
    sequence: "SCENES",
    preview: "PREVIEW",
    recording: "RECORDING",
    format: "Video format",
    play: "Play",
    pause: "Pause",
    reset: "Restart",
    position: "Video position",
    all: "All scenes",
    generate: "Generate video",
    cancel: "Cancel",
    download: "Download",
    tweet: "TWEET FOR THIS SCENE",
    copy: "Copy tweet",
    copied: "Copied",
    exampleValues: "This film shows example values. The caption must say so (\"scripted walkthrough, example amounts\") before posting.",
    fromCampaign: "Caption from document",
    playbook: "Playbook",
    assetsLoading: "Preparing logo and assets…",
    retry: "Try again",
    drive: "Drive",
    driveMissing: (n: number) => `${n} Drive asset(s) not found; the scene draws without them.`,
    driveOk: (n: number) => `Drive connected · ${n} file(s) in the 🎬 Filmes folder`,
    noteMp4: (s: number) => `Local MP4 export. Takes ${s} s; keep this tab visible. No audio.`,
    noteWebm: (s: number) => `Local WebM export (convert to MP4 before posting on X). Takes ${s} s; keep this tab visible. No audio.`,
    noRecorder: "If export is unavailable, play the scene and record the screen.",
    ready: "Film ready. Download the file to publish.",
    hidden: "Export cancelled because the tab was hidden. Keep this tab visible and try again.",
    failed: "Could not finish the video. Try again or record the preview.",
    empty: "The browser returned an empty file. Try another format.",
    noSupport: "This browser could not export. Try another browser.",
    cancelled: "Export cancelled.",
    copyFail: "Select and copy the text manually.",
    noFilms: "This project has no scripts yet. The playbook explains how to write the first ones.",
    films: (n: number, s: number) => `${n} films · ${s} s`,
    edit: "Edit text",
    save: "Save",
    saving: "Saving…",
    restore: "Restore script",
    close: "Close",
    headline1: "Headline, line 1",
    headline2: "Headline, line 2",
    subtitleField: "Subtitle",
    captions: "Captions, one per stage",
    tweetField: "Tweet (post caption)",
    edited: "edited",
    saved: "Text saved. Preview and export already use it.",
    restored: "Script restored.",
  },
};

type AssetState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; assets: FilmAssets; missing: string[]; drive: { ok: true; count: number } | { ok: false; note: string } };

export function FilmStudio({ projectSlug, accent, logo, playbook, githubRepo, texts: initialTexts }: { projectSlug: string; accent: string; logo: string; playbook: string; githubRepo?: string; texts: Record<string, FilmText> }) {
  const { locale } = useLocale();
  const s = STR[locale === "pt" ? "pt" : "en"];
  const set = useMemo(() => filmsForProject(projectSlug), [projectSlug]);
  const brand = useMemo<FilmBrand>(() => ({ name: set?.brand.name ?? projectSlug, site: set?.brand.site ?? "", accent, logo: `public:${logo}` }), [set, projectSlug, accent, logo]);
  // Os roteiros em código (para carregar assets) e os mesmos com os textos
  // editados por cima (para desenhar, copiar e exportar).
  const baseFilms = useMemo(() => set?.films ?? [], [set]);
  const [texts, setTexts] = useState<Record<string, FilmText>>(initialTexts);
  const [draft, setDraft] = useState<{ id: string; text: FilmText } | null>(null);
  const [saving, setSaving] = useState(false);
  const films = useMemo(() => baseFilms.map((f) => applyText(f, draft && draft.id === f.id ? draft.text : texts[f.id])), [baseFilms, texts, draft]);

  const [selected, setSelected] = useState(0);
  const [format, setFormat] = useState<FilmFormat>("landscape");
  const [all, setAll] = useState(false);
  const [time, setTime] = useState(2.5);
  const [assetState, setAssetState] = useState<AssetState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [videoType, setVideoType] = useState<string | undefined>();
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const urlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const film = films[Math.min(selected, Math.max(0, films.length - 1))];
  const take = all ? films : film ? [film] : [];
  const duration = take.length ? totalSeconds(take) : 0;
  const current = take.length ? sceneAt(time, take) : null;
  const dims = FORMATS[format];
  const assets = assetState.status === "ready" ? assetState.assets : null;

  // Assets por cena: tudo que está no namespace "<id>:" (imagens e cenas 3D
  // preparadas) mais o logo da marca.
  const assetsFor = useCallback(
    (f: FeatureFilm): FilmAssets => {
      if (!assets) return {};
      const view: FilmAssets = { logo: assets.logo };
      const prefix = `${f.id}:`;
      for (const key of Object.keys(assets)) if (key.startsWith(prefix)) view[key.slice(prefix.length)] = assets[key];
      return view;
    },
    [assets],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (typeof MediaRecorder !== "undefined") setVideoType(supportedVideoType(MediaRecorder));
    return () => {
      mountedRef.current = false;
      cancelRef.current?.();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setAssetState({ status: "loading" });
    (async () => {
      const driveResult = await fetchDriveIndex().catch((e: unknown) => ({ ok: false as const, note: e instanceof Error ? e.message : String(e) }));
      const drive: DriveIndex | null = driveResult.ok ? driveResult.index : null;
      const sources: Record<string, AssetSource> = { logo: brand.logo };
      for (const f of baseFilms) for (const [key, src] of Object.entries(f.assets ?? {})) sources[`${f.id}:${key}`] = src;
      const loaded = await loadFilmAssets(sources, drive, ["logo"]);
      // Cenas 3D e outros assets que não são imagem: preparados uma vez, em
      // paralelo; uma que falhe entra em "missing" e o filme desenha sem ela.
      const missing = [...loaded.missing];
      const prepared = await Promise.all(
        baseFilms.map(async (f) => {
          if (!f.prepare) return {} as Record<string, FilmAsset>;
          try {
            const r = await f.prepare({ accent });
            return Object.fromEntries(Object.entries(r).map(([k, v]) => [`${f.id}:${k}`, v]));
          } catch (e) {
            console.warn(`[films] prepare ${f.id}:`, e);
            missing.push(`${f.id}:3d`);
            return {} as Record<string, FilmAsset>;
          }
        }),
      );
      if (!active) return;
      setAssetState({ status: "ready", assets: Object.assign({}, loaded.assets, ...prepared), missing: missing.sort(), drive: driveResult.ok ? { ok: true, count: driveResult.index.size } : { ok: false, note: driveResult.note } });
    })().catch((e: unknown) => {
      if (active) setAssetState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      active = false;
    };
  }, [brand.logo, baseFilms, attempt, accent]);

  useEffect(() => {
    if (canvasRef.current && assets && current) renderFilm(canvasRef.current, current.film, current.local, assetsFor(current.film), brand);
  }, [current, format, assets, assetsFor, brand]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.1);
      last = now;
      setTime((v) => {
        const next = Math.min(duration, v + delta);
        if (next >= duration) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  function reset() {
    setPlaying(false);
    setTime(0);
    setCopied(false);
  }
  function togglePlay() {
    if (time >= duration) setTime(0);
    setPlaying((v) => !v);
  }
  function startEdit() {
    if (!film) return;
    setDraft({ id: film.id, text: textOf(film) });
    setMessage("");
  }
  function patchDraft(patch: Partial<FilmText>) {
    setDraft((d) => (d ? { ...d, text: { ...d.text, ...patch } } : d));
  }
  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await saveFilmText(draft.id, draft.text);
      if (r.ok) {
        setTexts((all) => ({ ...all, [draft.id]: r.text }));
        setDraft(null);
        setMessage(s.saved);
      } else setMessage(r.error);
    } finally {
      setSaving(false);
    }
  }
  async function resetDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await resetFilmText(draft.id);
      if (r.ok) {
        setTexts((all) => {
          const next = { ...all };
          delete next[draft.id];
          return next;
        });
        setDraft(null);
        setMessage(s.restored);
      } else setMessage(r.error);
    } finally {
      setSaving(false);
    }
  }

  async function copyTweet() {
    if (!film) return;
    try {
      await navigator.clipboard.writeText(film.tweet);
      setCopied(true);
    } catch {
      setMessage(s.copyFail);
    }
  }

  function exportVideo() {
    if (!videoType || recording || !assets || !take.length) return;
    reset();
    setMessage("");
    setDownload(null);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const surface = document.createElement("canvas");
    surface.width = dims.width;
    surface.height = dims.height;
    renderFilm(surface, take[0], 0, assetsFor(take[0]), brand);
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder;
    try {
      stream = surface.captureStream(30);
      recorder = new MediaRecorder(stream, { mimeType: videoType, videoBitsPerSecond: 8_000_000 });
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      setMessage(s.noSupport);
      return;
    }
    const chunks: BlobPart[] = [];
    let frame = 0;
    let finished = false;
    let cancelled = false;
    const cleanup = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      stream?.getTracks().forEach((track) => track.stop());
      cancelRef.current = null;
    };
    const stop = (cancel: boolean) => {
      if (finished) return;
      finished = true;
      cancelled = cancel;
      cancelAnimationFrame(frame);
      if (recorder.state !== "inactive") recorder.stop();
      else cleanup();
      if (mountedRef.current) setRecording(false);
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop(true);
        if (mountedRef.current) setMessage(s.hidden);
      }
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      stop(true);
      if (mountedRef.current) setMessage(s.failed);
    };
    recorder.onstop = () => {
      cleanup();
      if (cancelled || !mountedRef.current) return;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (!blob.size) {
        setMessage(s.empty);
        return;
      }
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const ext = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
      setDownload({ url, name: `${projectSlug}-${all ? "all-features" : take[0].id}-${format}.${ext}` });
      setMessage(s.ready);
    };
    cancelRef.current = () => stop(true);
    document.addEventListener("visibilitychange", onVisibility);
    try {
      recorder.start(250);
    } catch {
      cleanup();
      setMessage(s.noSupport);
      return;
    }
    renderFilm(surface, take[0], 0, assetsFor(take[0]), brand);
    setRecording(true);
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(duration, (now - started) / 1000);
      const state = sceneAt(elapsed, take);
      renderFilm(surface, state.film, state.local, assetsFor(state.film), brand);
      setTime(elapsed);
      if (now - started >= duration * 1000 + 200) stop(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  const playbookPanel = (
    <>
      {playbookOpen && <button type="button" aria-label="Fechar" className="fixed inset-0 z-40 bg-black/50" onClick={() => setPlaybookOpen(false)} />}
      <aside className={`fixed inset-y-0 right-0 z-50 w-[min(760px,100%)] transform border-l border-border bg-surface shadow-2xl transition-transform ${playbookOpen ? "translate-x-0" : "translate-x-full"}`} aria-hidden={!playbookOpen}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><BookOpen className="h-4 w-4 text-accent" /> {s.playbook} · docs/filmes-de-feature.md</p>
          <button type="button" onClick={() => setPlaybookOpen(false)} className="rounded-md p-1 text-foreground-muted hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        <div className="h-[calc(100%-49px)] overflow-y-auto px-6 py-5">
          {playbook ? <MarkdownContent markdown={playbook} githubRepo={githubRepo} /> : <p className="text-sm text-foreground-muted">docs/filmes-de-feature.md</p>}
        </div>
      </aside>
    </>
  );

  if (!set || !film || !current) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-foreground">{s.title}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{s.noFilms}</p>
        <button type="button" onClick={() => setPlaybookOpen(true)} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-semibold text-accent"><BookOpen className="h-4 w-4" /> {s.playbook}</button>
        {playbookPanel}
      </div>
    );
  }

  const caption = captionOf(current.film, current.local);
  const total = totalSeconds(films);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent"><Film className="h-3.5 w-3.5" /> {brand.name} · {brand.site}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{s.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-foreground-muted">{s.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><p className="text-3xl font-bold leading-none text-accent">{films.length}</p><p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">{s.films(films.length, total)}</p></div>
          <button type="button" onClick={() => setPlaybookOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent/20"><BookOpen className="h-4 w-4" /> {s.playbook}</button>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-border bg-surface p-3" aria-label={s.sequence}>
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">{s.sequence}</p>
          <div className="flex flex-col gap-1">
            {films.map((item, i) => (
              <button
                key={item.id}
                type="button"
                disabled={recording}
                aria-pressed={selected === i && !all}
                onClick={() => { setSelected(i); setAll(false); setDraft(null); reset(); setPlaying(true); }}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${selected === i && !all ? "border border-accent-border bg-accent-bg text-foreground" : "border border-transparent text-foreground-muted hover:bg-surface-elevated hover:text-foreground"}`}
              >
                <span className="font-mono text-[11px] text-foreground-subtle">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 truncate font-medium">{item.label}{texts[item.id] && <span className="ml-1.5 rounded bg-accent-bg px-1 text-[9px] font-semibold uppercase tracking-wider text-accent">{s.edited}</span>}</span>
                <span className="text-[11px] text-foreground-subtle">{item.seconds}s</span>
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-border px-2 pt-3 text-[11px] text-foreground-subtle">
            {assetState.status === "ready" ? (
              <p className="flex items-start gap-1.5"><HardDrive className="mt-0.5 h-3 w-3 shrink-0" /><span>{assetState.drive.ok ? s.driveOk(assetState.drive.count) : assetState.drive.note}{assetState.missing.length > 0 && <><br />{s.driveMissing(assetState.missing.length)}</>}</span></p>
            ) : assetState.status === "error" ? (
              <p className="text-danger">{assetState.error} <button type="button" className="underline" onClick={() => setAttempt((v) => v + 1)}>{s.retry}</button></p>
            ) : (
              <p className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> {s.assetsLoading}</p>
            )}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle"><span className={`h-2 w-2 rounded-full ${recording ? "bg-danger" : "bg-accent"}`} /> {recording ? s.recording : s.preview}</p>
            <select aria-label={s.format} value={format} disabled={recording} onChange={(e) => { setFormat(e.target.value as FilmFormat); reset(); }} className="rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground">
              {Object.entries(FORMATS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </select>
          </div>
          <div className="relative mt-3 overflow-hidden rounded-2xl border border-border bg-surface" style={{ aspectRatio: `${dims.width} / ${dims.height}`, maxHeight: "70vh" }}>
            <canvas ref={canvasRef} width={dims.width} height={dims.height} className="mx-auto h-full w-auto max-w-full" role="img" aria-label={`${current.film.label}. ${caption}.`} />
            {!assets && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/80 text-sm text-foreground-muted" role="status">
                {assetState.status === "error" ? assetState.error : s.assetsLoading}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" aria-label={playing ? s.pause : s.play} disabled={recording || !assets} onClick={togglePlay} className="rounded-full border border-border bg-surface-elevated p-2 text-foreground disabled:opacity-50">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
            <button type="button" aria-label={s.reset} disabled={recording} onClick={reset} className="rounded-full border border-border bg-surface-elevated p-2 text-foreground-muted disabled:opacity-50"><RotateCcw className="h-4 w-4" /></button>
            <input aria-label={s.position} type="range" min={0} max={duration} step={0.1} value={time} disabled={recording} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} className="flex-1 accent-[var(--accent)]" />
            <span className="font-mono text-xs text-foreground-muted">{time.toFixed(1)} / {duration}s</span>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-foreground-muted"><input type="checkbox" checked={all} disabled={recording} onChange={(e) => { setAll(e.target.checked); reset(); }} /> {s.all} · {total}s</label>
            {recording ? (
              <button type="button" onClick={() => { cancelRef.current?.(); setMessage(s.cancelled); }} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"><Square className="h-4 w-4" /> {s.cancel} · {duration ? Math.round((time / duration) * 100) : 0}%</button>
            ) : (
              <button type="button" onClick={exportVideo} disabled={!videoType || !assets} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition disabled:opacity-50"><Sparkles className="h-4 w-4" /> {s.generate}{videoType ? ` · ${videoType.includes("mp4") ? "MP4" : "WebM"}` : ""}</button>
            )}
          </div>
          <p className="mt-2 text-xs text-foreground-subtle">{videoType ? (videoType.includes("mp4") ? s.noteMp4(duration) : s.noteWebm(duration)) : s.noRecorder}</p>
          {message && <p role="status" className="mt-2 text-sm text-foreground-muted">{message}</p>}
          {download && <a className="mt-2 inline-flex items-center gap-2 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-semibold text-accent" href={download.url} download={download.name}><ArrowDownToLine className="h-4 w-4" /> {s.download} {download.name}</a>}

          <section className="mt-6 rounded-2xl border border-border bg-surface p-4" aria-label={s.tweet}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">{s.tweet}{film.tweetDoc ? ` · ${s.fromCampaign} "${film.tweetDoc}"` : ""}</p>
              <button type="button" onClick={copyTweet} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1 text-xs font-semibold text-foreground">{copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {copied ? s.copied : s.copy}</button>
            </div>
            <p className="mt-3 whitespace-pre-line text-sm text-foreground">{film.tweet}</p>
            <p className="mt-2 text-xs text-foreground-subtle">{film.url}</p>
            {film.exampleValues && <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{s.exampleValues}</p>}
            {!draft && (
              <button type="button" onClick={startEdit} disabled={recording} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-semibold text-accent disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /> {s.edit}</button>
            )}
          </section>

          {draft && draft.id === film.id && (
            <section className="mt-4 rounded-2xl border border-accent-border bg-surface p-4" aria-label={s.edit}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-foreground-muted">{s.headline1}
                  <input value={draft.text.headline[0]} maxLength={60} onChange={(e) => patchDraft({ headline: [e.target.value, draft.text.headline[1]] })} className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground" />
                </label>
                <label className="text-xs text-foreground-muted">{s.headline2}
                  <input value={draft.text.headline[1]} maxLength={60} onChange={(e) => patchDraft({ headline: [draft.text.headline[0], e.target.value] })} className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground" />
                </label>
                <label className="text-xs text-foreground-muted sm:col-span-2">{s.subtitleField}
                  <input value={draft.text.subtitle} maxLength={120} onChange={(e) => patchDraft({ subtitle: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground" />
                </label>
                <div className="sm:col-span-2">
                  <p className="text-xs text-foreground-muted">{s.captions}</p>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    {draft.text.captions.map((c, i) => (
                      <input key={i} value={c} maxLength={60} aria-label={`${s.captions} ${i + 1}`} onChange={(e) => patchDraft({ captions: draft.text.captions.map((x, j) => (j === i ? e.target.value : x)) })} className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm text-foreground" />
                    ))}
                  </div>
                </div>
                <label className="text-xs text-foreground-muted sm:col-span-2">{s.tweetField}
                  <textarea value={draft.text.tweet} maxLength={400} rows={5} onChange={(e) => patchDraft({ tweet: e.target.value })} className="mt-1 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground" />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void saveDraft()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saving ? s.saving : s.save}</button>
                <button type="button" onClick={() => void resetDraft()} disabled={saving || !texts[film.id]} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-sm font-semibold text-foreground disabled:opacity-50"><Undo2 className="h-4 w-4" /> {s.restore}</button>
                <button type="button" onClick={() => setDraft(null)} disabled={saving} className="rounded-lg px-3 py-1.5 text-sm text-foreground-muted">{s.close}</button>
              </div>
            </section>
          )}
        </section>
      </div>
      {playbookPanel}
    </div>
  );
}
