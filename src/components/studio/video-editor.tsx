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
  Check,
  CheckCheck,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  FolderOpen,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
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
import {
  listSkatehiveVideos,
  listSkatehiveLeaderboard,
  listCreatorVideos,
  type SkatehiveVideo,
  type SkatehiveCreator,
  type SnapCursor,
  type CreatorCursor,
} from "@/app/actions/skatehive-media";
import { uploadMediaDirectClient } from "@/lib/upload-media-client";

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

type Clip = {
  id: string;
  binId: string;
  in: number;
  out: number;
  volume: number;
  /** Framing within the cover-fit crop: pan (-1..1 of the overflow) + zoom. */
  offsetX?: number;
  offsetY?: number;
  scale?: number;
};
type CardStyle = "holo" | "pixel" | "gold" | "bounty";
type Rarity = "Rare" | "Epic" | "Legendary";

/** Trading-card overlay that frames the clip as a rare TCG card. */
type CardData = {
  style: CardStyle;
  skater: string;
  title: string;
  description: string;
  type: string; // discipline tag e.g. STREET
  upvotes: string;
  runtime: string;
  serial: string;
  rarity: Rarity;
  motion: boolean;
  accent: string; // holo/brand hue
  fontScale: number;
  hidden: string[]; // element ids to hide: eyebrow watermark stats serial type
  /** Bounty style only — onchain reward shown in the accent (e.g. "0.42 ETH"). */
  reward?: string;
  /** Bounty style only — logo asset drawn top-center. "" = no logo. Undefined
   *  falls back to the Gnars grants seal for back-compat. */
  logo?: string;
  /** Bounty style only — footer URL highlighted near the bottom. */
  footerUrl?: string;
};

type Overlay = {
  id: string;
  kind: "image" | "text" | "shape" | "card";
  /** Which overlay track this layer lives on. */
  trackId: string;
  binId?: string;
  /** Shape style (kind shape). */
  shape?: "rect" | "pill";
  /** Shape height as a fraction of its width. */
  hRatio?: number;
  /** Text content (kind text) — supports \n for multi-line. */
  text?: string;
  /** Card payload (kind card). */
  card?: CardData;
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

const RARITY: Record<Rarity, { label: string; gems: number; accent2: string }> = {
  Rare: { label: "HOLO RARE", gems: 4, accent2: "#7cf2d8" },
  Epic: { label: "EPIC FOIL", gems: 5, accent2: "#b98cff" },
  Legendary: { label: "LEGENDARY", gems: 6, accent2: "#ffd86b" },
};

/** Logos selectable for the bounty card's top-center slot. `src: ""` = none. */
const BOUNTY_LOGO = "/og-assets/grants-seal.png";
const CARD_LOGOS: { label: string; src: string }[] = [
  { label: "Grants Seal", src: BOUNTY_LOGO },
  { label: "Gnars", src: "/projects/gnars/logo.png" },
  { label: "Skatehive", src: "/projects/skatehive/logo.svg" },
  { label: "None", src: "" },
];

// Module-scoped image cache so the pure draw functions can paint any logo by
// src without prop-drilling. Each entry tracks its own load state; draw code
// reserves layout space until ready so the composition doesn't jump.
const logoCache = new Map<string, { img: HTMLImageElement; ready: boolean }>();
function ensureLogo(src: string) {
  if (!src || typeof Image === "undefined" || logoCache.has(src)) return;
  const entry = { img: new Image(), ready: false };
  entry.img.onload = () => {
    entry.ready = true;
  };
  entry.img.src = src;
  logoCache.set(src, entry);
}
function getLogo(src: string): HTMLImageElement | null {
  const e = logoCache.get(src);
  return e && e.ready ? e.img : null;
}

const CARD_STYLE_META: Record<CardStyle, { name: string; note: string; defaultAccent: string }> = {
  holo: { name: "Neon Holo Rare", note: "Lime holographic foil + glow", defaultAccent: "#a3e635" },
  pixel: { name: "Pixel Arcade Legend", note: "8-bit border + CRT scanlines", defaultAccent: "#bdf25a" },
  gold: { name: "Gold Legendary Foil", note: "Gilded frame + medallion seal", defaultAccent: "#ffd86b" },
  bounty: { name: "Gnars Bounty", note: "POIDH challenge — Ken Pixel on black, onchain reward in gold", defaultAccent: "#fbbf24" },
};

// Gnars bounty palette — mirrors gnars-website OG_COLORS (og-utils.ts).
const GN = {
  bg: "#000000",
  fg: "#ffffff",
  muted: "#888888",
  mutedLight: "#aaaaaa",
  gold: "#fbbf24", // accentYellow — the hero reward color
};

// The "Ken Pixel" font lives in /public/og-assets, copied from gnars-website.
// Loaded once on the client. The bounty logo (default grants seal) is loaded
// separately via the generic logoCache so it can be swapped per-card.
let gnarsAssetsRequested = false;
function ensureGnarsBountyAssets() {
  if (gnarsAssetsRequested || typeof document === "undefined") return;
  gnarsAssetsRequested = true;
  try {
    const ff = new FontFace("Ken Pixel", "url(/og-assets/kenpixel.ttf)");
    ff.load()
      .then((loaded) => {
        (document as Document & { fonts: FontFaceSet }).fonts.add(loaded);
      })
      .catch(() => {});
  } catch {
    /* FontFace unsupported — falls back to monospace */
  }
  ensureLogo(BOUNTY_LOGO);
}

// Reference palette (reel.css).
const SH = {
  lime: "#a3e635",
  lime2: "#bdf25a",
  ink: "#0b0c0a",
  cream: "#f1f2ea",
  steel: "#869072",
  desc: "#c2cbb2",
};

/** Full-bleed card layout: the card fills the whole canvas; the reel's
 *  internal regions (head, art window, title, stats, foot) reflow within it,
 *  with the eyebrow/watermark in the IG safe zones. */
function cardLayout(w: number, h: number) {
  const P = Math.round(w * 0.055); // padding
  const topSafe = Math.round(h * 0.06);
  const botSafe = Math.round(h * 0.075);
  const headTop = topSafe + Math.round(h * 0.045); // below eyebrow
  const headH = Math.round(h * 0.07);
  const artTop = headTop + headH + Math.round(h * 0.012);
  // Reserve the bottom band for title + desc + stats + foot + watermark.
  const textBand = Math.round(h * 0.3);
  const artH = Math.max(h - botSafe - textBand - artTop, Math.round(h * 0.18));
  const card = { x: 0, y: 0, w, h };
  const art = { x: P, y: artTop, w: w - 2 * P, h: artH };
  return { card, art, P, topSafe, botSafe, headTop, headH };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Cover-fit a video element into a rect with pan/zoom, clipped. */
function drawCoverInRect(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  framing: { offsetX: number; offsetY: number; scale: number },
) {
  const vr = el.videoWidth / el.videoHeight || 1;
  const rr = rw / rh;
  const scale = framing.scale || 1;
  let dw = rw, dh = rh;
  if (vr > rr) { dh = rh; dw = rh * vr; } else { dw = rw; dh = rw / vr; }
  dw *= scale; dh *= scale;
  const dx = rx + (rw - dw) / 2 + (framing.offsetX * (dw - rw)) / 2;
  const dy = ry + (rh - dh) / 2 + (framing.offsetY * (dh - rh)) / 2;
  ctx.drawImage(el, dx, dy, dw, dh);
}

/** Render the clip as premium skate-media: full-bleed video is the hero, with
 *  an editorial type hierarchy (title → creator → minimal metadata) over a
 *  legibility scrim. No frames, gems, foil or glow — SkateHive green is used
 *  only as a meaning-bearing accent. */
function drawCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  card: CardData,
  clipEl: HTMLVideoElement | null,
  framing: { offsetX: number; offsetY: number; scale: number },
  _nowMs: number,
  brandName: string,
) {
  // Gnars bounty cards use a different visual language entirely (POIDH
  // challenge: Ken Pixel on black, onchain reward in gold). Branch out early.
  if (card.style === "bounty") {
    drawBountyCard(ctx, W, H, card, clipEl, framing);
    return;
  }

  const accent = card.accent || SH.lime;
  const fs = card.fontScale || 1;
  const hidden = new Set(card.hidden ?? []);
  const S = Math.min(W, H) / 1080;
  const f = (n: number) => n * S * fs;
  const P = W * 0.06; // generous editorial margin
  const topSafe = H * 0.05;
  const botSafe = H * 0.09;
  const ready = clipEl && clipEl.readyState >= 2;
  const setFont = (px: number, weight = 800, mono = false) => {
    ctx.font = `${weight} ${f(px)}px ${
      mono ? "'JetBrains Mono', ui-monospace, monospace" : "'Hanken Grotesk', system-ui, sans-serif"
    }`;
  };

  // 1) media — the hero, edge to edge.
  if (ready) {
    drawCoverInRect(ctx, clipEl!, 0, 0, W, H, framing);
  } else {
    ctx.fillStyle = "#0b0c0a";
    ctx.fillRect(0, 0, W, H);
  }

  // 2) legibility scrims — subtle top (wordmark) + stronger bottom (titles).
  const topScrim = ctx.createLinearGradient(0, 0, 0, H * 0.22);
  topScrim.addColorStop(0, "rgba(0,0,0,0.42)");
  topScrim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, W, H * 0.22);
  const botScrim = ctx.createLinearGradient(0, H * 0.5, 0, H);
  botScrim.addColorStop(0, "rgba(0,0,0,0)");
  botScrim.addColorStop(0.6, "rgba(0,0,0,0.55)");
  botScrim.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = botScrim;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  // 3) brand wordmark — top-left, minimal. Green tick is the only top accent.
  if (!hidden.has("eyebrow")) {
    const wy = topSafe + f(26);
    ctx.fillStyle = accent;
    const tick = f(13);
    roundRectPath(ctx, P, wy - tick, tick, tick, f(3));
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    setFont(23, 800);
    ctx.fillStyle = "#ffffff";
    const wordmark = (brandName || "SkateHive").toUpperCase();
    // letter-spacing by hand for an editorial wordmark
    let wx = P + tick + f(12);
    for (const ch of wordmark) {
      ctx.fillText(ch, wx, wy);
      wx += ctx.measureText(ch).width + f(3.5);
    }
  }

  // 4) bottom editorial stack — creator (tertiary) · title (secondary) · meta.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const maxW = W - P * 2;

  // wrap the title (up to 3 lines, confident size)
  setFont(78, 800);
  const titleLineH = f(80);
  const words = (card.title || "Untitled").trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length === 2) break; // 3rd line gets the remainder
    } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) lines.length = 3;

  // metadata line (minimal): runtime · ▲upvotes(accent) · type
  const metaY = H - botSafe;
  if (!hidden.has("stats")) {
    setFont(24, 600, true);
    let mx = P;
    const drawMeta = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, mx, metaY);
      mx += ctx.measureText(text).width;
    };
    const sep = "   ·   ";
    if (card.runtime) drawMeta(card.runtime, "rgba(255,255,255,0.72)");
    if (card.upvotes && card.upvotes !== "0") {
      drawMeta(sep, "rgba(255,255,255,0.3)");
      drawMeta(`▲ ${card.upvotes}`, accent); // community love — meaningful accent
    }
    if (!hidden.has("type") && card.type) {
      drawMeta(sep, "rgba(255,255,255,0.3)");
      drawMeta(card.type.toUpperCase(), "rgba(255,255,255,0.72)");
    }
  }

  // title block sits above the meta, drawn bottom-up.
  const titleBottom = metaY - f(36);
  setFont(78, 800);
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < lines.length; i++) {
    const y = titleBottom - (lines.length - 1 - i) * titleLineH;
    ctx.fillText(lines[i], P, y);
  }

  // creator handle — tertiary kicker above the title.
  const topTitleY = titleBottom - (lines.length - 1) * titleLineH;
  if (card.skater) {
    setFont(30, 700);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(card.skater, P, topTitleY - titleLineH * 0.62);
  }
}

