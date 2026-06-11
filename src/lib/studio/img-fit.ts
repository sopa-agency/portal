// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { CARD_W, CARD_H } from "./tokens";

// Enquadramento da imagem de fundo (modelo "Fill" do Figma, na proporção REAL da foto).
//  - a imagem é dimensionada p/ cobrir o frame 1080×1350 no scale 1, preservando sua proporção natural
//    (lado mais curto encosta no frame, o mais longo transborda);
//  - `scale` ≥ 1 aproxima; (x, y) reposiciona em px de design;
//  - pan é fixado p/ a imagem SEMPRE cobrir o frame → arrastar revela as partes reais que transbordam
//    (não o fundo), exatamente como reposicionar um image-fill no Figma.
// Box-math pura (left/top/width/height) → o Satori renderiza idêntico ao preview.
export type ImgFit = { x: number; y: number; scale: number };
export type ImgNat = { w: number; h: number } | null;

export const DEFAULT_FIT: ImgFit = { x: 0, y: 0, scale: 1 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// tamanho (px de design) da imagem em "cover" no scale 1, preservando a proporção natural.
// nat null/inválido → cai p/ a proporção do card (objectFit cover faz o recorte; comportamento antigo).
function baseCover(nat: ImgNat): { bw: number; bh: number } {
  if (!nat || nat.w <= 0 || nat.h <= 0) return { bw: CARD_W, bh: CARD_H };
  const s = Math.max(CARD_W / nat.w, CARD_H / nat.h);
  return { bw: nat.w * s, bh: nat.h * s };
}

// geometria do frame p/ um dado fit + dimensões naturais:
//  c*  = deslocamento de centralização; pm* = pan máx (= meia-transbordância) p/ manter cobertura total
function frame(fit: ImgFit, nat: ImgNat) {
  const scale = clamp(fit.scale, MIN_SCALE, MAX_SCALE);
  const { bw, bh } = baseCover(nat);
  const w = bw * scale;
  const h = bh * scale;
  return {
    w, h,
    cx: (w - CARD_W) / 2,
    cy: (h - CARD_H) / 2,
    pmx: Math.max(0, (w - CARD_W) / 2),
    pmy: Math.max(0, (h - CARD_H) / 2),
  };
}

// normaliza um fit: clamp de scale + pan dentro da cobertura (recentra o eixo sem transbordância)
export function clampFit(fit: ImgFit, nat: ImgNat): ImgFit {
  const scale = clamp(fit.scale, MIN_SCALE, MAX_SCALE);
  const { pmx, pmy } = frame({ ...fit, scale }, nat);
  return { scale, x: clamp(fit.x, -pmx, pmx), y: clamp(fit.y, -pmy, pmy) };
}

// caixa renderizada da imagem (px de design) p/ o <img> absoluto dentro do card
export function imgBox(fit: ImgFit, nat: ImgNat): { left: number; top: number; w: number; h: number } {
  const { w, h, cx, cy, pmx, pmy } = frame(fit, nat);
  const x = clamp(fit.x, -pmx, pmx);
  const y = clamp(fit.y, -pmy, pmy);
  return { left: Math.round(-cx + x), top: Math.round(-cy + y), w: Math.round(w), h: Math.round(h) };
}

// zoom mantendo o ponto (cx, cy) — px de design relativos ao topo-esquerda do card — sob o cursor
export function zoomAt(fit: ImgFit, nextScale: number, cx: number, cy: number, nat: ImgNat): ImgFit {
  const s0 = clamp(fit.scale, MIN_SCALE, MAX_SCALE);
  const s1 = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (s1 === s0) return fit;
  const { bw, bh } = baseCover(nat);
  // posição atual do canto sup-esq da imagem (sem clamp, p/ a conta do cursor bater)
  const left0 = -(bw * s0 - CARD_W) / 2 + fit.x;
  const top0 = -(bh * s0 - CARD_H) / 2 + fit.y;
  // mantém o ponto de conteúdo sob o cursor: cx - left1 = (s1/s0)(cx - left0)
  const left1 = cx - (s1 / s0) * (cx - left0);
  const top1 = cy - (s1 / s0) * (cy - top0);
  return clampFit({
    scale: s1,
    x: left1 + (bw * s1 - CARD_W) / 2,
    y: top1 + (bh * s1 - CARD_H) / 2,
  }, nat);
}
