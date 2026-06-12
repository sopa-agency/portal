"use client";

// Studio video editor, pass 2 — CapCut-flavored, still zero new dependencies.
// Preview: <video> elements composited onto a canvas with image overlays that
// support direct manipulation (drag to move, corner handle to scale). Timeline:
// zoomable, snappy, with clip filmstrips and audio waveforms; bin items drag
// onto tracks, files drop anywhere. Export: canvas.captureStream + WebAudio mix
// through MediaRecorder (MP4 where supported, WebM fallback) — no ffmpeg.

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
  Scissors,
  Send,
  Square,
  Trash2,
  Type,
  Upload,
  Folder,
  HardDrive,
  ZoomIn,
  ZoomOut,
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
  credit?: string;
  /** Filmstrip frames (videos). */
  thumbs?: string[];
  /** Waveform image (audio). */
  waveUrl?: string;
};

type Clip = { id: string; binId: string; in: number; out: number; volume: number };
type Overlay = {
  id: string;
  kind: "image" | "text" | "shape";
  binId?: string;
  /** Shape style (kind shape). */
  shape?: "rect" | "pill";
  /** Shape height as a fraction of its width. */
  hRatio?: number;
  /** Text content (kind text) — supports \n for multi-line. */
  text?: string;
  color: string;
  bg: boolean;
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  opacity: number;
  rotation: number; // radians
};

const TEXT_COLORS = ["#ffffff", "#0a0a0a", "#a3e635", "#facc15", "#22d3ee", "#ef4444"];
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

const MIN_CLIP = 0.2;
const SNAP_PX = 8;

let idSeq = 0;
const nextId = () => `ve-${++idSeq}-${Date.now().toString(36)}`;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

const safeUrl = (url: string) =>
  url.startsWith("blob:") || url.startsWith("/")
    ? url
    : `/api/studio/video-proxy?url=${encodeURIComponent(url)}`;

// --- thumbnail + waveform generation ----------------------------------------

async function makeFilmstrip(url: string, duration: number): Promise<string[]> {
  try {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res) => {
      v.onloadeddata = () => res();
      v.onerror = () => res();
      setTimeout(res, 6000);
    });
    if (!v.videoWidth) return [];
    const n = Math.min(8, Math.max(3, Math.round(duration / 2)));
    const c = document.createElement("canvas");
    c.height = 56;
    c.width = Math.max(32, Math.round(56 * (v.videoWidth / v.videoHeight)));
    const ctx = c.getContext("2d");
    if (!ctx) return [];
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min((duration * (i + 0.5)) / n, Math.max(duration - 0.1, 0));
      await new Promise<void>((res) => {
        v.onseeked = () => res();
        setTimeout(res, 900);
      });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      out.push(c.toDataURL("image/jpeg", 0.55));
    }
    return out;
  } catch {
    return [];
  }
}

async function makeWaveform(url: string): Promise<string | undefined> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const Ctx = window.OfflineAudioContext;
    const probe = new Ctx(1, 1, 44100);
    const audio = await probe.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const bars = 240;
    const step = Math.floor(data.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      for (let j = i * step; j < (i + 1) * step && j < data.length; j += 32) {
        const a = Math.abs(data[j]);
        if (a > max) max = a;
      }
      peaks.push(max);
    }
    const c = document.createElement("canvas");
    c.width = bars * 2;
    c.height = 36;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "rgba(245, 158, 11, 0.85)"; // amber, reads on both themes
    for (let i = 0; i < bars; i++) {
      const h = Math.max(2, peaks[i] * 32);
      ctx.fillRect(i * 2, (36 - h) / 2, 1.4, h);
    }
    return c.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

// --- lazy SkateHive thumbnails (module-level cache + 2-worker queue) ---------

const thumbCache = new Map<string, string>();
const thumbQueue: { url: string; resolve: (v: string | null) => void }[] = [];
let thumbWorkers = 0;

function requestThumb(url: string): Promise<string | null> {
  if (thumbCache.has(url)) return Promise.resolve(thumbCache.get(url)!);
  return new Promise((resolve) => {
    thumbQueue.push({ url, resolve });
    pumpThumbs();
  });
}

function pumpThumbs() {
  while (thumbWorkers < 2 && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    thumbWorkers++;
    void (async () => {
      try {
        if (thumbCache.has(job.url)) {
          job.resolve(thumbCache.get(job.url)!);
          return;
        }
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.preload = "auto";
        v.src = job.url;
        await new Promise<void>((res) => {
          v.onloadeddata = () => res();
          v.onerror = () => res();
          setTimeout(res, 8000);
        });
        if (!v.videoWidth) {
          job.resolve(null);
          return;
        }
        v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
        await new Promise<void>((res) => {
          v.onseeked = () => res();
          setTimeout(res, 1200);
        });
        const c = document.createElement("canvas");
        c.width = 112;
        c.height = 64;
        const ctx = c.getContext("2d");
        if (!ctx) {
          job.resolve(null);
          return;
        }
        const vr = v.videoWidth / v.videoHeight;
        const cr = c.width / c.height;
        let dw = c.width, dh = c.height, dx = 0, dy = 0;
        if (vr > cr) { dh = c.height; dw = c.height * vr; dx = (c.width - dw) / 2; }
        else { dw = c.width; dh = c.width / vr; dy = (c.height - dh) / 2; }
        ctx.drawImage(v, dx, dy, dw, dh);
        const dataUrl = c.toDataURL("image/jpeg", 0.6);
        thumbCache.set(job.url, dataUrl);
        v.src = "";
        job.resolve(dataUrl);
      } catch {
        job.resolve(null);
      } finally {
        thumbWorkers--;
        pumpThumbs();
      }
    })();
  }
}

