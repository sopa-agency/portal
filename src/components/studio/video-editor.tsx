"use client";

// Lightweight video editor under the Studio tool — zero new dependencies.
// Preview: <video> elements composited onto a canvas (cover-fit) with image
// overlays (Studio artwork). Audio: WebAudio graph (per-item gain). Export:
// canvas.captureStream + mixed audio → MediaRecorder (MP4 where supported,
// WebM fallback) in real time — light by design, no ffmpeg anywhere.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { listSkatehiveVideos, type SkatehiveVideo } from "@/app/actions/skatehive-media";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type BinItem = {
  id: string;
  kind: "video" | "audio" | "image";
  name: string;
  /** Object URL or same-origin proxy URL — always canvas-safe. */
  url: string;
  duration: number; // seconds (0 for images)
  credit?: string; // e.g. "@author · 12 votes" for skatehive imports
};

type Clip = { id: string; binId: string; in: number; out: number; volume: number };
type Overlay = { id: string; binId: string; start: number; end: number; x: number; y: number; w: number; opacity: number };
type AudioItem = { id: string; binId: string; offset: number; volume: number };

type Selection =
  | { type: "clip"; id: string }
  | { type: "overlay"; id: string }
  | { type: "audio"; id: string }
  | null;

const ASPECTS = {
  "4:5": { w: 1080, h: 1350 },
  "1:1": { w: 1080, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "16:9": { w: 1920, h: 1080 },
} as const;
type AspectKey = keyof typeof ASPECTS;

const PPS = 48; // timeline px per second
const MIN_CLIP = 0.2;

let idSeq = 0;
const nextId = () => `ve-${++idSeq}-${Date.now().toString(36)}`;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

/** Route remote (IPFS) URLs through the same-origin proxy so canvas never taints. */
const safeUrl = (url: string) =>
  url.startsWith("blob:") || url.startsWith("/")
    ? url
    : `/api/studio/video-proxy?url=${encodeURIComponent(url)}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VideoEditor({
  onUseInPost,
}: {
  onUseInPost?: (files: File[], caption: string) => Promise<void>;
}) {
  const [bin, setBin] = useState<BinItem[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [aspect, setAspect] = useState<AspectKey>("4:5");
  const [selection, setSelection] = useState<Selection>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [binTab, setBinTab] = useState<"uploads" | "skatehive" | "art">("uploads");
  const [shVideos, setShVideos] = useState<SkatehiveVideo[] | null>(null);
  const [shError, setShError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | { progress: number; phase: string }>(null);
  const [exportResult, setExportResult] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Media elements + audio graph live outside React.
  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const imageEls = useRef(new Map<string, HTMLImageElement>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodes = useRef(new Map<string, GainNode>());
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clockRef = useRef({ playing: false, t0: 0, base: 0 });
  const stateRef = useRef({ clips, overlays, audios, bin, aspect });
  stateRef.current = { clips, overlays, audios, bin, aspect };

  const totalDuration = useMemo(
    () => clips.reduce((s, c) => s + (c.out - c.in), 0),
    [clips],
  );

  // --- media element management ------------------------------------------

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext;
      audioCtxRef.current = new Ctx();
      mixDestRef.current = audioCtxRef.current.createMediaStreamDestination();
    }
    void audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  const wireAudioGraph = useCallback(
    (el: HTMLMediaElement, key: string) => {
      const ctx = ensureAudioCtx();
      if (gainNodes.current.has(key)) return;
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      src.connect(gain);
      gain.connect(ctx.destination);
      if (mixDestRef.current) gain.connect(mixDestRef.current);
      gainNodes.current.set(key, gain);
    },
    [ensureAudioCtx],
  );

  const getVideoEl = useCallback(
    (item: BinItem): HTMLVideoElement => {
      let el = videoEls.current.get(item.id);
      if (!el) {
        el = document.createElement("video");
        el.crossOrigin = "anonymous";
        el.preload = "auto";
        el.playsInline = true;
        el.src = item.url;
        videoEls.current.set(item.id, el);
      }
      return el;
    },
    [],
  );

  const getAudioEl = useCallback((item: BinItem): HTMLAudioElement => {
    let el = audioEls.current.get(item.id);
    if (!el) {
      el = document.createElement("audio");
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.src = item.url;
      audioEls.current.set(item.id, el);
    }
    return el;
  }, []);

  const getImageEl = useCallback((item: BinItem): HTMLImageElement => {
    let el = imageEls.current.get(item.id);
    if (!el) {
      el = new Image();
      el.crossOrigin = "anonymous";
      el.src = item.url;
      imageEls.current.set(item.id, el);
    }
    return el;
  }, []);

  // --- composition lookups -------------------------------------------------

  /** Active clip + local media time at composition time t. */
  const clipAt = useCallback((t: number) => {
    let acc = 0;
    for (const clip of stateRef.current.clips) {
      const len = clip.out - clip.in;
      if (t < acc + len || clip === stateRef.current.clips[stateRef.current.clips.length - 1]) {
        return { clip, local: Math.min(clip.in + (t - acc), clip.out), index: stateRef.current.clips.indexOf(clip) };
      }
      acc += len;
    }
    return null;
  }, []);

  // --- render loop ----------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = ASPECTS[stateRef.current.aspect];
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const t = clockRef.current.playing
      ? clockRef.current.base + (performance.now() - clockRef.current.t0) / 1000
      : clockRef.current.base;

    const active = clipAt(t);
    if (active) {
      const item = stateRef.current.bin.find((b) => b.id === active.clip.binId);
      if (item) {
        const el = getVideoEl(item);
        if (el.readyState >= 2) {
          // cover-fit
          const vr = el.videoWidth / el.videoHeight || 1;
          const cr = w / h;
          let dw = w, dh = h, dx = 0, dy = 0;
          if (vr > cr) { dh = h; dw = h * vr; dx = (w - dw) / 2; }
          else { dw = w; dh = w / vr; dy = (h - dh) / 2; }
          ctx.drawImage(el, dx, dy, dw, dh);
        }
      }
    }

    for (const ov of stateRef.current.overlays) {
      if (t < ov.start || t > ov.end) continue;
      const item = stateRef.current.bin.find((b) => b.id === ov.binId);
      if (!item) continue;
      const img = getImageEl(item);
      if (!img.complete || !img.naturalWidth) continue;
      const ow = w * ov.w;
      const oh = ow * (img.naturalHeight / img.naturalWidth);
      ctx.globalAlpha = ov.opacity;
      ctx.drawImage(img, w * ov.x - ow / 2, h * ov.y - oh / 2, ow, oh);
      ctx.globalAlpha = 1;
    }
  }, [clipAt, getVideoEl, getImageEl]);

  /** Keep media elements in sync with the clock (seek/play/pause/volume). */
  const syncMedia = useCallback(
    (t: number, isPlaying: boolean) => {
      const { clips: cs, audios: as, bin: bs } = stateRef.current;
      const active = clipAt(t);
      for (const clip of cs) {
        const item = bs.find((b) => b.id === clip.binId);
        if (!item) continue;
        const el = getVideoEl(item);
        const gain = gainNodes.current.get(`clip:${item.id}`);
        if (gain) gain.gain.value = clip.volume;
        if (active && clip.id === active.clip.id) {
          if (Math.abs(el.currentTime - active.local) > 0.25) el.currentTime = active.local;
          if (isPlaying && el.paused) void el.play().catch(() => {});
          if (!isPlaying && !el.paused) el.pause();
        } else if (!el.paused) {
          el.pause();
        }
      }
      for (const a of as) {
        const item = bs.find((b) => b.id === a.binId);
        if (!item) continue;
        const el = getAudioEl(item);
        const gain = gainNodes.current.get(`audio:${item.id}`);
        if (gain) gain.gain.value = a.volume;
        const local = t - a.offset;
        const inWindow = local >= 0 && local < item.duration;
        if (inWindow) {
          if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
          if (isPlaying && el.paused) void el.play().catch(() => {});
          if (!isPlaying && !el.paused) el.pause();
        } else if (!el.paused) {
          el.pause();
        }
      }
    },
    [clipAt, getVideoEl, getAudioEl],
  );

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = clockRef.current;
      const t = c.playing ? c.base + (performance.now() - c.t0) / 1000 : c.base;
      if (c.playing) {
        setTime(t);
        syncMedia(t, true);
        if (t >= (stateRef.current.clips.reduce((s, x) => s + (x.out - x.in), 0) || 0)) {
          c.playing = false;
          c.base = 0;
          setPlaying(false);
          syncMedia(0, false);
          setTime(0);
        }
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, syncMedia]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, totalDuration));
      clockRef.current.base = clamped;
      clockRef.current.t0 = performance.now();
      setTime(clamped);
      syncMedia(clamped, clockRef.current.playing);
    },
    [totalDuration, syncMedia],
  );

  const togglePlay = useCallback(() => {
    ensureAudioCtx();
    const c = clockRef.current;
    if (c.playing) {
      c.base = c.base + (performance.now() - c.t0) / 1000;
      c.playing = false;
      setPlaying(false);
      syncMedia(c.base, false);
    } else {
      if (stateRef.current.clips.length === 0) return;
      if (c.base >= totalDuration) c.base = 0;
      c.t0 = performance.now();
      c.playing = true;
      setPlaying(true);
      syncMedia(c.base, true);
    }
  }, [ensureAudioCtx, syncMedia, totalDuration]);

  // --- bin ops ---------------------------------------------------------------

  const probeDuration = (url: string, kind: "video" | "audio"): Promise<number> =>
    new Promise((resolve) => {
      const el = document.createElement(kind);
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => resolve(0);
      el.src = url;
    });

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const kind = file.type.startsWith("audio")
        ? "audio"
        : file.type.startsWith("image")
          ? "image"
          : "video";
      const duration = kind === "image" ? 0 : await probeDuration(url, kind);
      setBin((prev) => [...prev, { id: nextId(), kind, name: file.name, url, duration }]);
    }
  };

  const addSkatehive = async (v: SkatehiveVideo) => {
    const url = safeUrl(v.url);
    const duration = await probeDuration(url, "video");
    setBin((prev) => [
      ...prev,
      {
        id: nextId(),
        kind: "video",
        name: v.title,
        url,
        duration: duration || 10,
        credit: `@${v.author} · ${v.votes} votes · ${v.source}`,
      },
    ]);
  };

  // Studio artwork → rendered PNG overlay
  const [artBusy, setArtBusy] = useState<number | null>(null);
  const studioCards = useMemo(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("reelflip-studio:doc:v1");
      if (!raw) return [];
      const doc = JSON.parse(raw) as { cards?: { tipo?: string }[] };
      return (doc.cards ?? []).map((c, i) => ({ index: i, tipo: c.tipo ?? "card", card: c }));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binTab]);

  const addArtCard = async (entry: { index: number; tipo: string; card: unknown }) => {
    setArtBusy(entry.index);
    try {
      const res = await fetch("/api/studio/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card: entry.card }),
      });
      if (!res.ok) throw new Error(`render ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setBin((prev) => [
        ...prev,
        { id: nextId(), kind: "image", name: `Studio art ${entry.index + 1} (${entry.tipo})`, url, duration: 0 },
      ]);
      setBinTab("uploads");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setArtBusy(null);
    }
  };

  // --- timeline ops ----------------------------------------------------------

  const addToTimeline = (item: BinItem) => {
    ensureAudioCtx();
    if (item.kind === "video") {
      wireAudioGraph(getVideoEl(item), `clip:${item.id}`);
      setClips((prev) => [
        ...prev,
        { id: nextId(), binId: item.id, in: 0, out: Math.max(item.duration, MIN_CLIP), volume: 1 },
      ]);
    } else if (item.kind === "audio") {
      wireAudioGraph(getAudioEl(item), `audio:${item.id}`);
      setAudios((prev) => [...prev, { id: nextId(), binId: item.id, offset: 0, volume: 1 }]);
    } else {
      setOverlays((prev) => [
        ...prev,
        {
          id: nextId(),
          binId: item.id,
          start: 0,
          end: Math.max(totalDuration, 3),
          x: 0.5,
          y: 0.5,
          w: 0.6,
          opacity: 1,
        },
      ]);
    }
  };

  // clip drag-reorder
  const dragIndex = useRef<number | null>(null);
  const reorderClips = (from: number, to: number) => {
    setClips((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // generic horizontal drag helper (returns pointerdown handler)
  const hDrag = (onDelta: (deltaSeconds: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    let last = 0;
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / PPS;
      onDelta(d - last);
      last = d;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- export ----------------------------------------------------------------

  const startExport = useCallback(async () => {
    if (stateRef.current.clips.length === 0 || exporting) return;
    setError(null);
    setExportResult(null);
    const ctx = ensureAudioCtx();
    await ctx.resume();
    const canvas = canvasRef.current;
    if (!canvas || !mixDestRef.current) return;

    const mimeCandidates = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      "video/mp4",
      'video/webm;codecs="vp9,opus"',
      "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setError("This browser can't record video (no MediaRecorder support).");
      return;
    }

    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...mixDestRef.current.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    setExporting({ progress: 0, phase: "recording" });

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const file = new File([blob], `studio-video-${Date.now()}.${ext}`, { type: blob.type });
      setExporting(null);
      setExportResult(file);
    };

    // play composition from 0 in real time and record it
    seek(0);
    clockRef.current.base = 0;
    clockRef.current.t0 = performance.now();
    clockRef.current.playing = true;
    setPlaying(true);
    syncMedia(0, true);
    recorder.start(500);

    const tick = window.setInterval(() => {
      const c = clockRef.current;
      const t = c.playing ? c.base + (performance.now() - c.t0) / 1000 : c.base;
      setExporting((prev) => (prev ? { ...prev, progress: Math.min(t / total, 1) } : prev));
      if (t >= total || !c.playing) {
        window.clearInterval(tick);
        c.playing = false;
        setPlaying(false);
        syncMedia(0, false);
        recorder.stop();
      }
    }, 250);
  }, [ensureAudioCtx, exporting, seek, syncMedia]);

  const sendToPost = async () => {
    if (!exportResult || !onUseInPost || sending) return;
    setSending(true);
    try {
      await onUseInPost([exportResult], "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // skatehive list lazy-load
  useEffect(() => {
    if (binTab !== "skatehive" || shVideos) return;
    listSkatehiveVideos().then((r) => {
      if (r.ok) setShVideos(r.videos);
      else setShError(r.error);
    });
  }, [binTab, shVideos]);

  // selected entities
  const selClip = selection?.type === "clip" ? clips.find((c) => c.id === selection.id) : null;
  const selOverlay = selection?.type === "overlay" ? overlays.find((o) => o.id === selection.id) : null;
  const selAudio = selection?.type === "audio" ? audios.find((a) => a.id === selection.id) : null;

  const timelineWidth = Math.max(totalDuration, 10) * PPS + 80;

  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row">
      {/* ── Media bin ─────────────────────────────────────────────────────── */}
      <div className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-surface lg:w-72">
        <div className="flex border-b border-border text-xs">
          {(
            [
              ["uploads", "Media", Upload],
              ["skatehive", "SkateHive", Film],
              ["art", "Art", ImageIcon],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setBinTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 font-medium transition-colors ${
                binTab === key ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
          {binTab === "uploads" && (
            <>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground">
                <Upload className="h-3.5 w-3.5" />
                Upload video / audio / image
                <input
                  type="file"
                  multiple
                  accept="video/*,audio/*,image/*"
                  className="hidden"
                  onChange={(e) => e.target.files && void addFiles(e.target.files)}
                />
              </label>
              {bin.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">
                  Bin is empty — upload, or pull from the SkateHive / Art tabs.
                </p>
              )}
              {bin.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2"
                >
                  {item.kind === "video" ? (
                    <Film className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : item.kind === "audio" ? (
                    <Music className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground">{item.name}</p>
                    <p className="text-[10px] text-foreground-faint">
                      {item.kind === "image" ? "overlay" : fmt(item.duration)}
                      {item.credit ? ` · ${item.credit}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addToTimeline(item)}
                    title="Add to timeline"
                    className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}

          {binTab === "skatehive" && (
            <>
              {!shVideos && !shError && (
                <p className="flex items-center gap-2 px-1 py-2 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading SkateHive IPFS videos…
                </p>
              )}
              {shError && <p className="px-1 text-xs text-danger">{shError}</p>}
              {shVideos?.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">No IPFS videos found right now.</p>
              )}
              {shVideos?.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2">
                  <Film className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground">{v.title}</p>
                    <p className="truncate text-[10px] text-foreground-faint">
                      @{v.author} · ▲{v.votes} · ${v.payout} ·{" "}
                      <span className={v.source === "snap" ? "text-accent" : "text-warning"}>{v.source}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void addSkatehive(v)}
                    title="Add to bin"
                    className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}

          {binTab === "art" && (
            <>
              <p className="px-1 text-[11px] text-foreground-subtle">
                Cards from your Studio design doc, rendered as PNG overlays.
              </p>
              {studioCards.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">
                  No Studio cards yet — create some in the Design tab first.
                </p>
              )}
              {studioCards.map((c) => (
                <div key={c.index} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2">
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                  <p className="min-w-0 flex-1 truncate text-xs text-foreground">
                    Card {c.index + 1} <span className="text-foreground-faint">({c.tipo})</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void addArtCard(c)}
                    disabled={artBusy !== null}
                    title="Render + add as overlay"
                    className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20 disabled:opacity-50"
                  >
                    {artBusy === c.index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Preview + timeline ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {/* preview */}
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-black/90 p-3">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full rounded-lg"
            style={{ aspectRatio: `${ASPECTS[aspect].w} / ${ASPECTS[aspect].h}` }}
            onPointerDown={(e) => {
              // drag selected overlay directly on the canvas
              if (!selOverlay) return;
              const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
              const move = (ev: PointerEvent) => {
                const x = (ev.clientX - rect.left) / rect.width;
                const y = (ev.clientY - rect.top) / rect.height;
                setOverlays((prev) =>
                  prev.map((o) =>
                    o.id === selOverlay.id
                      ? { ...o, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
                      : o,
                  ),
                );
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        </div>

        {/* transport */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={clips.length === 0 || !!exporting}
            className="rounded-lg border border-accent-border bg-accent-bg p-2 text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <span className="font-mono text-xs tabular-nums text-foreground-muted">
            {fmt(time)} / {fmt(totalDuration)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(totalDuration, 0.01)}
            step={0.05}
            value={Math.min(time, totalDuration)}
            onChange={(e) => seek(Number(e.target.value))}
            className="min-w-[120px] flex-1 accent-[var(--accent)]"
          />
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value as AspectKey)}
            className="rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground"
          >
            {Object.keys(ASPECTS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {!exporting && !exportResult && (
            <button
              type="button"
              onClick={() => void startExport()}
              disabled={clips.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          )}
          {exporting && (
            <span className="inline-flex items-center gap-2 text-xs text-foreground-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Recording {Math.round(exporting.progress * 100)}% (real-time)
            </span>
          )}
          {exportResult && (
            <span className="inline-flex items-center gap-2">
              <a
                href={URL.createObjectURL(exportResult)}
                download={exportResult.name}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
              {onUseInPost && (
                <button
                  type="button"
                  onClick={() => void sendToPost()}
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Usar no post →
                </button>
              )}
              <button
                type="button"
                onClick={() => setExportResult(null)}
                className="text-xs text-foreground-faint hover:text-foreground"
              >
                discard
              </button>
            </span>
          )}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>

        {/* timeline */}
        <div className="shrink-0 overflow-x-auto rounded-xl border border-border bg-surface">
          <div style={{ width: timelineWidth }} className="relative select-none p-2">
            {/* ruler */}
            <div
              className="relative mb-1 h-5 cursor-pointer border-b border-border"
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - rect.left) / PPS);
              }}
            >
              {Array.from({ length: Math.ceil(Math.max(totalDuration, 10)) + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute top-0 text-[9px] tabular-nums text-foreground-faint"
                  style={{ left: i * PPS }}
                >
                  {i}s
                </span>
              ))}
              {/* playhead */}
              <div
                className="pointer-events-none absolute top-0 z-10 h-[140px] w-px bg-accent"
                style={{ left: time * PPS }}
              />
            </div>

            {/* video track */}
            <div className="mb-1.5 flex h-12 items-stretch gap-px rounded-md bg-surface-elevated/60 p-0.5">
              {clips.length === 0 && (
                <p className="self-center px-2 text-[10px] italic text-foreground-faint">
                  Video track — add clips from the bin
                </p>
              )}
              {clips.map((clip, i) => {
                const item = bin.find((b) => b.id === clip.binId);
                const len = clip.out - clip.in;
                const isSel = selection?.type === "clip" && selection.id === clip.id;
                return (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => (dragIndex.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex.current != null && dragIndex.current !== i)
                        reorderClips(dragIndex.current, i);
                      dragIndex.current = null;
                    }}
                    onClick={() => setSelection({ type: "clip", id: clip.id })}
                    style={{ width: len * PPS }}
                    className={`group relative flex shrink-0 cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] ${
                      isSel
                        ? "border-accent bg-accent-bg text-accent"
                        : "border-border bg-surface text-foreground-muted hover:border-border-strong"
                    }`}
                    title={`${item?.name ?? "clip"} · ${fmt(len)}`}
                  >
                    <span className="truncate">{item?.name ?? "clip"}</span>
                    {/* trim handles */}
                    <span
                      onPointerDown={hDrag((d) =>
                        setClips((prev) =>
                          prev.map((c) =>
                            c.id === clip.id
                              ? { ...c, in: Math.max(0, Math.min(c.in + d, c.out - MIN_CLIP)) }
                              : c,
                          ),
                        ),
                      )}
                      className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-accent/0 group-hover:bg-accent/60"
                    />
                    <span
                      onPointerDown={hDrag((d) =>
                        setClips((prev) =>
                          prev.map((c) =>
                            c.id === clip.id
                              ? {
                                  ...c,
                                  out: Math.max(
                                    c.in + MIN_CLIP,
                                    Math.min(c.out + d, item?.duration || c.out + d),
                                  ),
                                }
                              : c,
                          ),
                        ),
                      )}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-accent/0 group-hover:bg-accent/60"
                    />
                  </div>
                );
              })}
            </div>

            {/* overlay track */}
            <div className="relative mb-1.5 h-9 rounded-md bg-surface-elevated/60">
              {overlays.length === 0 && (
                <p className="px-2 py-2 text-[10px] italic text-foreground-faint">
                  Art track — overlays from the Art tab
                </p>
              )}
              {overlays.map((ov) => {
                const item = bin.find((b) => b.id === ov.binId);
                const isSel = selection?.type === "overlay" && selection.id === ov.id;
                return (
                  <div
                    key={ov.id}
                    onClick={() => setSelection({ type: "overlay", id: ov.id })}
                    onPointerDown={hDrag((d) =>
                      setOverlays((prev) =>
                        prev.map((o) =>
                          o.id === ov.id
                            ? {
                                ...o,
                                start: Math.max(0, o.start + d),
                                end: Math.max(MIN_CLIP, o.end + d),
                              }
                            : o,
                        ),
                      ),
                    )}
                    style={{ left: ov.start * PPS, width: Math.max((ov.end - ov.start) * PPS, 24) }}
                    className={`absolute top-1 flex h-7 cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] ${
                      isSel
                        ? "border-success bg-success/15 text-success"
                        : "border-border bg-surface text-foreground-muted hover:border-border-strong"
                    }`}
                  >
                    <span className="truncate">{item?.name ?? "art"}</span>
                    <span
                      onPointerDown={hDrag((d) =>
                        setOverlays((prev) =>
                          prev.map((o) =>
                            o.id === ov.id
                              ? { ...o, end: Math.max(o.start + MIN_CLIP, o.end + d) }
                              : o,
                          ),
                        ),
                      )}
                      className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-success/40"
                    />
                  </div>
                );
              })}
            </div>

            {/* audio track */}
            <div className="relative h-9 rounded-md bg-surface-elevated/60">
              {audios.length === 0 && (
                <p className="px-2 py-2 text-[10px] italic text-foreground-faint">
                  Audio track — songs/voiceovers from the bin
                </p>
              )}
              {audios.map((a) => {
                const item = bin.find((b) => b.id === a.binId);
                const isSel = selection?.type === "audio" && selection.id === a.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelection({ type: "audio", id: a.id })}
                    onPointerDown={hDrag((d) =>
                      setAudios((prev) =>
                        prev.map((x) => (x.id === a.id ? { ...x, offset: Math.max(0, x.offset + d) } : x)),
                      ),
                    )}
                    style={{ left: a.offset * PPS, width: Math.max((item?.duration ?? 3) * PPS, 24) }}
                    className={`absolute top-1 flex h-7 cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] ${
                      isSel
                        ? "border-warning bg-warning/15 text-warning"
                        : "border-border bg-surface text-foreground-muted hover:border-border-strong"
                    }`}
                  >
                    <Music className="mr-1 h-3 w-3 shrink-0" />
                    <span className="truncate">{item?.name ?? "audio"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* properties for selection */}
        {(selClip || selOverlay || selAudio) && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-3 py-2 text-xs">
            {selClip && (
              <>
                <span className="font-medium text-foreground">Clip</span>
                <label className="flex items-center gap-2 text-foreground-muted">
                  volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selClip.volume}
                    onChange={(e) =>
                      setClips((prev) =>
                        prev.map((c) => (c.id === selClip.id ? { ...c, volume: Number(e.target.value) } : c)),
                      )
                    }
                  />
                </label>
                <span className="tabular-nums text-foreground-faint">
                  trim {fmt(selClip.in)} → {fmt(selClip.out)}
                </span>
              </>
            )}
            {selOverlay && (
              <>
                <span className="font-medium text-foreground">Art overlay</span>
                <label className="flex items-center gap-2 text-foreground-muted">
                  size
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.02}
                    value={selOverlay.w}
                    onChange={(e) =>
                      setOverlays((prev) =>
                        prev.map((o) => (o.id === selOverlay.id ? { ...o, w: Number(e.target.value) } : o)),
                      )
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-foreground-muted">
                  opacity
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={selOverlay.opacity}
                    onChange={(e) =>
                      setOverlays((prev) =>
                        prev.map((o) => (o.id === selOverlay.id ? { ...o, opacity: Number(e.target.value) } : o)),
                      )
                    }
                  />
                </label>
                <span className="text-foreground-faint">drag on the preview to position</span>
              </>
            )}
            {selAudio && (
              <>
                <span className="font-medium text-foreground">Audio</span>
                <label className="flex items-center gap-2 text-foreground-muted">
                  volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selAudio.volume}
                    onChange={(e) =>
                      setAudios((prev) =>
                        prev.map((a) => (a.id === selAudio.id ? { ...a, volume: Number(e.target.value) } : a)),
                      )
                    }
                  />
                </label>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (selClip) setClips((prev) => prev.filter((c) => c.id !== selClip.id));
                if (selOverlay) setOverlays((prev) => prev.filter((o) => o.id !== selOverlay.id));
                if (selAudio) setAudios((prev) => prev.filter((a) => a.id !== selAudio.id));
                setSelection(null);
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger hover:bg-danger/20"
            >
              <Trash2 className="h-3 w-3" />
              remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
