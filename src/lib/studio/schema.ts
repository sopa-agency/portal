// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { z } from "zod";

// ---- contrato (Zod = fonte da verdade) ----
export const ZBloco = z.object({
  id: z.string(),
  texto: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  fontSize: z.number().default(30),
});
export type Bloco = z.infer<typeof ZBloco>;

export const ZLayoutEntry = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  fontSize: z.number().optional(),
});
export const ZLayout = z.record(z.string(), ZLayoutEntry).default({});
export const ZImgFit = z
  .object({ x: z.number(), y: z.number(), scale: z.number() })
  .default({ x: 0, y: 0, scale: 1 });

const base = {
  // id estável por card → React key na lista (reordenar/apagar sem perder estado do filho).
  // default "" = doc externo sem id; normalizeDoc() preenche ao carregar.
  id: z.string().default(""),
  imgFit: ZImgFit,
  // dimensões naturais (px) da imagem de fundo — necessárias p/ enquadrar preservando a proporção real.
  // null = desconhecidas (fallback p/ cover na proporção do card). Preenchidas pelo editor ao carregar a img.
  imgW: z.number().nullable().default(null),
  imgH: z.number().nullable().default(null),
  layout: ZLayout,
  subtitulo: z.string().default(""),
  blocos: z.array(ZBloco).default([]),
};

export const ZCapa = z.object({
  tipo: z.literal("capa"),
  imagem: z.string().nullable().default(null),
  titulo: z.string().default("TÍTULO"),
  ...base,
});
export const ZConteudo = z.object({
  tipo: z.literal("conteudo"),
  imagem: z.string().nullable().default(null),
  ...base,
});
export const ZFundo = z.object({
  tipo: z.literal("fundo"),
  bgColor: z.string().default("#ffffff"),
  ...base,
});

// Portal addition (not in upstream reelflip-studio): the "Skate Spot Found!"
// template for the SkateHive brand — a spot photo + a fixed branded overlay
// (header banner, spot name, location, author), filled from the SkateHive spot
// map. Additive variant; reelflip cards (capa/conteudo/fundo) are unaffected.
export const ZSpot = z.object({
  tipo: z.literal("spot"),
  imagem: z.string().nullable().default(null),
  spotName: z.string().default(""),
  spotLocation: z.string().default(""),
  spotAuthor: z.string().default(""),
  ...base,
});

export const ZCard = z.discriminatedUnion("tipo", [ZCapa, ZConteudo, ZFundo, ZSpot]);
export type Card = z.infer<typeof ZCard>;
export type Capa = z.infer<typeof ZCapa>;
export type Conteudo = z.infer<typeof ZConteudo>;
export type Fundo = z.infer<typeof ZFundo>;
export type Spot = z.infer<typeof ZSpot>;

export const ZMeta = z
  .object({
    handle: z.string().default("reelflip"),
    local: z.string().default("São Paulo, Brasil"),
    legenda: z.string().default(""),
  })
  .default({ handle: "reelflip", local: "São Paulo, Brasil", legenda: "" });

export const ZCarousel = z.object({
  meta: ZMeta,
  cards: z.array(ZCard),
});
export type Carousel = z.infer<typeof ZCarousel>;
