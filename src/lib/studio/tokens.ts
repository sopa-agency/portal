// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
// Tokens FIXOS do template Reelflip (compartilhados entre preview no browser e render Satori no server).
export const CARD_W = 1080;
export const CARD_H = 1350;

export const COLORS = {
  cream: "#fff6db",
  yellow: "#fccc44",
  wine: "#af3f4c",
  ink: "#1f1f1f",
  blue: "#225393",
  gray: "#d9d9d9",
} as const;

// Fontes da marca (mapa confirmado no Figma):
//  Bazinga       -> título gigante da capa
//  TOOM          -> corpo dos cards (subtítulos, hooks, blocos); peso 700 = TOOM Bold-Italic
//  MADE GoodTime -> grotesk (kicker, barcode) — só tem peso Regular
export const FONT_TITLE = "Bazinga";
export const FONT_DISPLAY = "TOOM";
export const FONT_GROTESK = "MADE GoodTime Grotesk";

export type ElKey =
  | "subtitulo"
  | "titulo"
  | "hook"
  | "kicker"
  | "seloReel"
  | "seloPreco"
  | "barcode"
  // Spot card (SkateHive) — draggable template elements.
  | "spotBanner"
  | "spotInfo";

// Posições/tamanhos default (coords de design, 1080×1350). Override por card.layout[key].
export const DEF: Record<ElKey, { x: number; y: number; w?: number; h?: number; fontSize?: number }> = {
  subtitulo: { x: 0, y: 0, w: 560 },
  titulo: { x: 0, y: 237, w: CARD_W, fontSize: 240 },
  hook: { x: 160, y: 940, w: 560 },
  kicker: { x: 4, y: 0, w: 1069 },
  seloReel: { x: 898, y: 0, w: 138, h: 207 },
  seloPreco: { x: 6, y: 86, w: 97, h: 146 },
  barcode: { x: 10, y: 1208, w: 222 },
  // Spot card: banner top-left; info block (name/location/author) near bottom-left.
  spotBanner: { x: 48, y: 60, w: 520 },
  spotInfo: { x: 60, y: 1010, w: 960 },
};
