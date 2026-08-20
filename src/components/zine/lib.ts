// Zine Studio — shared types, constants and pure helpers (no React/JSX).
// Extracted from zine-studio.tsx so the editor and its sub-components can share
// them without circular imports.

export type ElKind = "image" | "text";

export type Element = {
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
  rotation?: number; // degrees, around the element's center
};

export type Page = { id: string; bg: string; elements: Element[] };
export type Draft = { id: string; name: string; savedAt: number; pageSize: PageSizeId; pages: Page[] };

// Every studio/brand font (all registered as @font-face in globals.css) plus
// readable system stacks. Empty value = inherit the page's default sans.
export const ZINE_FONTS: { label: string; value: string }[] = [
  { label: "Sans (padrão)", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', ui-monospace, monospace" },
  { label: "Joystix — SkateHive", value: "Joystix" },
  { label: "Ken Pixel — Gnars", value: "'Ken Pixel'" },
  { label: "Bazinga — Reelflip", value: "Bazinga" },
  { label: "TOOM — Reelflip", value: "TOOM" },
  { label: "MADE GoodTime", value: "'MADE GoodTime Grotesk'" },
];

// Fine grid step in % of the page (40 cols/rows). Center + edges fall on it.
export const GRID = 2.5;
// Smart-snap threshold (% of page) for Canva-style alignment to edges/centers.
export const SNAP_TH = 1.1;

// Zine formats. "loose" = one page per sheet. "mini8" = the 8-page mini-zine.
export const PAGE_SIZES = [
  { id: "A6", label: "A6 (página solta)", css: "A6 portrait", kind: "loose" },
  { id: "A5", label: "A5 (página solta)", css: "A5 portrait", kind: "loose" },
  { id: "A4", label: "A4 (página solta)", css: "A4 portrait", kind: "loose" },
  { id: "mini8", label: "Mini-zine 8p · 1 folha A4", css: "A4 landscape", kind: "mini8" },
] as const;
export type PageSizeId = (typeof PAGE_SIZES)[number]["id"];

// Mini-zine imposition: cell index (row-major, 4 cols × 2 rows) → 1-based page.
// Per the chosen fold method: top row 8,1,2,3 · bottom row 7,6,5,4 · no rotation.
export const MINI8_ORDER = [8, 1, 2, 3, 7, 6, 5, 4] as const;
export const MINI8_PAGES = 8;

// Label for a 1-based mini-zine page (cover / back cover / plain number).
export function miniPageLabel(n: number): string | null {
  if (n === 1) return "Capa";
  if (n === MINI8_PAGES) return "Contracapa";
  return null;
}

// Hue (deg) of a hex color — used to tint the duotone filter with the brand accent.
export function hexHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 90;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// Overall print filters (apply to every page). 3 B&W looks + a brand-accent
// duotone, done purely with CSS filters so screen + print + export all match.
export function buildFilters(accent: string): { id: string; label: string; css: string }[] {
  const hr = Math.round(hexHue(accent) - 40); // sepia output sits ~40° → rotate to the accent
  return [
    { id: "color", label: "Cor", css: "" },
    { id: "bw", label: "P&B", css: "grayscale(1)" },
    { id: "bwhc", label: "P&B contraste", css: "grayscale(1) contrast(1.65) brightness(1.05)" },
    { id: "xerox", label: "P&B xerox", css: "grayscale(1) contrast(4.5) brightness(1.25)" },
    { id: "duo", label: "P&B + 1 cor", css: `grayscale(1) sepia(1) saturate(4.5) hue-rotate(${hr}deg) contrast(1.1)` },
  ];
}

export function uid() {
  return `${Date.now().toString(36)}${Math.floor(performance.now()).toString(36)}${(globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0).toString(36)}`;
}

export function blankPage(): Page {
  return { id: uid(), bg: "#ffffff", elements: [] };
}

// --- Defensive restore --------------------------------------------------------
// localStorage may hold autosaves/drafts from an OLDER schema (e.g. a page whose
// `elements` isn't an array). Coerce unknown JSON into valid Page[]/Draft[],
// dropping anything malformed, so a stale draft never crashes the editor with
// "x.map is not a function".
function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

export function sanitizeElement(raw: unknown): Element | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  return {
    id: typeof e.id === "string" && e.id ? e.id : uid(),
    kind: e.kind === "text" ? "text" : "image",
    x: num(e.x, 10),
    y: num(e.y, 10),
    w: num(e.w, 60),
    h: num(e.h, 40),
    z: num(e.z, 0),
    ...(typeof e.src === "string" ? { src: e.src } : {}),
    ...(e.fit === "contain" || e.fit === "cover" ? { fit: e.fit } : {}),
    ...(typeof e.text === "string" ? { text: e.text } : {}),
    ...(typeof e.fontSize === "number" ? { fontSize: e.fontSize } : {}),
    ...(typeof e.color === "string" ? { color: e.color } : {}),
    ...(e.align === "left" || e.align === "center" || e.align === "right" ? { align: e.align } : {}),
    ...(typeof e.bold === "boolean" ? { bold: e.bold } : {}),
    ...(typeof e.font === "string" ? { font: e.font } : {}),
    ...(typeof e.rotation === "number" ? { rotation: e.rotation } : {}),
  };
}

export function sanitizePages(raw: unknown): Page[] | null {
  if (!Array.isArray(raw)) return null;
  const pages: Page[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const pg = p as Record<string, unknown>;
    const elements = Array.isArray(pg.elements)
      ? pg.elements.map(sanitizeElement).filter((x): x is Element => x !== null)
      : [];
    pages.push({
      id: typeof pg.id === "string" && pg.id ? pg.id : uid(),
      bg: typeof pg.bg === "string" ? pg.bg : "#ffffff",
      elements,
    });
  }
  return pages.length ? pages : null;
}

export function sanitizeDrafts(raw: unknown): Draft[] {
  if (!Array.isArray(raw)) return [];
  const out: Draft[] = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const dr = d as Record<string, unknown>;
    const pages = sanitizePages(dr.pages);
    if (!pages) continue;
    out.push({
      id: typeof dr.id === "string" && dr.id ? dr.id : uid(),
      name: typeof dr.name === "string" ? dr.name : "Zine",
      savedAt: typeof dr.savedAt === "number" ? dr.savedAt : 0,
      pageSize: (typeof dr.pageSize === "string" ? dr.pageSize : "A5") as PageSizeId,
      pages,
    });
  }
  return out;
}