/** Gnars POIDH bounty card — faithful to the gnars.com per-bounty OG template:
 *  black field, Ken Pixel type, "GNARS CHALLENGE" kicker, big title, the
 *  onchain reward in gold, grants seal, footer URL. The clip plays in a framed
 *  window in the upper-middle (this is a video tool — the footage stays the
 *  hero), with the bounty chrome stacked around it. */
function drawBountyCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  card: CardData,
  clipEl: HTMLVideoElement | null,
  framing: { offsetX: number; offsetY: number; scale: number },
) {
  ensureGnarsBountyAssets();
  const gold = card.accent || GN.gold;
  const fs = card.fontScale || 1;
  const S = Math.min(W, H) / 1080;
  const f = (n: number) => n * S * fs;
  const P = W * 0.08;
  const topSafe = H * 0.06;
  const botSafe = H * 0.07;
  const pix = (px: number) => {
    ctx.font = `400 ${f(px)}px 'Ken Pixel', 'JetBrains Mono', ui-monospace, monospace`;
  };
  // Letter-spaced centered pixel text; returns the baseline advance used.
  const centerText = (text: string, cy: number, color: string, spacing: number) => {
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    let total = 0;
    for (const ch of text) total += ctx.measureText(ch).width + spacing;
    total -= spacing;
    let x = W / 2 - total / 2;
    for (const ch of text) {
      ctx.fillText(ch, x, cy);
      x += ctx.measureText(ch).width + spacing;
    }
  };

  // 1) black field
  ctx.fillStyle = GN.bg;
  ctx.fillRect(0, 0, W, H);

  let y = topSafe;

  // 2) logo, top-center — configurable (defaults to the grants seal). "" = none,
  // which reclaims the space so the kicker rides higher.
  const logoSrc = card.logo === undefined ? BOUNTY_LOGO : card.logo;
  if (logoSrc) {
    ensureLogo(logoSrc);
    const logoImg = getLogo(logoSrc);
    const logoW = Math.min(W, H) * 0.16;
    if (logoImg) {
      const logoH = logoW * (logoImg.height / logoImg.width || 1.22);
      ctx.drawImage(logoImg, W / 2 - logoW / 2, y, logoW, logoH);
      y += logoH + f(26);
    } else {
      // reserve space while the logo loads so the layout doesn't jump
      y += logoW * 1.22 + f(26);
    }
  }

  // 3) kicker — "GNARS CHALLENGE"
  pix(26);
  ctx.textBaseline = "alphabetic";
  centerText("GNARS CHALLENGE", y + f(24), GN.mutedLight, f(6));
  y += f(24) + f(30);

  // 4) clip window — framed, the footage stays the hero
  const winX = P;
  const winW = W - 2 * P;
  const winH = H * 0.34;
  ctx.save();
  roundRectPath(ctx, winX, y, winW, winH, f(10));
  ctx.clip();
  if (clipEl && clipEl.readyState >= 2) {
    drawCoverInRect(ctx, clipEl, winX, y, winW, winH, framing);
  } else {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(winX, y, winW, winH);
  }
  ctx.restore();
  // thin gold frame
  ctx.strokeStyle = gold;
  ctx.lineWidth = Math.max(2, f(3));
  roundRectPath(ctx, winX, y, winW, winH, f(10));
  ctx.stroke();
  y += winH + f(44);

  // 5) title — Ken Pixel, white, centered, wrapped (≤3 lines)
  const titleSize = 52;
  pix(titleSize);
  const maxW = W - 2 * P;
  const words = (card.title || "CHALLENGE").toUpperCase().trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length === 2) break;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) lines.length = 3;
  const lineH = f(titleSize * 1.28);
  for (let i = 0; i < lines.length; i++) {
    centerText(lines[i], y + f(titleSize) + i * lineH, GN.fg, f(2));
  }
  y += lines.length * lineH + f(18);

  // 6) reward — the hero number, gold
  const reward = (card.reward || "").trim();
  if (reward) {
    pix(64);
    centerText(reward.toUpperCase(), y + f(58), gold, f(3));
    y += f(58) + f(20);
  }

  // 7) footer URL — muted, pinned near the bottom (configurable)
  const footer = (card.footerUrl ?? "GNARS.COM/COMMUNITY/BOUNTIES").trim();
  if (footer) {
    pix(20);
    centerText(footer.toUpperCase(), H - botSafe, GN.muted, f(3));
  }
}

const TEXT_COLORS = ["#ffffff", "#0a0a0a", "#a3e635", "#facc15", "#22d3ee", "#ef4444"];

/** Overlay layer track — draw order follows track order (last = topmost). */
type OverlayTrack = { id: string; label: string };
const DEFAULT_TRACKS: OverlayTrack[] = [
  { id: "art", label: "Art" },
  { id: "text", label: "Text" },
];
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
    v.preload = "metadata"; // seeks range-fetch only the frames we sample
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

// --- project persistence (localStorage, per portal origin) -------------------

type SavedProject = {
  id: string;
  name: string;
  updatedAt: string;
  aspect: AspectKey;
  bin: BinItem[]; // every url remote (IPFS/proxy/drive) — blobs upload on save
  clips: Clip[];
  overlays: Overlay[];
  audios: AudioItem[];
  overlayTracks?: OverlayTrack[];
};