/** Thumbnail that only generates once scrolled into view. */
function ShThumb({ url }: { url: string }) {
  const [thumb, setThumb] = useState<string | null>(thumbCache.get(url) ?? null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (thumb || failed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      io.disconnect();
      void requestThumb(safeUrl(url)).then((t) => (t ? setThumb(t) : setFailed(true)));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [url, thumb, failed]);

  return (
    <div ref={ref} className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-black/40">
      {thumb ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={thumb} alt="" className="h-full w-full object-cover" />
      ) : failed ? (
        <Film className="h-3.5 w-3.5 text-foreground-faint" />
      ) : (
        <Loader2 className="h-3 w-3 animate-spin text-foreground-faint" />
      )}
    </div>
  );
}

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
  const [pps, setPps] = useState(48); // timeline zoom (px per second)
  const [binTab, setBinTab] = useState<"uploads" | "skatehive" | "art" | "drive">("uploads");
  const [driveFiles, setDriveFiles] = useState<
    { id: string; name: string; mimeType: string; size?: string }[] | null
  >(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveStack, setDriveStack] = useState<string[]>([]); // folder drill-in
  const [shVideos, setShVideos] = useState<SkatehiveVideo[] | null>(null);
  const [shError, setShError] = useState<string | null>(null);
  const [shBusy, setShBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | { progress: number }>(null);
  const [exportResult, setExportResult] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropHot, setDropHot] = useState(false);

  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const imageEls = useRef(new Map<string, HTMLImageElement>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodes = useRef(new Map<string, GainNode>());
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clockRef = useRef({ playing: false, t0: 0, base: 0 });
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const stateRef = useRef({ clips, overlays, audios, bin, aspect, selection });
  stateRef.current = { clips, overlays, audios, bin, aspect, selection };

  const totalDuration = useMemo(() => clips.reduce((s, c) => s + (c.out - c.in), 0), [clips]);

  // --- audio graph -----------------------------------------------------------

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new window.AudioContext();
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

  const getVideoEl = useCallback((item: BinItem): HTMLVideoElement => {
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
  }, []);

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

  // --- composition helpers ----------------------------------------------------

  const clipAt = useCallback((t: number) => {
    const cs = stateRef.current.clips;
    let acc = 0;
    for (let i = 0; i < cs.length; i++) {
      const len = cs[i].out - cs[i].in;
      if (t < acc + len || i === cs.length - 1) {
        return { clip: cs[i], local: Math.min(cs[i].in + (t - acc), cs[i].out), index: i, startAt: acc };
      }
      acc += len;
    }
    return null;
  }, []);

  /** Snap a timeline-seconds value to clip boundaries / 0 / playhead. */
  const snap = useCallback(
    (t: number, extra: number[] = []) => {
      const cs = stateRef.current.clips;
      const pts = [0, ...extra];
      let acc = 0;
      for (const c of cs) {
        acc += c.out - c.in;
        pts.push(acc);
      }
      const threshold = SNAP_PX / ppsRef.current;
      for (const p of pts) if (Math.abs(t - p) < threshold) return p;
      return t;
    },
    [],
  );

  /** Measured text boxes (canvas px), filled by draw() each frame. */
  const textRects = useRef(new Map<string, { ow: number; oh: number }>());

  /** Overlay display rect in canvas pixels at the current aspect. */
  const overlayRect = useCallback(
    (ov: Overlay) => {
      const { w, h } = ASPECTS[stateRef.current.aspect];
      if (ov.kind === "text") {
        const m = textRects.current.get(ov.id) ?? { ow: w * 0.4, oh: w * 0.12 };
        return { cx: w * ov.x, cy: h * ov.y, ow: m.ow, oh: m.oh };
      }
      if (ov.kind === "shape") {
        const ow = w * ov.w;
        const oh = ow * (ov.hRatio ?? 0.4);
        return { cx: w * ov.x, cy: h * ov.y, ow, oh };
      }
      const item = stateRef.current.bin.find((b) => b.id === ov.binId);
      const img = item ? imageEls.current.get(item.id) : null;
      const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      const ow = w * ov.w;
      const oh = ow * ratio;
      return { cx: w * ov.x, cy: h * ov.y, ow, oh };
    },
    [],
  );

  // --- render loop --------------------------------------------------------------

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
          const vr = el.videoWidth / el.videoHeight || 1;
          const cr = w / h;
          let dw = w, dh = h, dx = 0, dy = 0;
          if (vr > cr) { dh = h; dw = h * vr; dx = (w - dw) / 2; }
          else { dw = w; dh = w / vr; dy = (h - dh) / 2; }
          ctx.drawImage(el, dx, dy, dw, dh);
        }
      }
    }

    const sel = stateRef.current.selection;
    for (const ov of stateRef.current.overlays) {
      if (t < ov.start || t > ov.end) continue;
      let drewBox: { ow: number; oh: number } | null = null;

      if (ov.kind === "text") {
        const fontSize = Math.max(12, ov.w * w * 0.1);
        const lines = (ov.text ?? "").split("\n");
        ctx.save();
        ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
        const lineH = fontSize * 1.25;
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width), fontSize);
        const th = lineH * lines.length;
        textRects.current.set(ov.id, { ow: tw + fontSize * 0.8, oh: th + fontSize * 0.5 });
        const { cx, cy } = overlayRect(ov);
        ctx.translate(cx, cy);
        ctx.rotate(ov.rotation);
        ctx.globalAlpha = ov.opacity;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        lines.forEach((line, li) => {
          const ly = -th / 2 + lineH * (li + 0.5);
          if (ov.bg) {
            const lw = ctx.measureText(line).width;
            const pad = fontSize * 0.35;
            ctx.fillStyle = ov.color === "#0a0a0a" ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.72)";
            const rx = -lw / 2 - pad;
            const ry = ly - lineH / 2 + fontSize * 0.06;
            const rw = lw + pad * 2;
            const rh = lineH;
            const r = Math.min(10, rh / 3);
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, r);
            ctx.fill();
          }
          ctx.fillStyle = ov.color;
          ctx.fillText(line, 0, ly);
        });
        ctx.globalAlpha = 1;
        drewBox = textRects.current.get(ov.id) ?? null;
        // keep ctx transformed for selection chrome below
        if (!(sel?.type === "overlay" && sel.id === ov.id)) {
          ctx.restore();
          continue;
        }
        const { ow, oh } = drewBox!;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(2, w / 360);
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(-ow / 2, -oh / 2, ow, oh);
        ctx.setLineDash([]);
        const r2 = Math.max(10, w / 72);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ow / 2, oh / 2, r2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = `${r2 * 1.2}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("↘", ow / 2, oh / 2 + 1);
        ctx.restore();
        continue;
      }

      if (ov.kind === "shape") {
        const { cx, cy, ow, oh } = overlayRect(ov);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ov.rotation);
        ctx.globalAlpha = ov.opacity;
        ctx.fillStyle = ov.color;
        const radius = ov.shape === "pill" ? oh / 2 : Math.min(14, oh / 5);
        ctx.beginPath();
        ctx.roundRect(-ow / 2, -oh / 2, ow, oh, radius);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (sel?.type === "overlay" && sel.id === ov.id) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = Math.max(2, w / 360);
          ctx.setLineDash([10, 6]);
          ctx.strokeRect(-ow / 2, -oh / 2, ow, oh);
          ctx.setLineDash([]);
          const r3 = Math.max(10, w / 72);
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(ow / 2, oh / 2, r3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.font = `${r3 * 1.2}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("↘", ow / 2, oh / 2 + 1);
        }
        ctx.restore();
        continue;
      }

      const item = stateRef.current.bin.find((b) => b.id === ov.binId);
      if (!item) continue;
      const img = getImageEl(item);
      if (!img.complete || !img.naturalWidth) continue;
      const { cx, cy, ow, oh } = overlayRect(ov);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ov.rotation);
      ctx.globalAlpha = ov.opacity;
      ctx.drawImage(img, -ow / 2, -oh / 2, ow, oh);
      ctx.globalAlpha = 1;
      // selection chrome — CapCut-style box + scale handle
      if (sel?.type === "overlay" && sel.id === ov.id) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(2, w / 360);
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(-ow / 2, -oh / 2, ow, oh);
        ctx.setLineDash([]);
        const r = Math.max(10, w / 72);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ow / 2, oh / 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = `${r * 1.2}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("↘", ow / 2, oh / 2 + 1);
      }
      ctx.restore();
    }
  }, [clipAt, getVideoEl, getImageEl, overlayRect]);

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
        } else if (!el.paused) el.pause();
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
        } else if (!el.paused) el.pause();
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
        const total = stateRef.current.clips.reduce((s, x) => s + (x.out - x.in), 0);
        if (t >= total) {
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
      const total = stateRef.current.clips.reduce((s, x) => s + (x.out - x.in), 0);
      const clamped = Math.max(0, Math.min(t, total));
      clockRef.current.base = clamped;
      clockRef.current.t0 = performance.now();
      setTime(clamped);
      syncMedia(clamped, clockRef.current.playing);
    },
    [syncMedia],
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
      const total = stateRef.current.clips.reduce((s, x) => s + (x.out - x.in), 0);
      if (c.base >= total) c.base = 0;
      c.t0 = performance.now();
      c.playing = true;
      setPlaying(true);
      syncMedia(c.base, true);
    }
  }, [ensureAudioCtx, syncMedia]);

  // --- bin ops -------------------------------------------------------------------

  const probeDuration = (url: string, kind: "video" | "audio"): Promise<number> =>
    new Promise((resolve) => {
      const el = document.createElement(kind);
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => resolve(0);
      el.src = url;
    });

  const enrichItem = useCallback((id: string, url: string, kind: BinItem["kind"], duration: number) => {
    if (kind === "video") {
      void makeFilmstrip(url, duration).then((thumbs) => {
        if (thumbs.length)
          setBin((prev) => prev.map((b) => (b.id === id ? { ...b, thumbs } : b)));
      });
    } else if (kind === "audio") {
      void makeWaveform(url).then((waveUrl) => {
        if (waveUrl) setBin((prev) => prev.map((b) => (b.id === id ? { ...b, waveUrl } : b)));
      });
    }
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const url = URL.createObjectURL(file);
        const kind: BinItem["kind"] = file.type.startsWith("audio")
          ? "audio"
          : file.type.startsWith("image")
            ? "image"
            : "video";
        const duration = kind === "image" ? 0 : await probeDuration(url, kind);
        const id = nextId();
        setBin((prev) => [...prev, { id, kind, name: file.name, url, duration }]);
        enrichItem(id, url, kind, duration);
      }
    },
    [enrichItem],
  );

  const addSkatehive = async (v: SkatehiveVideo) => {
    setShBusy(v.id);
    const url = safeUrl(v.url);
    const duration = await probeDuration(url, "video");
    const id = nextId();
    setBin((prev) => [
      ...prev,
      {
        id,
        kind: "video",
        name: v.title,
        url,
        duration: duration || 10,
        credit: `@${v.author} · ▲${v.votes}`,
      },
    ]);
    enrichItem(id, url, "video", duration || 10);
    setShBusy(null);
    setBinTab("uploads");
  };

  // --- timeline ops -----------------------------------------------------------------

  const addClip = useCallback(
    (item: BinItem, atIndex?: number) => {
      ensureAudioCtx();
      wireAudioGraph(getVideoEl(item), `clip:${item.id}`);
      setClips((prev) => {
        const clip: Clip = { id: nextId(), binId: item.id, in: 0, out: Math.max(item.duration, MIN_CLIP), volume: 1 };
        const next = [...prev];
        next.splice(atIndex ?? next.length, 0, clip);
        return next;
      });
    },
    [ensureAudioCtx, wireAudioGraph, getVideoEl],
  );

  const addAudio = useCallback(
    (item: BinItem, offset = 0) => {
      ensureAudioCtx();
      wireAudioGraph(getAudioEl(item), `audio:${item.id}`);
      setAudios((prev) => [...prev, { id: nextId(), binId: item.id, offset: Math.max(0, offset), volume: 1 }]);
    },
    [ensureAudioCtx, wireAudioGraph, getAudioEl],
  );

  const addOverlay = useCallback(
    (item: BinItem, start = 0, x = 0.5, y = 0.5) => {
      const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
      const ov: Overlay = {
        id: nextId(),
        kind: "image",
        binId: item.id,
        color: "#ffffff",
        bg: false,
        start: Math.max(0, start),
        end: Math.max(start + 3, Math.min(total || start + 3, start + 6)),
        x,
        y,
        w: 0.55,
        opacity: 1,
        rotation: 0,
      };
      setOverlays((prev) => [...prev, ov]);
      setSelection({ type: "overlay", id: ov.id });
    },
    [],
  );

  /** Studio-style shape layer (box / pill) at the playhead. */
  const addShape = useCallback((shape: "rect" | "pill", color: string) => {
    const start = clockRef.current.base;
    const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
    const ov: Overlay = {
      id: nextId(),
      kind: "shape",
      shape,
      color,
      bg: false,
      hRatio: shape === "pill" ? 0.28 : 0.45,
      start: Math.max(0, start),
      end: Math.max(start + 3, Math.min(total || start + 3, start + 5)),
      x: 0.5,
      y: 0.5,
      w: 0.55,
      opacity: 1,
      rotation: 0,
    };
    setOverlays((prev) => [...prev, ov]);
    setSelection({ type: "overlay", id: ov.id });
  }, []);

  /** CapCut-style text layer at the playhead, centered. */
  const addText = useCallback(() => {
    const start = clockRef.current.base;
    const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
    const ov: Overlay = {
      id: nextId(),
      kind: "text",
      text: "Your text",
      color: "#ffffff",
      bg: true,
      start: Math.max(0, start),
      end: Math.max(start + 3, Math.min(total || start + 3, start + 4)),
      x: 0.5,
      y: 0.78,
      w: 0.7,
      opacity: 1,
      rotation: 0,
    };
    setOverlays((prev) => [...prev, ov]);
    setSelection({ type: "overlay", id: ov.id });
  }, []);

  const addToTimeline = (item: BinItem) => {
    if (item.kind === "video") addClip(item);
    else if (item.kind === "audio") addAudio(item);
    else addOverlay(item, clockRef.current.base);
  };

  /** Split the active clip at the playhead — the CapCut scissors. */
  const splitAtPlayhead = useCallback(() => {
    const t = clockRef.current.base;
    const active = clipAt(t);
    if (!active) return;
    const { clip, local, index } = active;
    if (local - clip.in < MIN_CLIP || clip.out - local < MIN_CLIP) return;
    setClips((prev) => {
      const next = [...prev];
      next.splice(index, 1,
        { ...clip, id: nextId(), out: local },
        { ...clip, id: nextId(), in: local },
      );
      return next;
    });
  }, [clipAt]);

  const removeSelection = useCallback(() => {
    const sel = stateRef.current.selection;
    if (!sel) return;
    if (sel.type === "clip") setClips((prev) => prev.filter((c) => c.id !== sel.id));
    if (sel.type === "overlay") setOverlays((prev) => prev.filter((o) => o.id !== sel.id));
    if (sel.type === "audio") setAudios((prev) => prev.filter((a) => a.id !== sel.id));
    setSelection(null);
  }, []);

  // generic horizontal drag (timeline blocks/handles)
  const hDrag = (onDelta: (deltaSeconds: number) => void, onEnd?: () => void) =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      let last = 0;
      const move = (ev: PointerEvent) => {
        const d = (ev.clientX - startX) / ppsRef.current;
        onDelta(d - last);
        last = d;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        onEnd?.();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  // clip drag-reorder within the track
  const dragClipIndex = useRef<number | null>(null);
  const reorderClips = (from: number, to: number) =>
    setClips((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  // --- canvas direct manipulation (CapCut-style) -------------------------------------

  const canvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { w, h } = ASPECTS[stateRef.current.aspect];
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const py = ((e.clientY - rect.top) / rect.height) * h;
    const t = clockRef.current.base;

    // hit-test overlays topmost-first
    const visible = stateRef.current.overlays.filter((o) => t >= o.start && t <= o.end);
    let hit: Overlay | null = null;
    let mode: "move" | "scale" = "move";
    for (let i = visible.length - 1; i >= 0; i--) {
      const ov = visible[i];
      const { cx, cy, ow, oh } = overlayRect(ov);
      const handleR = Math.max(14, w / 60);
      const hx = cx + ow / 2;
      const hy = cy + oh / 2;
      if (Math.hypot(px - hx, py - hy) < handleR * 1.4) {
        hit = ov;
        mode = "scale";
        break;
      }
      if (px > cx - ow / 2 && px < cx + ow / 2 && py > cy - oh / 2 && py < cy + oh / 2) {
        hit = ov;
        mode = "move";
        break;
      }
    }

    if (!hit) {
      if (stateRef.current.selection?.type === "overlay") setSelection(null);
      return;
    }
    setSelection({ type: "overlay", id: hit.id });
    const id = hit.id;
    const startW = hit.w;
    const { cx, cy } = overlayRect(hit);
    const startDist = Math.max(Math.hypot(px - cx, py - cy), 1);

    const move = (ev: PointerEvent) => {
      const nx = ((ev.clientX - rect.left) / rect.width) * w;
      const ny = ((ev.clientY - rect.top) / rect.height) * h;
      if (mode === "move") {
        setOverlays((prev) =>
          prev.map((o) =>
            o.id === id
              ? { ...o, x: Math.min(1.2, Math.max(-0.2, nx / w)), y: Math.min(1.2, Math.max(-0.2, ny / h)) }
              : o,
          ),
        );
      } else {
        const dist = Math.max(Math.hypot(nx - cx, ny - cy), 1);
        const factor = dist / startDist;
        setOverlays((prev) =>
          prev.map((o) =>
            o.id === id ? { ...o, w: Math.min(2, Math.max(0.08, startW * factor)) } : o,
          ),
        );
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- bin → timeline drag and drop ----------------------------------------------------

  const timelineDropSeconds = (e: React.DragEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return snap(Math.max(0, (e.clientX - rect.left) / ppsRef.current));
  };

  const handleTrackDrop = (track: "video" | "art" | "audio") => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const binId = e.dataTransfer.getData("application/x-bin-id");
    const item = stateRef.current.bin.find((b) => b.id === binId);
    if (!item) return;
    const at = timelineDropSeconds(e, e.currentTarget);
    if (track === "video" && item.kind === "video") {
      // insert by drop position: find index whose cumulative start is nearest
      let acc = 0, idx = stateRef.current.clips.length;
      for (let i = 0; i < stateRef.current.clips.length; i++) {
        const len = stateRef.current.clips[i].out - stateRef.current.clips[i].in;
        if (at < acc + len / 2) { idx = i; break; }
        acc += len;
      }
      addClip(item, idx);
    } else if (track === "audio" && item.kind === "audio") {
      addAudio(item, at);
    } else if (track === "art" && item.kind === "image") {
      addOverlay(item, at);
    }
  };

  // file drop anywhere
  const rootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDropHot(false);
    if (e.dataTransfer.files?.length) {
      e.preventDefault();
      void addFiles(e.dataTransfer.files);
    }
  };

  // canvas drop: image straight onto the picture at the drop point
  const canvasDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const binId = e.dataTransfer.getData("application/x-bin-id");
    const item = stateRef.current.bin.find((b) => b.id === binId);
    if (!item || item.kind !== "image") return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    addOverlay(
      item,
      clockRef.current.base,
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
  };

  // --- keyboard ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
      } else if (e.key === "ArrowLeft") {
        seek(clockRef.current.base - (e.shiftKey ? 1 : 0.1));
      } else if (e.key === "ArrowRight") {
        seek(clockRef.current.base + (e.shiftKey ? 1 : 0.1));
      } else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) {
        splitAtPlayhead();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, removeSelection, seek, splitAtPlayhead]);

  // --- export ------------------------------------------------------------------------------

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

    setSelection(null); // don't bake the selection chrome into the export
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
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

    const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    setExporting({ progress: 0 });

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      setExporting(null);
      setExportResult(new File([blob], `studio-video-${Date.now()}.${ext}`, { type: blob.type }));
    };

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
      setExporting((prev) => (prev ? { progress: Math.min(t / total, 1) } : prev));
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

  useEffect(() => {
    if (binTab !== "skatehive" || shVideos) return;
    listSkatehiveVideos().then((r) => {
      if (r.ok) setShVideos(r.videos);
      else setShError(r.error);
    });
  }, [binTab, shVideos]);

  // Google Drive listing (project folder; drill-in via driveStack)
  useEffect(() => {
    if (binTab !== "drive") return;
    setDriveFiles(null);
    setDriveError(null);
    const folderId = driveStack[driveStack.length - 1];
    fetch(`/api/brain/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; files?: { id: string; name: string; mimeType: string; size?: string }[]; error?: string }) => {
        if (j.ok && j.files) setDriveFiles(j.files);
        else setDriveError(j.error ?? "Drive not configured for this project.");
      })
      .catch((e) => setDriveError(String(e)));
  }, [binTab, driveStack]);

  const addDriveFile = async (f: { id: string; name: string; mimeType: string }) => {
    const url = `/api/brain/drive/file?id=${encodeURIComponent(f.id)}&mode=raw`;
    const kind: BinItem["kind"] = f.mimeType.startsWith("audio")
      ? "audio"
      : f.mimeType.startsWith("image")
        ? "image"
        : "video";
    const duration = kind === "image" ? 0 : await probeDuration(url, kind);
    const id = nextId();
    setBin((prev) => [...prev, { id, kind, name: f.name, url, duration, credit: "Drive" }]);
    enrichItem(id, url, kind, duration);
    setBinTab("uploads");
  };

  const selClip = selection?.type === "clip" ? clips.find((c) => c.id === selection.id) : null;
  const selOverlay = selection?.type === "overlay" ? overlays.find((o) => o.id === selection.id) : null;
  const selAudio = selection?.type === "audio" ? audios.find((a) => a.id === selection.id) : null;
  const timelineWidth = Math.max(totalDuration, 10) * pps + 120;

  // -------------------------------------------------------------------------------------------

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row ${dropHot ? "outline outline-2 outline-dashed outline-accent" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropHot(true);
        }
      }}
      onDragLeave={() => setDropHot(false)}
      onDrop={rootDrop}
    >
      {/* ── Media bin ──────────────────────────────────────────────────────── */}
      <div className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-surface lg:w-72">
        <div className="flex border-b border-border text-xs">
          {(
            [
              ["uploads", "Media", Upload],
              ["skatehive", "SkateHive", Film],
              ["art", "Elements", Type],
              ["drive", "Drive", HardDrive],
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
                Upload — or drop files anywhere
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
                  Bin is empty — upload, or pull from the SkateHive / Art tabs. Drag items onto the
                  timeline tracks (images can drop straight on the preview).
                </p>
              )}
              {bin.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-bin-id", item.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2 active:cursor-grabbing"
                >
                  {item.kind === "video" ? (
                    item.thumbs?.[0] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.thumbs[0]} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                    ) : (
                      <Film className="h-3.5 w-3.5 shrink-0 text-accent" />
                    )
                  ) : item.kind === "audio" ? (
                    <Music className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-foreground">{item.name}</p>
                    <p className="truncate text-[10px] text-foreground-faint">
                      {item.kind === "image" ? "art / overlay" : fmt(item.duration)}
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
                <div key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2 py-1.5">
                  <ShThumb url={v.url} />
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
                    disabled={shBusy !== null}
                    title="Add to bin"
                    className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20 disabled:opacity-50"
                  >
                    {shBusy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </>
          )}

          {binTab === "art" && (
            <>
              <p className="px-1 text-[11px] text-foreground-subtle">
                Studio-style assembly over the video — editable text, boxes and pills. Stickers/PNGs
                come from the Media tab (drag them onto the preview).
              </p>
              <button
                type="button"
                onClick={addText}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2 text-xs text-foreground transition-colors hover:border-border-strong"
              >
                <Type className="h-3.5 w-3.5 text-accent" />
                Text — editable, multi-line
              </button>
              <div className="space-y-1.5">
                <p className="px-1 text-[10px] uppercase tracking-wider text-foreground-faint">Box</p>
                <div className="grid grid-cols-6 gap-1.5 px-1">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={`rect-${c}`}
                      type="button"
                      onClick={() => addShape("rect", c)}
                      title={`Box ${c}`}
                      style={{ backgroundColor: c }}
                      className="h-8 rounded-md border border-border hover:border-border-strong"
                    />
                  ))}
                </div>
                <p className="px-1 text-[10px] uppercase tracking-wider text-foreground-faint">Pill</p>
                <div className="grid grid-cols-6 gap-1.5 px-1">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={`pill-${c}`}
                      type="button"
                      onClick={() => addShape("pill", c)}
                      title={`Pill ${c}`}
                      style={{ backgroundColor: c }}
                      className="h-8 rounded-full border border-border hover:border-border-strong"
                    />
                  ))}
                </div>
              </div>
              <p className="px-1 text-[10px] leading-relaxed text-foreground-faint">
                Tip: a red box + white text on top = the PERSPECTIVA flip, straight over the clip.
                Stack order follows creation order.
              </p>
            </>
          )}

          {binTab === "drive" && (
            <>
              {driveStack.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDriveStack((prev) => prev.slice(0, -1))}
                  className="w-full rounded-lg border border-border px-2 py-1.5 text-left text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
                >
                  ← back
                </button>
              )}
              {!driveFiles && !driveError && (
                <p className="flex items-center gap-2 px-1 py-2 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Drive…
                </p>
              )}
              {driveError && <p className="px-1 text-xs text-danger">{driveError}</p>}
              {driveFiles?.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">Empty folder.</p>
              )}
              {driveFiles?.map((f) => {
                const isFolder = f.mimeType === "application/vnd.google-apps.folder";
                const isMedia = /^(image|video|audio)\//.test(f.mimeType);
                const tooBig = f.size != null && Number(f.size) > 10 * 1024 * 1024;
                if (!isFolder && !isMedia) return null;
                return (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2">
                    {isFolder ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : f.mimeType.startsWith("image") ? (
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : f.mimeType.startsWith("audio") ? (
                      <Music className="h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : (
                      <Film className="h-3.5 w-3.5 shrink-0 text-accent" />
                    )}
                    {isFolder ? (
                      <button
                        type="button"
                        onClick={() => setDriveStack((prev) => [...prev, f.id])}
                        className="min-w-0 flex-1 truncate text-left text-xs text-foreground hover:text-accent"
                      >
                        {f.name}
                      </button>
                    ) : (
                      <p className="min-w-0 flex-1 truncate text-xs text-foreground" title={f.name}>
                        {f.name}
                        {tooBig && <span className="ml-1 text-[10px] text-danger">&gt;10MB</span>}
                      </p>
                    )}
                    {!isFolder && (
                      <button
                        type="button"
                        onClick={() => void addDriveFile(f)}
                        disabled={tooBig}
                        title={tooBig ? "Over the 10MB Drive proxy limit — download + upload instead" : "Add to bin"}
                        className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Preview + timeline ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-black/90 p-3">
          <canvas
            ref={canvasRef}
            className="max-h-full max-w-full touch-none rounded-lg"
            style={{ aspectRatio: `${ASPECTS[aspect].w} / ${ASPECTS[aspect].h}` }}
            onPointerDown={canvasPointerDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={canvasDrop}
          />
        </div>

        {/* transport */}
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={clips.length === 0 || !!exporting}
            title="Play/Pause (space)"
            className="rounded-lg border border-accent-border bg-accent-bg p-2 text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={splitAtPlayhead}
            disabled={clips.length === 0 || !!exporting}
            title="Split clip at playhead (S)"
            className="rounded-lg border border-border p-2 text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40"
          >
            <Scissors className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={addText}
            disabled={!!exporting}
            title="Add text layer"
            className="rounded-lg border border-border p-2 text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40"
          >
            <Type className="h-4 w-4" />
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
            className="min-w-[100px] flex-1 accent-[var(--accent)]"
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPps((p) => Math.max(16, p / 1.4))}
              title="Zoom out timeline"
              className="rounded-md border border-border p-1.5 text-foreground-muted hover:text-foreground"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPps((p) => Math.min(200, p * 1.4))}
              title="Zoom in timeline"
              className="rounded-md border border-border p-1.5 text-foreground-muted hover:text-foreground"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* aspect picker — mini frames so the ratio is visible at a glance */}
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-elevated p-0.5">
            {(Object.keys(ASPECTS) as AspectKey[]).map((k) => {
              const { w, h } = ASPECTS[k];
              const scale = 14 / Math.max(w, h);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAspect(k)}
                  title={`Aspect ${k}`}
                  aria-pressed={aspect === k}
                  className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-1 transition-colors ${
                    aspect === k ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  <span
                    style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
                    className={`rounded-[2px] border ${aspect === k ? "border-accent" : "border-current"}`}
                  />
                  <span className="text-[9px] leading-none">{k}</span>
                </button>
              );
            })}
          </div>
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
              Recording {Math.round(exporting.progress * 100)}%
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
          <div style={{ width: timelineWidth }} className="relative select-none p-2 pl-14">
            {/* track labels */}
            <div className="absolute inset-y-2 left-2 flex w-10 flex-col justify-end gap-1.5 pt-6 text-[9px] uppercase tracking-wider text-foreground-faint">
              <span className="flex h-14 items-center">video</span>
              <span className="flex h-9 items-center">art</span>
              <span className="flex h-10 items-center">audio</span>
            </div>

            {/* ruler */}
            <div
              className="relative mb-1 h-5 cursor-pointer border-b border-border"
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek(snap((e.clientX - rect.left) / pps));
              }}
            >
              {Array.from({ length: Math.ceil(Math.max(totalDuration, 10)) + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute top-0 text-[9px] tabular-nums text-foreground-faint"
                  style={{ left: i * pps }}
                >
                  {i}s
                </span>
              ))}
              <div
                className="pointer-events-none absolute top-0 z-10 h-[150px] w-px bg-accent"
                style={{ left: time * pps }}
              >
                <span className="absolute -left-[5px] -top-0.5 h-2.5 w-2.5 rounded-full bg-accent" />
              </div>
            </div>

            {/* video track */}
            <div
              className="mb-1.5 flex h-14 items-stretch gap-px rounded-md bg-surface-elevated/60 p-0.5"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
              }}
              onDrop={handleTrackDrop("video")}
            >
              {clips.length === 0 && (
                <p className="self-center px-2 text-[10px] italic text-foreground-faint">
                  drop video clips here
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
                    onDragStart={(e) => {
                      dragClipIndex.current = i;
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (dragClipIndex.current != null && dragClipIndex.current !== i)
                        reorderClips(dragClipIndex.current, i);
                      dragClipIndex.current = null;
                    }}
                    onClick={() => setSelection({ type: "clip", id: clip.id })}
                    style={{ width: Math.max(len * pps, 28) }}
                    className={`group relative flex shrink-0 cursor-grab items-end overflow-hidden rounded border ${
                      isSel ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong"
                    }`}
                    title={`${item?.name ?? "clip"} · ${fmt(len)}`}
                  >
                    {/* filmstrip background */}
                    {item?.thumbs?.length ? (
                      <div className="absolute inset-0 flex">
                        {item.thumbs.map((t, ti) => (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img key={ti} src={t} alt="" className="h-full min-w-0 flex-1 object-cover" />
                        ))}
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-surface" />
                    )}
                    <span className="relative z-10 max-w-full truncate bg-black/55 px-1 text-[9px] text-white">
                      {item?.name ?? "clip"}
                    </span>
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
                      className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize rounded-l bg-accent/0 group-hover:bg-accent/70"
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
                      className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize rounded-r bg-accent/0 group-hover:bg-accent/70"
                    />
                  </div>
                );
              })}
            </div>

            {/* art (overlay) track */}
            <div
              className="relative mb-1.5 h-9 rounded-md bg-surface-elevated/60"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
              }}
              onDrop={handleTrackDrop("art")}
            >
              {overlays.length === 0 && (
                <p className="px-2 py-2 text-[10px] italic text-foreground-faint">
                  drop art here — or straight onto the preview
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
                        prev.map((o) => {
                          if (o.id !== ov.id) return o;
                          const len = o.end - o.start;
                          const start = snap(Math.max(0, o.start + d));
                          return { ...o, start, end: start + len };
                        }),
                      ),
                    )}
                    style={{ left: ov.start * pps, width: Math.max((ov.end - ov.start) * pps, 24) }}
                    className={`absolute top-1 flex h-7 cursor-grab items-center overflow-hidden rounded border px-1.5 text-[10px] ${
                      isSel
                        ? "border-success bg-success/20 text-success ring-1 ring-success"
                        : "border-border bg-surface text-foreground-muted hover:border-border-strong"
                    }`}
                  >
                    {ov.kind === "text" ? (
                      <Type className="mr-1 h-3 w-3 shrink-0" />
                    ) : ov.kind === "shape" ? (
                      <Square className="mr-1 h-3 w-3 shrink-0" style={{ color: ov.color }} />
                    ) : (
                      <ImageIcon className="mr-1 h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">
                      {ov.kind === "text"
                        ? (ov.text ?? "text").split("\n")[0]
                        : ov.kind === "shape"
                          ? ov.shape ?? "shape"
                          : item?.name ?? "art"}
                    </span>
                    <span
                      onPointerDown={hDrag((d) =>
                        setOverlays((prev) =>
                          prev.map((o) =>
                            o.id === ov.id ? { ...o, end: snap(Math.max(o.start + MIN_CLIP, o.end + d)) } : o,
                          ),
                        ),
                      )}
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-success/50"
                    />
                  </div>
                );
              })}
            </div>

            {/* audio track */}
            <div
              className="relative h-10 rounded-md bg-surface-elevated/60"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
              }}
              onDrop={handleTrackDrop("audio")}
            >
              {audios.length === 0 && (
                <p className="px-2 py-2.5 text-[10px] italic text-foreground-faint">drop audio here</p>
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
                        prev.map((x) =>
                          x.id === a.id ? { ...x, offset: snap(Math.max(0, x.offset + d)) } : x,
                        ),
                      ),
                    )}
                    style={{ left: a.offset * pps, width: Math.max((item?.duration ?? 3) * pps, 24) }}
                    className={`absolute top-1 flex h-8 cursor-grab items-center overflow-hidden rounded border px-1 text-[10px] ${
                      isSel
                        ? "border-warning bg-warning/15 text-warning ring-1 ring-warning"
                        : "border-border bg-surface text-foreground-muted hover:border-border-strong"
                    }`}
                  >
                    {item?.waveUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.waveUrl} alt="" className="absolute inset-0 h-full w-full object-fill opacity-80" />
                    ) : (
                      <Music className="mr-1 h-3 w-3 shrink-0" />
                    )}
                    <span className="relative z-10 truncate bg-black/40 px-1 text-[9px] text-white">
                      {item?.name ?? "audio"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* properties */}
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
                <span className="text-foreground-faint">S = split at playhead</span>
              </>
            )}
            {selOverlay && (
              <>
                <span className="font-medium text-foreground">
                  {selOverlay.kind === "text" ? "Text" : selOverlay.kind === "shape" ? "Shape" : "Sticker"}
                </span>
                {selOverlay.kind === "shape" && (
                  <>
                    <span className="flex items-center gap-1">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setOverlays((prev) =>
                              prev.map((o) => (o.id === selOverlay.id ? { ...o, color: c } : o)),
                            )
                          }
                          aria-label={`Shape color ${c}`}
                          style={{ backgroundColor: c }}
                          className={`h-4 w-4 rounded-full border ${
                            selOverlay.color === c ? "border-accent ring-1 ring-accent" : "border-border"
                          }`}
                        />
                      ))}
                    </span>
                    <label className="flex items-center gap-2 text-foreground-muted">
                      height
                      <input
                        type="range"
                        min={0.05}
                        max={1.5}
                        step={0.02}
                        value={selOverlay.hRatio ?? 0.4}
                        onChange={(e) =>
                          setOverlays((prev) =>
                            prev.map((o) =>
                              o.id === selOverlay.id ? { ...o, hRatio: Number(e.target.value) } : o,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
                {selOverlay.kind === "text" && (
                  <>
                    <input
                      type="text"
                      value={selOverlay.text ?? ""}
                      onChange={(e) =>
                        setOverlays((prev) =>
                          prev.map((o) =>
                            o.id === selOverlay.id ? { ...o, text: e.target.value } : o,
                          ),
                        )
                      }
                      placeholder="Text…"
                      className="w-44 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
                    />
                    <span className="flex items-center gap-1">
                      {TEXT_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() =>
                            setOverlays((prev) =>
                              prev.map((o) => (o.id === selOverlay.id ? { ...o, color: c } : o)),
                            )
                          }
                          aria-label={`Text color ${c}`}
                          style={{ backgroundColor: c }}
                          className={`h-4 w-4 rounded-full border ${
                            selOverlay.color === c ? "border-accent ring-1 ring-accent" : "border-border"
                          }`}
                        />
                      ))}
                    </span>
                    <label className="flex items-center gap-1.5 text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={selOverlay.bg}
                        onChange={(e) =>
                          setOverlays((prev) =>
                            prev.map((o) => (o.id === selOverlay.id ? { ...o, bg: e.target.checked } : o)),
                          )
                        }
                      />
                      bg
                    </label>
                  </>
                )}
                <span className="text-foreground-faint">
                  drag on preview to move · corner handle to scale
                </span>
                <label className="flex items-center gap-2 text-foreground-muted">
                  size
                  <input
                    type="range"
                    min={0.08}
                    max={2}
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
                  rotation
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round((selOverlay.rotation * 180) / Math.PI)}
                    onChange={(e) =>
                      setOverlays((prev) =>
                        prev.map((o) =>
                          o.id === selOverlay.id
                            ? { ...o, rotation: (Number(e.target.value) * Math.PI) / 180 }
                            : o,
                        ),
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
              onClick={removeSelection}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger hover:bg-danger/20"
            >
              <Trash2 className="h-3 w-3" />
              remove (Del)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