/** Older saves predate per-overlay tracks — default art/text by kind. */
function migrateOverlays(list: Overlay[]): Overlay[] {
  return (list ?? []).map((o) =>
    o.trackId ? o : { ...o, trackId: o.kind === "text" ? "text" : "art" },
  );
}

const PROJECTS_KEY = "studio-video:projects:v1";
const AUTOSAVE_KEY = "studio-video:autosave:v1";
const MAX_PROJECTS = 10;

function readProjects(): SavedProject[] {
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    const list = raw ? (JSON.parse(raw) as SavedProject[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeProjects(list: SavedProject[]) {
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
  } catch {
    // quota — caller surfaces the error
  }
}

/** Strip heavy generated assets before persisting (regenerated on load). */
function slimBin(bin: BinItem[]): BinItem[] {
  return bin.map(({ thumbs: _t, waveUrl: _w, ...rest }) => rest);
}

// --- SkateHive thumbnails: CID-keyed cache (memory + localStorage) -----------
// Keyed by the immutable IPFS CID so a thumbnail survives reloads and the
// proxy path. The browser also disk-caches the proxied bytes (immutable
// Cache-Control), so generation is cheap on repeat.

const THUMB_STORE_KEY = "studio-video:thumbs:v1";
const THUMB_STORE_MAX = 200;
const thumbCache = new Map<string, string>();

function thumbKey(url: string): string {
  const m = url.match(/\/ipfs\/([\w-]+)/);
  return m ? m[1] : url.replace(/^.*[?&]url=/, "").slice(0, 200);
}

function hydrateThumbCache() {
  if (typeof window === "undefined" || thumbCache.size) return;
  try {
    const raw = window.localStorage.getItem(THUMB_STORE_KEY);
    if (!raw) return;
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      thumbCache.set(k, v);
    }
  } catch {
    /* ignore corrupt cache */
  }
}
hydrateThumbCache();

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistThumbCache() {
  if (typeof window === "undefined") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = [...thumbCache.entries()].slice(-THUMB_STORE_MAX);
      window.localStorage.setItem(THUMB_STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* quota — fine, memory cache still serves the session */
    }
  }, 800);
}

const thumbQueue: { url: string; resolve: (v: string | null) => void }[] = [];
let thumbWorkers = 0;

/** `url` is the proxied (same-origin) URL; the cache keys by CID. */
function requestThumb(url: string): Promise<string | null> {
  const cached = thumbCache.get(thumbKey(url));
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    thumbQueue.push({ url, resolve });
    pumpThumbs();
  });
}

function pumpThumbs() {
  while (thumbWorkers < 3 && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    const key = thumbKey(job.url);
    thumbWorkers++;
    void (async () => {
      try {
        const hit = thumbCache.get(key);
        if (hit) {
          job.resolve(hit);
          return;
        }
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.preload = "metadata"; // only the frame we seek to gets range-fetched
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
          setTimeout(res, 1500);
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
        thumbCache.set(key, dataUrl);
        persistThumbCache();
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

/** Eagerly warm thumbnails for a batch of raw IPFS urls (the Sync button). */
function warmThumbnails(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = urls.length;
  if (total === 0) return Promise.resolve();
  let done = 0;
  return new Promise((resolve) => {
    for (const u of urls) {
      void requestThumb(safeUrl(u)).finally(() => {
        done++;
        onProgress?.(done, total);
        if (done === total) resolve();
      });
    }
  });
}

/** Thumbnail that generates once scrolled into view (cache hit is instant). */
function ShThumb({ url }: { url: string }) {
  const [thumb, setThumb] = useState<string | null>(() => thumbCache.get(thumbKey(url)) ?? null);
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
  cardStyles = [],
  brandName = "SkateHive",
  brandAccent = "#a3e635",
}: {
  onUseInPost?: (files: File[], caption: string, aspectHint?: number) => Promise<void>;
  cardStyles?: CardStyle[];
  brandName?: string;
  brandAccent?: string;
}) {
  const [bin, setBin] = useState<BinItem[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [overlayTracks, setOverlayTracks] = useState<OverlayTrack[]>(DEFAULT_TRACKS);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [aspect, setAspect] = useState<AspectKey>("4:5");
  const [selection, setSelection] = useState<Selection>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [pps, setPps] = useState(48); // timeline zoom (px per second)
  const [binTab, setBinTab] = useState<
    "uploads" | "skatehive" | "art" | "drive" | "templates"
  >("uploads");
  const [driveFiles, setDriveFiles] = useState<
    { id: string; name: string; mimeType: string; size?: string }[] | null
  >(null);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveStack, setDriveStack] = useState<string[]>([]); // folder drill-in
  const [shVideos, setShVideos] = useState<SkatehiveVideo[] | null>(null);
  const [shError, setShError] = useState<string | null>(null);
  const [shBusy, setShBusy] = useState<string | null>(null);
  const [shCursor, setShCursor] = useState<SnapCursor | null>(null);
  const [shMoreBusy, setShMoreBusy] = useState(false);
  const [creators, setCreators] = useState<SkatehiveCreator[] | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [creatorVideos, setCreatorVideos] = useState<SkatehiveVideo[] | null>(null);
  const [creatorBusy, setCreatorBusy] = useState(false);
  const [creatorCursor, setCreatorCursor] = useState<CreatorCursor | null>(null);
  const [creatorMoreBusy, setCreatorMoreBusy] = useState(false);
  const [shSelected, setShSelected] = useState<Set<string>>(new Set());
  const [shSyncing, setShSyncing] = useState<{ done: number; total: number } | null>(null);
  /** Click-to-preview for side-panel items (bin + skatehive). */
  const [panelPreview, setPanelPreview] = useState<{
    kind: BinItem["kind"];
    url: string;
    name: string;
    /** Set when previewing a bin item — enables discard. */
    binId?: string;
  } | null>(null);
  const [exporting, setExporting] = useState<null | { progress: number }>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropHot, setDropHot] = useState(false);
  // --- project persistence ---
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [restoredNote, setRestoredNote] = useState(false);
  // --- resizable media panel (persisted) ---
  const [panelW, setPanelW] = useState(340);

  const videoEls = useRef(new Map<string, HTMLVideoElement>());
  /** Original Files for uploaded bin items — needed to push blobs to IPFS on save. */
  const fileRef = useRef(new Map<string, File>());
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const imageEls = useRef(new Map<string, HTMLImageElement>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodes = useRef(new Map<string, GainNode>());
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clockRef = useRef({ playing: false, t0: 0, base: 0 });
  /** While true, the export driver owns video elements — sync leaves them alone. */
  const exportDriveRef = useRef(false);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const stateRef = useRef({ clips, overlays, audios, bin, aspect, selection, overlayTracks });
  stateRef.current = { clips, overlays, audios, bin, aspect, selection, overlayTracks };

  const totalDuration = useMemo(() => clips.reduce((s, c) => s + (c.out - c.in), 0), [clips]);

  // Load the card's reference fonts so the canvas renders them (Hanken
  // Grotesk + JetBrains Mono) instead of falling back to system sans/mono.
  useEffect(() => {
    if (cardStyles.length === 0 || typeof document === "undefined") return;
    const id = "studio-card-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;700;800&family=JetBrains+Mono:wght@400;500;700;800&display=swap";
      document.head.appendChild(link);
    }
    // Warm the specific weights the canvas draws with.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      [
        "800 42px 'Hanken Grotesk'",
        "700 18px 'Hanken Grotesk'",
        "500 19px 'Hanken Grotesk'",
        "800 26px 'JetBrains Mono'",
        "700 14px 'JetBrains Mono'",
      ].forEach((s) => fonts.load(s).catch(() => {}));
    }
    // Gnars bounty cards need the Ken Pixel font + grants seal.
    if (cardStyles.includes("bounty")) ensureGnarsBountyAssets();
  }, [cardStyles]);

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

    // During export the driver writes `base` directly each frame (t0 is stale),
    // so the wall-clock term would corrupt the time — use base verbatim.
    const t =
      clockRef.current.playing && !exportDriveRef.current
        ? clockRef.current.base + (performance.now() - clockRef.current.t0) / 1000
        : clockRef.current.base;

    const active = clipAt(t);
    // A card overlay takes over the whole frame (it draws the clip into its
    // own art window) — suppress the normal full-frame clip draw when one is
    // active at this time.
    const activeCard = stateRef.current.overlays.find(
      (o) => o.kind === "card" && t >= o.start && t <= o.end,
    );
    if (active && !activeCard) {
      const item = stateRef.current.bin.find((b) => b.id === active.clip.binId);
      if (item) {
        const el = getVideoEl(item);
        if (el.readyState >= 2) {
          const vr = el.videoWidth / el.videoHeight || 1;
          const cr = w / h;
          const scale = active.clip.scale ?? 1;
          let dw = w, dh = h;
          if (vr > cr) { dh = h; dw = h * vr; }
          else { dw = w; dh = w / vr; }
          dw *= scale;
          dh *= scale;
          // Center, then pan by the user's offset across the cropped overflow.
          const ox = active.clip.offsetX ?? 0;
          const oy = active.clip.offsetY ?? 0;
          const dx = (w - dw) / 2 + (ox * (dw - w)) / 2;
          const dy = (h - dh) / 2 + (oy * (dh - h)) / 2;
          ctx.drawImage(el, dx, dy, dw, dh);
        }
      }
    }

    const sel = stateRef.current.selection;
    // z-order: track order (first track bottom, last top), then creation order
    const trackOrder = new Map(stateRef.current.overlayTracks.map((t, i) => [t.id, i]));
    const ordered = [...stateRef.current.overlays].sort(
      (a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0),
    );
    for (const ov of ordered) {
      if (t < ov.start || t > ov.end) continue;
      let drewBox: { ow: number; oh: number } | null = null;

      if (ov.kind === "card" && ov.card) {
        const clip = active ? active.clip : null;
        const item = clip ? stateRef.current.bin.find((b) => b.id === clip.binId) : null;
        const el = item ? getVideoEl(item) : null;
        drawCard(
          ctx,
          w,
          h,
          ov.card,
          el,
          {
            offsetX: clip?.offsetX ?? 0,
            offsetY: clip?.offsetY ?? 0,
            scale: clip?.scale ?? 1,
          },
          performance.now(),
          brandName,
        );
        if (sel?.type === "overlay" && sel.id === ov.id) {
          const { card: cr2 } = cardLayout(w, h);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = Math.max(2, w / 360);
          ctx.setLineDash([10, 6]);
          roundRectPath(ctx, cr2.x, cr2.y, cr2.w, cr2.h, Math.min(34, cr2.w * 0.05));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        continue;
      }

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
      for (const clip of exportDriveRef.current ? [] : cs) {
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
      const t =
        c.playing && !exportDriveRef.current
          ? c.base + (performance.now() - c.t0) / 1000
          : c.base;
      if (c.playing && !exportDriveRef.current) {
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
        fileRef.current.set(id, file);
        setBin((prev) => [...prev, { id, kind, name: file.name, url, duration }]);
        enrichItem(id, url, kind, duration);
      }
    },
    [enrichItem],
  );

  /** Add one SkateHive video to the bin (no tab switch — used solo + batched). */
  const seedSkatehiveVideo = async (v: SkatehiveVideo) => {
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
  };

  const addSkatehive = async (v: SkatehiveVideo) => {
    setShBusy(v.id);
    await seedSkatehiveVideo(v);
    setShBusy(null);
    setBinTab("uploads");
  };

  // URLs already in the bin — marks SkateHive rows as "added".
  const binUrlSet = useMemo(() => new Set(bin.map((b) => b.url)), [bin]);

  const toggleShSelect = (id: string) =>
    setShSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addSelectedSkatehive = async () => {
    const pool = (selectedCreator ? creatorVideos : shVideos) ?? [];
    const chosen = pool.filter(
      (v) => shSelected.has(v.id) && !binUrlSet.has(safeUrl(v.url)),
    );
    if (chosen.length === 0) return;
    setShBusy("batch");
    for (const v of chosen) await seedSkatehiveVideo(v);
    setShBusy(null);
    setShSelected(new Set());
    setBinTab("uploads");
  };

  const syncThumbnails = async () => {
    const pool = (selectedCreator ? creatorVideos : shVideos) ?? [];
    if (pool.length === 0 || shSyncing) return;
    setShSyncing({ done: 0, total: pool.length });
    await warmThumbnails(pool.map((v) => v.url), (done, total) =>
      setShSyncing({ done, total }),
    );
    setShSyncing(null);
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
        trackId: stateRef.current.overlayTracks.find((t) => t.id === "art")?.id ?? stateRef.current.overlayTracks[0]?.id ?? "art",
        binId: item.id,
        color: "#ffffff",
        bg: false,
        start: Math.max(0, start),
        // default: stay on screen until the end of the composition
        end: total > start ? total : start + 4,
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
      trackId: stateRef.current.overlayTracks.find((t) => t.id === "art")?.id ?? stateRef.current.overlayTracks[0]?.id ?? "art",
      shape,
      color,
      bg: false,
      hRatio: shape === "pill" ? 0.28 : 0.45,
      start: Math.max(0, start),
      end: total > start ? total : start + 4,
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
      trackId: stateRef.current.overlayTracks.find((t) => t.id === "text")?.id ?? stateRef.current.overlayTracks[0]?.id ?? "text",
      text: "Your text",
      color: "#ffffff",
      bg: true,
      start: Math.max(0, start),
      end: total > start ? total : start + 4,
      x: 0.5,
      y: 0.78,
      w: 0.7,
      opacity: 1,
      rotation: 0,
    };
    setOverlays((prev) => [...prev, ov]);
    setSelection({ type: "overlay", id: ov.id });
  }, []);

  /** Add a trading-card template overlay, prefilled from the active clip. */
  const addCardTemplate = useCallback(
    (style: CardStyle) => {
      const total = stateRef.current.clips.reduce((s, c) => s + (c.out - c.in), 0);
      const firstClip = stateRef.current.clips[0];
      const item = firstClip
        ? stateRef.current.bin.find((b) => b.id === firstClip.binId)
        : null;
      const author = item?.credit?.match(/@([\w.-]+)/)?.[1];
      const votes = item?.credit?.match(/▲\s*(\d+)/)?.[1];
      const dur = firstClip ? firstClip.out - firstClip.in : item?.duration ?? 0;
      const runtime = `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, "0")}`;
      const card: CardData = {
        style,
        skater: author ? `@${author}` : "@skater",
        title: item?.name ?? "UNTITLED",
        description: "",
        type: style === "bounty" ? "CHALLENGE" : "STREET",
        upvotes: votes ?? "0",
        runtime,
        serial: (votes ?? "0000").padStart(4, "0").slice(0, 4),
        rarity: "Rare",
        motion: false,
        accent:
          style === "bounty"
            ? CARD_STYLE_META.bounty.defaultAccent
            : CARD_STYLE_META[style].defaultAccent === "#a3e635"
              ? brandAccent
              : CARD_STYLE_META[style].defaultAccent,
        fontScale: 1,
        hidden: [],
        reward: style === "bounty" ? "0.42 ETH" : undefined,
        logo: style === "bounty" ? BOUNTY_LOGO : undefined,
        footerUrl: style === "bounty" ? "gnars.com/community/bounties" : undefined,
      };
      const ov: Overlay = {
        id: nextId(),
        kind: "card",
        trackId:
          stateRef.current.overlayTracks.find((t) => t.id === "art")?.id ??
          stateRef.current.overlayTracks[0]?.id ??
          "art",
        card,
        color: "#ffffff",
        bg: false,
        start: 0,
        end: total > 0 ? total : 8,
        x: 0.5,
        y: 0.5,
        w: 1,
        opacity: 1,
        rotation: 0,
      };
      setOverlays((prev) => [...prev, ov]);
      setSelection({ type: "overlay", id: ov.id });
      setBinTab("templates");
    },
    [brandAccent],
  );

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

  /** Remove a bin item and every timeline usage of it. */
  const discardBinItem = useCallback((binId: string) => {
    setClips((prev) => prev.filter((c) => c.binId !== binId));
    setOverlays((prev) => prev.filter((o) => o.binId !== binId));
    setAudios((prev) => prev.filter((a) => a.binId !== binId));
    setBin((prev) => prev.filter((b) => b.id !== binId));
    const v = videoEls.current.get(binId);
    if (v) {
      v.pause();
      v.src = "";
      videoEls.current.delete(binId);
    }
    const a = audioEls.current.get(binId);
    if (a) {
      a.pause();
      a.src = "";
      audioEls.current.delete(binId);
    }
    imageEls.current.delete(binId);
    fileRef.current.delete(binId);
    setPanelPreview(null);
    setSelection(null);
  }, []);

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

    // hit-test overlays topmost-first (track z-order)
    const hitOrder = new Map(stateRef.current.overlayTracks.map((tr, i) => [tr.id, i]));
    const visible = stateRef.current.overlays
      .filter((o) => t >= o.start && t <= o.end)
      .sort((a, b) => (hitOrder.get(a.trackId) ?? 0) - (hitOrder.get(b.trackId) ?? 0));
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
      // No overlay hit → pan the clip under the playhead within its crop.
      const active = clipAt(t);
      if (active) {
        setSelection({ type: "clip", id: active.clip.id });
        const clipId = active.clip.id;
        const startOX = active.clip.offsetX ?? 0;
        const startOY = active.clip.offsetY ?? 0;
        const sx = px;
        const sy = py;
        const move = (ev: PointerEvent) => {
          const nx = ((ev.clientX - rect.left) / rect.width) * w;
          const ny = ((ev.clientY - rect.top) / rect.height) * h;
          // Drag right → reveal the left side: offset moves with the cursor,
          // clamped so you can't pan past the frame edges.
          setClips((prev) =>
            prev.map((c) =>
              c.id === clipId
                ? {
                    ...c,
                    offsetX: Math.max(-1, Math.min(1, startOX + ((nx - sx) / w) * 2)),
                    offsetY: Math.max(-1, Math.min(1, startOY + ((ny - sy) / h) * 2)),
                  }
                : c,
            ),
          );
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      } else if (stateRef.current.selection?.type === "overlay") {
        setSelection(null);
      }
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

  // --- project save / load / autosave ------------------------------------------------

  useEffect(() => {
    setProjects(readProjects());
    try {
      const w = Number(window.localStorage.getItem("studio-video:panelW"));
      if (w >= 260 && w <= 600) setPanelW(w);
    } catch {}
    // Restore the unsaved session (structure only; blob-backed media can't
    // survive a reload, so those items and their clips are dropped).
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const a = JSON.parse(raw) as SavedProject;
        if (a?.clips?.length || a?.overlays?.length) {
          const keep = new Set(
            (a.bin ?? []).filter((b) => !b.url.startsWith("blob:")).map((b) => b.id),
          );
          const bin2 = (a.bin ?? []).filter((b) => keep.has(b.id));
          setBin(bin2);
          setClips((a.clips ?? []).filter((c) => keep.has(c.binId)));
          setOverlayTracks(a.overlayTracks?.length ? a.overlayTracks : DEFAULT_TRACKS);
          setOverlays(migrateOverlays(a.overlays ?? []).filter((o) => !o.binId || keep.has(o.binId)));
          setAudios((a.audios ?? []).filter((x) => keep.has(x.binId)));
          setAspect(a.aspect ?? "4:5");
          setProjectName(a.name ?? "Untitled");
          setCurrentProjectId(a.id ?? null);
          setRestoredNote(true);
          for (const b of bin2) enrichItem(b.id, b.url, b.kind, b.duration);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finished export is a recording of the composition AT THAT MOMENT —
  // any later edit (new layer, trim, aspect…) makes it stale. Drop it so
  // "Usar no post" can never ship a pre-edit version.
  const exportedRef = useRef(false);
  useEffect(() => {
    if (exportResult && exportedRef.current) {
      setExportResult(null);
      setError("Composition changed — export again to include the latest edits.");
    }
    exportedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, overlays, audios, aspect]);

  // Debounced autosave of the working session.
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const snapshot: SavedProject = {
          id: currentProjectId ?? "autosave",
          name: projectName,
          updatedAt: "",
          aspect,
          bin: slimBin(bin),
          clips,
          overlays,
          audios,
          overlayTracks,
        };
        window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
      } catch {}
    }, 1200);
    return () => window.clearTimeout(t);
  }, [bin, clips, overlays, audios, aspect, projectName, currentProjectId, overlayTracks]);

  /** Save the project: blob-backed media first uploads to IPFS so the draft
   *  fully survives reloads and can be reopened on any of the 10 slots. */
  const saveProject = useCallback(async () => {
    if (savingProject) return;
    setSavingProject(true);
    setError(null);
    try {
      let nextBin = stateRef.current.bin;
      for (const item of nextBin) {
        if (!item.url.startsWith("blob:")) continue;
        const file = fileRef.current.get(item.id);
        if (!file) throw new Error(`"${item.name}" has no recoverable file — re-add it.`);
        const up = await uploadMediaDirectClient(file);
        if (!up.ok) throw new Error(up.error);
        nextBin = nextBin.map((b) => (b.id === item.id ? { ...b, url: up.url } : b));
      }
      setBin(nextBin);
      const existing = readProjects();
      const id = currentProjectId ?? nextId();
      const entry: SavedProject = {
        id,
        name: projectName.trim() || "Untitled",
        updatedAt: new Date().toISOString(),
        aspect,
        bin: slimBin(nextBin),
        clips: stateRef.current.clips,
        overlays: stateRef.current.overlays,
        audios: stateRef.current.audios,
        overlayTracks: stateRef.current.overlayTracks,
      };
      const idx = existing.findIndex((p) => p.id === id);
      if (idx >= 0) existing[idx] = entry;
      else {
        if (existing.length >= MAX_PROJECTS)
          throw new Error(`Project limit reached (${MAX_PROJECTS}) — delete one first.`);
        existing.unshift(entry);
      }
      writeProjects(existing);
      setProjects(existing);
      setCurrentProjectId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProject(false);
    }
  }, [savingProject, currentProjectId, projectName, aspect]);

  const loadProject = useCallback(
    (p: SavedProject) => {
      clockRef.current.playing = false;
      clockRef.current.base = 0;
      setPlaying(false);
      setTime(0);
      setBin(p.bin);
      setClips(p.clips);
      setOverlayTracks(p.overlayTracks?.length ? p.overlayTracks : DEFAULT_TRACKS);
      setOverlays(migrateOverlays(p.overlays));
      setAudios(p.audios);
      setAspect(p.aspect);
      setProjectName(p.name);
      setCurrentProjectId(p.id);
      setSelection(null);
      setProjectsOpen(false);
      // wire audio + regenerate thumbs/waves for the restored media
      ensureAudioCtx();
      for (const c of p.clips) {
        const item = p.bin.find((b) => b.id === c.binId);
        if (item) wireAudioGraph(getVideoEl(item), `clip:${item.id}`);
      }
      for (const a of p.audios) {
        const item = p.bin.find((b) => b.id === a.binId);
        if (item) wireAudioGraph(getAudioEl(item), `audio:${item.id}`);
      }
      for (const b of p.bin) enrichItem(b.id, b.url, b.kind, b.duration);
    },
    [ensureAudioCtx, wireAudioGraph, getVideoEl, getAudioEl, enrichItem],
  );

  const deleteProject = useCallback((id: string) => {
    const next = readProjects().filter((p) => p.id !== id);
    writeProjects(next);
    setProjects(next);
    setCurrentProjectId((cur) => (cur === id ? null : cur));
  }, []);

  const newProject = useCallback(() => {
    clockRef.current.playing = false;
    clockRef.current.base = 0;
    setPlaying(false);
    setTime(0);
    setBin([]);
    setClips([]);
    setOverlays([]);
    setAudios([]);
    setSelection(null);
    setProjectName("Untitled");
    setCurrentProjectId(null);
    setProjectsOpen(false);
  }, []);

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
    // Manual-frame capture (captureStream(0)): we push each frame ourselves
    // after drawing it, so recording never depends on the rAF compositor —
    // it stays deterministic and survives the tab losing focus (which froze
    // auto-capture and produced short/glitched exports).
    const capture = canvas.captureStream(0);
    const vTrack = capture.getVideoTracks()[0] as MediaStreamTrack & {
      requestFrame?: () => void;
    };
    const stream = new MediaStream([
      ...capture.getVideoTracks(),
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
      if (blob.size < 20_000) {
        setError("Export came out empty/corrupted — try again (keep this tab focused while recording).");
        return;
      }
      exportedRef.current = true;
      setExportResult(new File([blob], `studio-video-${Date.now()}.${ext}`, { type: blob.type }));
    };

    // Element-driven export: each clip's <video> is the ground truth for the
    // master clock (no drift-correction seeks = no glitches). Every clip is
    // pre-decoded and pre-seeked before its frames are recorded.
    const cs = [...stateRef.current.clips];
    const waitEvent = (el: HTMLMediaElement, ev: string, timeoutMs = 4000) =>
      new Promise<void>((res) => {
        const t = setTimeout(done, timeoutMs);
        function done() {
          clearTimeout(t);
          el.removeEventListener(ev, done);
          res();
        }
        el.addEventListener(ev, done, { once: true });
      });

    exportDriveRef.current = true;
    clockRef.current.playing = true;
    clockRef.current.base = 0;
    setPlaying(true);
    setTime(0);

    // Preload every clip + land the first frame before recording starts.
    for (const clip of cs) {
      const item = stateRef.current.bin.find((b) => b.id === clip.binId);
      if (!item) continue;
      const el = getVideoEl(item);
      if (el.readyState < 2) await waitEvent(el, "loadeddata", 8000);
    }
    const firstItem = stateRef.current.bin.find((b) => b.id === cs[0]?.binId);
    if (firstItem) {
      const el = getVideoEl(firstItem);
      el.currentTime = cs[0].in;
      await waitEvent(el, "seeked");
    }

    recorder.start(500);
    draw(); // seed the first frame so the recording opens on frame 0
    vTrack.requestFrame?.();

    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      exportDriveRef.current = false;
      clockRef.current.playing = false;
      clockRef.current.base = 0;
      setPlaying(false);
      setTime(0);
      syncMedia(0, false);
      // small tail so the final frames flush into the recording
      setTimeout(() => recorder.stop(), 150);
    };

    void (async () => {
      try {
        let startAt = 0;
        for (const clip of cs) {
          const item = stateRef.current.bin.find((b) => b.id === clip.binId);
          if (!item) continue;
          const el = getVideoEl(item);
          if (Math.abs(el.currentTime - clip.in) > 0.05) {
            el.currentTime = clip.in;
            await waitEvent(el, "seeked");
          }
          const gain = gainNodes.current.get(`clip:${item.id}`);
          if (gain) gain.gain.value = clip.volume;
          await el.play().catch(() => {});
          // Drive the master clock from the element until the clip's out point.
          // A 33ms timer (not rAF) keeps advancing even when the tab is hidden;
          // we draw + push a frame explicitly each tick.
          await new Promise<void>((res) => {
            const tick = window.setInterval(() => {
              if (el.ended || el.currentTime >= clip.out - 0.03) {
                window.clearInterval(tick);
                el.pause();
                res();
                return;
              }
              const t = startAt + (el.currentTime - clip.in);
              clockRef.current.base = t;
              setTime(t);
              setExporting((prev) => (prev ? { progress: Math.min(t / total, 1) } : prev));
              syncMedia(t, true); // audio items follow the derived clock
              draw(); // render this frame…
              vTrack.requestFrame?.(); // …and capture it deterministically
            }, 33);
          });
          startAt += clip.out - clip.in;
        }
      } finally {
        finish();
      }
    })();
  }, [ensureAudioCtx, exporting, syncMedia, getVideoEl, draw]);

  const sendToPost = async () => {
    if (!exportResult || !onUseInPost || sending) return;
    setSending(true);
    try {
      // The export was rendered at this exact aspect — hand it over so the post
      // creator locks the preview to the real ratio instead of re-probing the
      // video (metadata probes can fail and fall back to the wrong crop).
      const dims = ASPECTS[aspect];
      await onUseInPost([exportResult], "", dims.w / dims.h);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (binTab !== "skatehive" || shVideos) return;
    listSkatehiveVideos().then((r) => {
      if (r.ok) {
        setShVideos(r.videos);
        setShCursor(r.cursor);
      } else setShError(r.error);
    });
    listSkatehiveLeaderboard().then((r) => {
      if (r.ok) setCreators(r.creators);
    });
  }, [binTab, shVideos]);

  const loadMoreSh = async () => {
    if (!shCursor || shMoreBusy) return;
    setShMoreBusy(true);
    const r = await listSkatehiveVideos(shCursor);
    if (r.ok) {
      setShVideos((prev) => {
        const seen = new Set((prev ?? []).map((v) => v.id));
        return [...(prev ?? []), ...r.videos.filter((v) => !seen.has(v.id))];
      });
      setShCursor(r.cursor);
    } else setShError(r.error);
    setShMoreBusy(false);
  };

  const pickCreator = async (author: string | null) => {
    setSelectedCreator(author);
    setCreatorVideos(null);
    setCreatorCursor(null);
    if (!author) return;
    setCreatorBusy(true);
    const r = await listCreatorVideos(author);
    if (r.ok) {
      setCreatorVideos(r.videos);
      setCreatorCursor(r.cursor);
    } else setShError(r.error);
    setCreatorBusy(false);
  };

  const loadMoreCreator = async () => {
    if (!selectedCreator || !creatorCursor || creatorMoreBusy) return;
    setCreatorMoreBusy(true);
    const r = await listCreatorVideos(selectedCreator, creatorCursor);
    if (r.ok) {
      setCreatorVideos((prev) => {
        const seen = new Set((prev ?? []).map((v) => v.id));
        return [...(prev ?? []), ...r.videos.filter((v) => !seen.has(v.id))];
      });
      setCreatorCursor(r.cursor);
    } else setShError(r.error);
    setCreatorMoreBusy(false);
  };

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
      {/* ── Media bin (resizable on desktop) ───────────────────────────────── */}
      <div
        className="relative flex w-full shrink-0 flex-col rounded-xl border border-border bg-surface"
        style={{ width: undefined }}
        ref={(el) => {
          if (el && window.innerWidth >= 1024) el.style.width = `${panelW}px`;
          else if (el) el.style.width = "";
        }}
      >
        <div className="flex border-b border-border text-xs">
          {(
            [
              ["uploads", "Media", Upload],
              ["skatehive", "SkateHive", Film],
              ["art", "Elements", Type],
              ["drive", "Drive", HardDrive],
              ...(cardStyles.length > 0
                ? [["templates", "Templates", Sparkles] as const]
                : []),
            ] as const
          ).map(([key, label, Icon]) => {
            const isActive = binTab === key;
            // Icon-always; the label only expands on the active tab so the
            // strip fits any number of sources at any panel width.
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBinTab(key)}
                title={label}
                aria-label={label}
                aria-pressed={isActive}
                className={`flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-2 font-medium transition-colors ${
                  isActive
                    ? "flex-1 bg-accent-bg text-accent"
                    : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {isActive && <span className="truncate">{label}</span>}
              </button>
            );
          })}
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
                  onClick={() => setPanelPreview({ kind: item.kind, url: item.url, name: item.name, binId: item.id })}
                  className="flex cursor-grab items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2 transition-colors hover:border-border-strong active:cursor-grabbing"
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
                    onClick={(e) => {
                      e.stopPropagation();
                      addToTimeline(item);
                    }}
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
              {/* top-20 leaderboard creators */}
              {creators && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => void pickCreator(null)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                      !selectedCreator
                        ? "border-accent bg-accent-bg text-accent"
                        : "border-border text-foreground-muted hover:border-border-strong"
                    }`}
                  >
                    All
                  </button>
                  {creators.map((c) => (
                    <button
                      key={c.author}
                      type="button"
                      onClick={() => void pickCreator(c.author)}
                      title={`@${c.author} · ${c.points} pts`}
                      className={`flex shrink-0 items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[10px] ${
                        selectedCreator === c.author
                          ? "border-accent bg-accent-bg text-accent"
                          : "border-border text-foreground-muted hover:border-border-strong"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://images.hive.blog/u/${c.author}/avatar/small`}
                        alt=""
                        className="h-5 w-5 rounded-full object-cover"
                      />
                      {c.author}
                    </button>
                  ))}
                </div>
              )}

              {/* Sync (preload thumbnails) + multiselect batch add */}
              {(selectedCreator ? creatorVideos : shVideos)?.length ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void syncThumbnails()}
                    disabled={!!shSyncing}
                    title="Preload thumbnails for every video in the list"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-60"
                  >
                    {shSyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {shSyncing ? `Syncing ${shSyncing.done}/${shSyncing.total}` : "Sync thumbnails"}
                  </button>
                  {shSelected.size > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => void addSelectedSkatehive()}
                        disabled={shBusy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                      >
                        {shBusy === "batch" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        Add {shSelected.size} to bin
                      </button>
                      <button
                        type="button"
                        onClick={() => setShSelected(new Set())}
                        className="text-[11px] text-foreground-faint hover:text-foreground"
                      >
                        clear
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              {!shVideos && !shError && (
                <p className="flex items-center gap-2 px-1 py-2 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading SkateHive IPFS videos…
                </p>
              )}
              {shError && <p className="px-1 text-xs text-danger">{shError}</p>}
              {creatorBusy && (
                <p className="flex items-center gap-2 px-1 py-2 text-xs text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading @{selectedCreator}…
                </p>
              )}
              {(selectedCreator ? creatorVideos : shVideos)?.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">
                  No IPFS videos found{selectedCreator ? ` for @${selectedCreator}` : ""}.
                </p>
              )}
              {(selectedCreator ? creatorVideos : shVideos)?.map((v) => {
                const added = binUrlSet.has(safeUrl(v.url));
                const selected = shSelected.has(v.id);
                return (
                  <div
                    key={v.id}
                    onClick={() => setPanelPreview({ kind: "video", url: safeUrl(v.url), name: v.title })}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                      selected
                        ? "border-accent bg-accent-bg"
                        : "border-border bg-surface-elevated hover:border-border-strong"
                    } ${added ? "opacity-60" : ""}`}
                  >
                    {/* selection checkbox */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleShSelect(v.id);
                      }}
                      aria-pressed={selected}
                      title={selected ? "Deselect" : "Select"}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected ? "border-accent bg-accent text-background" : "border-border-strong"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </button>
                    <ShThumb url={v.url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">{v.title}</p>
                      <p className="truncate text-[10px] text-foreground-faint">
                        @{v.author} · ▲{v.votes} · ${v.payout} ·{" "}
                        <span className={v.source === "snap" ? "text-accent" : "text-warning"}>{v.source}</span>
                      </p>
                    </div>
                    {added ? (
                      <span
                        title="Already added to the bin"
                        className="flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-success"
                      >
                        <CheckCheck className="h-3 w-3" /> added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void addSkatehive(v);
                        }}
                        disabled={shBusy !== null}
                        title="Add to bin"
                        className="rounded-md border border-accent-border bg-accent-bg p-1 text-accent hover:bg-accent/20 disabled:opacity-50"
                      >
                        {shBusy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
              {!selectedCreator && shVideos && shCursor && (
                <button
                  type="button"
                  onClick={() => void loadMoreSh()}
                  disabled={shMoreBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {shMoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Load more
                </button>
              )}
              {selectedCreator && creatorVideos && creatorCursor && (
                <button
                  type="button"
                  onClick={() => void loadMoreCreator()}
                  disabled={creatorMoreBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
                >
                  {creatorMoreBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Load more from @{selectedCreator}
                </button>
              )}
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

          {binTab === "templates" && (
            <>
              <p className="px-1 text-[11px] text-foreground-subtle">
                Trading-card overlays that frame the clip — the video plays inside the card&apos;s art
                window, chrome + your text compose around it. Add one, then edit its fields below.
              </p>
              {clips.length === 0 && (
                <p className="px-1 text-[11px] italic text-foreground-faint">
                  Add a video clip first — the card wraps the clip under the playhead.
                </p>
              )}
              {cardStyles.map((style) => {
                const meta = CARD_STYLE_META[style];
                const isPrimary = style === "holo";
                return (
                  <button
                    key={style}
                    type="button"
                    onClick={() => addCardTemplate(style)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5 text-left transition-colors hover:border-accent-border"
                  >
                    {/* mini card swatch */}
                    <span
                      className="flex h-12 w-9 shrink-0 flex-col items-center justify-center rounded-md border"
                      style={{
                        borderColor: meta.defaultAccent,
                        background:
                          "linear-gradient(160deg, rgba(20,24,16,.96), rgba(8,10,7,.98))",
                        boxShadow: `0 0 12px ${meta.defaultAccent}66`,
                      }}
                    >
                      <span
                        className="h-5 w-6 rounded-sm border"
                        style={{ borderColor: `${meta.defaultAccent}aa`, background: "#111" }}
                      />
                      <span className="mt-1 flex gap-0.5">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <span
                            key={i}
                            className="h-1 w-1 rounded-full"
                            style={{ background: meta.defaultAccent }}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        {meta.name}
                        {isPrimary && (
                          <span className="rounded-full bg-accent-bg px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-accent">
                            featured
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-foreground-faint">
                        {meta.note} · skater name + logo baked in
                      </span>
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-accent" />
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* item preview dock — click any row to inspect before adding */}
        {panelPreview && (
          <div className="border-t border-border p-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-medium text-foreground">{panelPreview.name}</p>
              <span className="flex shrink-0 items-center gap-1">
                {panelPreview.binId && (
                  <button
                    type="button"
                    onClick={() => discardBinItem(panelPreview.binId!)}
                    title="Discard media (removes it from the bin and the timeline)"
                    className="rounded-md border border-danger/30 bg-danger/10 p-1 text-danger hover:bg-danger/20"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPanelPreview(null)}
                  aria-label="Close preview"
                  className="rounded p-0.5 text-foreground-faint hover:text-foreground"
                >
                  ✕
                </button>
              </span>
            </div>
            {panelPreview.kind === "video" && (
              <video
                key={panelPreview.url}
                src={panelPreview.url}
                controls
                playsInline
                preload="metadata"
                className="max-h-48 w-full rounded-lg bg-black object-contain"
              />
            )}
            {panelPreview.kind === "audio" && (
              <audio key={panelPreview.url} src={panelPreview.url} controls className="w-full" />
            )}
            {panelPreview.kind === "image" && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={panelPreview.url} alt="" className="max-h-48 w-full rounded-lg object-contain" />
            )}
          </div>
        )}
        {/* resize handle (desktop) */}
        <div
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = panelW;
            const move = (ev: PointerEvent) => {
              const w = Math.min(600, Math.max(260, startW + (ev.clientX - startX)));
              setPanelW(w);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              try {
                window.localStorage.setItem("studio-video:panelW", String(panelW));
              } catch {}
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          className="absolute -right-1.5 top-0 hidden h-full w-3 cursor-col-resize lg:block"
          title="Drag to resize"
        >
          <div className="mx-auto h-full w-px bg-border transition-colors hover:bg-accent" />
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
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
            className="w-28 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveProject()}
            disabled={savingProject || (clips.length === 0 && overlays.length === 0)}
            title="Save project (uploads local media to IPFS so the draft survives)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40"
          >
            {savingProject ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            type="button"
            onClick={() => setProjectsOpen(true)}
            title="Projects"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {projects.length}/{MAX_PROJECTS}
          </button>
          {!exporting && (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              disabled={clips.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              {exportResult ? "Re-export" : "Export"}
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
          {exportResult?.name.endsWith(".webm") && (
            <span className="text-[11px] text-warning">
              WebM export — Instagram needs MP4 (use Chrome); Hive/Farcaster accept WebM.
            </span>
          )}
          {restoredNote && (
            <button
              type="button"
              onClick={() => setRestoredNote(false)}
              className="text-[11px] text-foreground-faint hover:text-foreground"
              title="Dismiss"
            >
              ↺ unsaved session restored
            </button>
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
              className="relative mb-1.5 flex h-14 items-stretch gap-px rounded-md bg-surface-elevated/60 p-0.5"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
              }}
              onDrop={handleTrackDrop("video")}
            >
              <span className="pointer-events-none absolute left-1 top-1 z-30 rounded bg-surface/80 px-1 text-[8px] uppercase tracking-wider text-foreground-faint">
                Video
              </span>
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

            {/* overlay layer tracks — Art and Text separate; user can add more */}
            {overlayTracks.map((track) => {
              const trackOverlays = overlays.filter((o) => o.trackId === track.id);
              return (
                <div
                  key={track.id}
                  className="relative mb-1.5 h-9 rounded-md bg-surface-elevated/60"
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const binId = e.dataTransfer.getData("application/x-bin-id");
                    const item = stateRef.current.bin.find((b) => b.id === binId);
                    if (!item || item.kind !== "image") return;
                    const at = timelineDropSeconds(e, e.currentTarget);
                    addOverlay(item, at);
                    setOverlays((prev) => {
                      const last = prev[prev.length - 1];
                      return last ? [...prev.slice(0, -1), { ...last, trackId: track.id }] : prev;
                    });
                  }}
                >
                  <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-surface/80 px-1 text-[8px] uppercase tracking-wider text-foreground-faint">
                    {track.label}
                  </span>
                  {trackOverlays.length === 0 && overlayTracks.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setOverlayTracks((prev) => prev.filter((t) => t.id !== track.id))}
                      className="absolute right-1 top-1 z-10 rounded px-1 text-[9px] text-foreground-faint hover:text-danger"
                      title="Remove empty track"
                    >
                      ✕
                    </button>
                  )}
                  {trackOverlays.map((ov) => {
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
                        ) : ov.kind === "card" ? (
                          <Sparkles className="mr-1 h-3 w-3 shrink-0 text-accent" />
                        ) : (
                          <ImageIcon className="mr-1 h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">
                          {ov.kind === "text"
                            ? (ov.text ?? "text").split("\n")[0]
                            : ov.kind === "shape"
                              ? ov.shape ?? "shape"
                              : ov.kind === "card"
                                ? `${CARD_STYLE_META[ov.card!.style].name}`
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
              );
            })}
            <button
              type="button"
              onClick={() =>
                setOverlayTracks((prev) => [
                  ...prev,
                  { id: nextId(), label: `Layer ${prev.length + 1}` },
                ])
              }
              className="mb-1.5 w-full rounded-md border border-dashed border-border px-2 py-1 text-[10px] text-foreground-faint transition-colors hover:border-border-strong hover:text-foreground"
            >
              + add layer track
            </button>

            {/* audio track */}
            <div
              className="relative h-10 rounded-md bg-surface-elevated/60"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-bin-id")) e.preventDefault();
              }}
              onDrop={handleTrackDrop("audio")}
            >
              <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-surface/80 px-1 text-[8px] uppercase tracking-wider text-foreground-faint">
                Audio
              </span>
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
                <label className="flex items-center gap-2 text-foreground-muted">
                  zoom
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={selClip.scale ?? 1}
                    onChange={(e) =>
                      setClips((prev) =>
                        prev.map((c) =>
                          c.id === selClip.id ? { ...c, scale: Number(e.target.value) } : c,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setClips((prev) =>
                      prev.map((c) =>
                        c.id === selClip.id ? { ...c, offsetX: 0, offsetY: 0, scale: 1 } : c,
                      ),
                    )
                  }
                  className="rounded-md border border-border px-2 py-1 text-foreground-muted hover:border-border-strong hover:text-foreground"
                >
                  recenter
                </button>
                <span className="text-foreground-faint">
                  drag on the preview to reposition · S = split
                </span>
                <span className="tabular-nums text-foreground-faint">
                  trim {fmt(selClip.in)} → {fmt(selClip.out)}
                </span>
              </>
            )}
            {selOverlay?.kind === "card" && selOverlay.card && (
              <CardInspector
                card={selOverlay.card}
                onChange={(patch) =>
                  setOverlays((prev) =>
                    prev.map((o) =>
                      o.id === selOverlay.id && o.card
                        ? { ...o, card: { ...o.card, ...patch } }
                        : o,
                    ),
                  )
                }
                onReset={() =>
                  setOverlays((prev) =>
                    prev.map((o) =>
                      o.id === selOverlay.id && o.card
                        ? {
                            ...o,
                            card: {
                              ...o.card,
                              fontScale: 1,
                              hidden: [],
                              accent: CARD_STYLE_META[o.card.style].defaultAccent,
                            },
                          }
                        : o,
                    ),
                  )
                }
                onRemove={removeSelection}
              />
            )}
            {selOverlay && selOverlay.kind !== "card" && (
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
                <label className="flex items-center gap-1.5 text-foreground-muted">
                  track
                  <select
                    value={selOverlay.trackId}
                    onChange={(e) =>
                      setOverlays((prev) =>
                        prev.map((o) => (o.id === selOverlay.id ? { ...o, trackId: e.target.value } : o)),
                      )
                    }
                    className="rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[11px] text-foreground"
                  >
                    {overlayTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
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

      {/* ── Export format dialog ────────────────────────────────────────────── */}
      {exportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Export format"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">Export format</h3>
            <p className="mt-1 text-xs text-foreground-muted">
              Picking a format re-frames the canvas (clips cover-fit, layers keep their relative
              positions) — check the framing behind this dialog before exporting.
            </p>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["9:16", "Reels — Instagram's native video format (1080×1920). Best for single videos.", true],
                  ["4:5", "Vertical feed post (1080×1350). Reels will show it with bars.", false],
                  ["1:1", "Square (1080×1080) — universal for feed and carousels.", false],
                  ["16:9", "Landscape (1920×1080). Instagram crops feed to 1.91:1 — better for X/YouTube.", false],
                ] as const
              ).map(([key, note, recommended]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAspect(key)}
                  aria-pressed={aspect === key}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    aspect === key
                      ? "border-accent bg-accent-bg"
                      : "border-border bg-surface hover:border-border-strong"
                  }`}
                >
                  <span
                    style={{
                      width: Math.round((ASPECTS[key].w / Math.max(ASPECTS[key].w, ASPECTS[key].h)) * 22),
                      height: Math.round((ASPECTS[key].h / Math.max(ASPECTS[key].w, ASPECTS[key].h)) * 22),
                    }}
                    className={`mt-0.5 shrink-0 rounded-[3px] border ${aspect === key ? "border-accent" : "border-foreground-faint"}`}
                  />
                  <span className="min-w-0">
                    <span className={`text-xs font-semibold ${aspect === key ? "text-accent" : "text-foreground"}`}>
                      {key}
                      {recommended && (
                        <span className="ml-1.5 rounded-full bg-accent-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                          recommended
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-foreground-muted">{note}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-foreground-subtle">
              {typeof MediaRecorder !== "undefined" &&
              ["video/mp4;codecs=\"avc1.42E01E,mp4a.40.2\"", "video/mp4"].some((m) =>
                MediaRecorder.isTypeSupported(m),
              )
                ? "Container: MP4 (H.264) — accepted by Instagram, Hive and Farcaster."
                : "⚠ This browser exports WebM — Instagram requires MP4 (use Chrome). Hive/Farcaster accept WebM."}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted hover:border-border-strong hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  void startExport();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background"
              >
                <Download className="h-3.5 w-3.5" />
                Export {aspect}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Projects dialog ─────────────────────────────────────────────────── */}
      {projectsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Video projects"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setProjectsOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">
                Video projects <span className="text-foreground-faint">({projects.length}/{MAX_PROJECTS})</span>
              </h3>
              <button
                type="button"
                onClick={newProject}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"
              >
                <Plus className="h-3.5 w-3.5" />
                New project
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {projects.length === 0 && (
                <p className="px-1 py-3 text-center text-xs italic text-foreground-faint">
                  No saved projects yet — Save uploads your local media to IPFS so drafts survive
                  reloads.
                </p>
              )}
              {projects.map((p) => {
                const dur = p.clips.reduce((acc, c) => acc + (c.out - c.in), 0);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      p.id === currentProjectId ? "border-accent bg-accent-bg" : "border-border bg-surface"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{p.name}</p>
                      <p className="text-[10px] text-foreground-faint">
                        {fmt(dur)} · {p.clips.length} clip{p.clips.length === 1 ? "" : "s"} ·{" "}
                        {p.aspect} · {new Date(p.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => loadProject(p)}
                      className="rounded-md border border-accent-border bg-accent-bg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProject(p.id)}
                      aria-label={`Delete ${p.name}`}
                      className="rounded-md border border-danger/30 bg-danger/10 p-1 text-danger hover:bg-danger/20"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card inspector — edit every field of a trading-card overlay + overrides.
// ---------------------------------------------------------------------------

const CARD_ACCENTS = ["#a3e635", "#ff3344", "#22d3ee", "#facc15", "#b98cff", "#ffd86b"];
const CARD_HIDEABLE = ["eyebrow", "stats", "type"] as const;

function CardInspector({
  card,
  onChange,
  onReset,
  onRemove,
}: {
  card: CardData;
  onChange: (patch: Partial<CardData>) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const field = (label: string, value: string, key: keyof CardData, w = "w-28") => (
    <label className="flex items-center gap-1 text-foreground-muted">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<CardData>)}
        className={`${w} rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none`}
      />
    </label>
  );
  const isBounty = card.style === "bounty";
  return (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
      <span className="font-medium text-foreground">{isBounty ? "Bounty" : "Card"}</span>
      {isBounty ? (
        <>
          {field("title", card.title, "title", "w-56")}
          {field("reward", card.reward ?? "", "reward", "w-24")}
          {field("url", card.footerUrl ?? "", "footerUrl", "w-56")}
          <label className="flex items-center gap-1 text-foreground-muted">
            logo
            <select
              value={card.logo ?? BOUNTY_LOGO}
              onChange={(e) => onChange({ logo: e.target.value })}
              className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
            >
              {CARD_LOGOS.map((l) => (
                <option key={l.label} value={l.src}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          {field("@", card.skater, "skater", "w-24")}
          {field("title", card.title, "title", "w-48")}
          {field("type", card.type, "type", "w-20")}
          {field("▲", card.upvotes, "upvotes", "w-14")}
          {field("time", card.runtime, "runtime", "w-14")}
        </>
      )}
      <span className="flex items-center gap-1">
        accent
        {CARD_ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange({ accent: c })}
            aria-label={`accent ${c}`}
            style={{ backgroundColor: c }}
            className={`h-4 w-4 rounded-full border ${
              card.accent === c ? "border-accent ring-1 ring-accent" : "border-border"
            }`}
          />
        ))}
      </span>
      <label className="flex items-center gap-1 text-foreground-muted">
        type size
        <input
          type="range"
          min={0.7}
          max={1.4}
          step={0.05}
          value={card.fontScale}
          onChange={(e) => onChange({ fontScale: Number(e.target.value) })}
        />
      </label>
      <span className="flex items-center gap-1.5 text-foreground-faint">
        hide:
        {CARD_HIDEABLE.map((k) => {
          const on = card.hidden.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() =>
                onChange({
                  hidden: on ? card.hidden.filter((x) => x !== k) : [...card.hidden, k],
                })
              }
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                on ? "bg-danger/15 text-danger line-through" : "bg-surface-elevated text-foreground-muted"
              }`}
            >
              {k}
            </button>
          );
        })}
      </span>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-border px-2 py-1 text-foreground-muted hover:border-border-strong hover:text-foreground"
      >
        reset
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger hover:bg-danger/20"
      >
        <Trash2 className="h-3 w-3" />
        remove
      </button>
    </div>
  );
}
