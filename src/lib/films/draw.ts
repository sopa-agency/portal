// Primitivas de desenho em Canvas 2D para as cenas. O ponto de partida são os
// helpers do renderFeature.ts/drawSwapUse.ts do swaps.pro; em cima deles, as
// peças de interface interpretada (card, row, input, pill, button, stat,
// cursor) que todos os projetos reaproveitam. Tudo é função de (ctx, t).

import type { FilmAssets, Scene3DView } from "./types";
import { clamp, smooth } from "./take";

export const FONT = '"Hanken Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  /** Texto por cima do accent (botões cheios). */
  onAccent: string;
};

/** Paleta escura neutra com a cor do projeto; hex de 6 dígitos + alpha em 2. */
export function paletteFor(accent: string): Palette {
  const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#d4ec4a";
  const r = parseInt(a.slice(1, 3), 16), g = parseInt(a.slice(3, 5), 16), b = parseInt(a.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return {
    bg: "#070708",
    surface: "#141316",
    surface2: "#1e1d21",
    border: "#ffffff14",
    text: "#f5f4f2",
    muted: "#a3a19c",
    dim: "#5c5a57",
    accent: a,
    onAccent: luminance > 0.55 ? "#111111" : "#ffffff",
  };
}

export type CursorState = { x: number; y: number; opacity: number; click: number };

export type Painter = ReturnType<typeof painter>;

export function painter(ctx: CanvasRenderingContext2D, c: Palette, t: number, assets: FilmAssets) {
  /** accent com alpha: `a("40")`. */
  const a = (alpha: string) => c.accent + alpha;

  function text(value: string, x: number, y: number, size: number, color = c.text, weight = 700, align: CanvasTextAlign = "left") {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  }
  function measure(value: string, size: number, weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(value).width;
  }
  /** Texto que encolhe até caber em `max`. */
  function fit(value: string, x: number, y: number, size: number, max: number, color = c.text, weight = 800, align: CanvasTextAlign = "left") {
    const width = measure(value, size, weight);
    text(value, x, y, Math.min(size, (size * max) / Math.max(1, width)), color, weight, align);
  }
  /** Parágrafo com quebra de linha por largura; devolve a altura usada. */
  function wrap(value: string, x: number, y: number, size: number, maxWidth: number, color = c.muted, weight = 500, lineHeight = size * 1.35, maxLines = 4) {
    const words = value.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size, weight) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) lines.push(current);
    lines.slice(0, maxLines).forEach((l, i) => text(l, x, y + i * lineHeight, size, color, weight));
    return Math.min(lines.length, maxLines) * lineHeight;
  }
  function rect(x: number, y: number, width: number, height: number, fill: string | CanvasGradient, radius = 16, stroke?: string) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function line(x: number, y: number, x2: number, y2: number, color = c.border, width = 1) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function circle(x: number, y: number, radius: number, color: string) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, radius), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function ring(x: number, y: number, radius: number, start = 0, length = Math.PI * 2, color = a("30"), thickness = 1) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.1, radius), start, start + length);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }
  function glow(x: number, y: number, radius: number, color: string) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    light.addColorStop(0, color);
    light.addColorStop(1, "#00000000");
    ctx.fillStyle = light;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const img = (id: string): HTMLImageElement | null => {
    const asset = assets[id];
    return asset && "naturalWidth" in asset && asset.naturalWidth ? asset : null;
  };
  /** Imagem por id; um asset que não carregou simplesmente não aparece. */
  function image(id: string, x: number, y: number, width: number, height = width) {
    const asset = img(id);
    if (!asset) return false;
    const scale = Math.min(width / asset.naturalWidth, height / asset.naturalHeight);
    const iw = asset.naturalWidth * scale, ih = asset.naturalHeight * scale;
    ctx.drawImage(asset, x + (width - iw) / 2, y + (height - ih) / 2, iw, ih);
    return true;
  }
  /**
   * Imagem recortada num retângulo arredondado (cover). `zoom`/`dx`/`dy` dão
   * o movimento lento de câmera (Ken Burns); `anchor` alinha o corte.
   */
  function imageCover(id: string, x: number, y: number, width: number, height: number, radius = 12, opts: { zoom?: number; dx?: number; dy?: number; anchor?: "top" | "center" } = {}) {
    const asset = img(id);
    if (!asset) return false;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.clip();
    const scale = Math.max(width / asset.naturalWidth, height / asset.naturalHeight) * (opts.zoom ?? 1);
    const iw = asset.naturalWidth * scale, ih = asset.naturalHeight * scale;
    const top = opts.anchor === "top" ? y : y + (height - ih) / 2;
    ctx.drawImage(asset, x + (width - iw) / 2 + (opts.dx ?? 0), top + (opts.dy ?? 0), iw, ih);
    ctx.restore();
    return true;
  }
  /** Cena three.js desenhada no frame t; falso quando não foi preparada. */
  function scene3d(id: string, x: number, y: number, width: number, height: number, view?: Scene3DView) {
    const asset = assets[id];
    if (!asset || !("kind" in asset) || asset.kind !== "3d") return false;
    ctx.drawImage(asset.frame(t, width, height, view), x, y, width, height);
    return true;
  }
  /** Foto tipo polaroid, inclinada, com moldura clara e sombra. */
  function polaroid(id: string, x: number, y: number, width: number, height: number, angle = 0, caption?: string) {
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(angle);
    ctx.shadowColor = "#000000a0";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    rect(-width / 2, -height / 2, width, height + 26, "#f3efe6", 6);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    if (!imageCover(id, -width / 2 + 8, -height / 2 + 8, width - 16, height - 16, 3)) rect(-width / 2 + 8, -height / 2 + 8, width - 16, height - 16, "#1a1a1a", 3);
    if (caption) text(caption, 0, height / 2 + 14, 11, "#3a3630", 650, "center");
    ctx.restore();
  }
  /** Luz correndo ao longo de uma linha (rastro), como nos filmes do swaps.pro. */
  function streak(x: number, y: number, x2: number, y2: number, delay = 0, color = c.accent) {
    line(x, y, x2, y2, color + "20", 1.5);
    const p = (Math.max(0, t - delay) * 0.42) % 1, tail = Math.max(0, p - 0.18);
    const g = ctx.createLinearGradient(x + (x2 - x) * tail, y + (y2 - y) * tail, x + (x2 - x) * p + 0.01, y + (y2 - y) * p + 0.01);
    g.addColorStop(0, color + "00");
    g.addColorStop(1, color);
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + (x2 - x) * tail, y + (y2 - y) * tail);
    ctx.lineTo(x + (x2 - x) * p, y + (y2 - y) * p);
    ctx.stroke();
    glow(x + (x2 - x) * p, y + (y2 - y) * p, 13, color + "88");
  }
  /** Moeda/tile biselado com o logo dentro, rótulo embaixo. */
  function coin(id: string, x: number, y: number, radius: number, label?: string, tint = c.accent) {
    ctx.save();
    glow(x, y, radius * 1.8, tint + "16");
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    circle(x, y, radius, "#141316");
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const fill = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    fill.addColorStop(0, "#3a383d");
    fill.addColorStop(0.3, "#1c1b1f");
    fill.addColorStop(1, "#0a0a0c");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ring(x, y, radius, 0, Math.PI * 2, tint + "55", 1.5);
    ring(x, y, radius - 5, -2.6, 1.7, "#ffffff40", 2);
    if (!image(id, x - radius * 0.62, y - radius * 0.62, radius * 1.24)) text(id.toUpperCase().slice(0, 3), x, y + radius * 0.3, radius * 0.7, c.text, 800, "center");
    if (label) text(label, x, y + radius + 28, 15, c.text, 650, "center");
    ctx.restore();
  }
  /** Linha de tendência suave (valores 0..1) com brilho no último ponto. */
  function sparkline(values: number[], x: number, y: number, width: number, height: number, progress = 1, color = c.accent) {
    const n = Math.max(2, Math.floor(values.length * clamp(progress)));
    ctx.save();
    ctx.beginPath();
    values.slice(0, n).forEach((v, i) => {
      const px = x + (i / (values.length - 1)) * width, py = y + height - v * height;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    const lx = x + ((n - 1) / (values.length - 1)) * width, ly = y + height - values[n - 1] * height;
    glow(lx, ly, 14, color + "80");
    circle(lx, ly, 3.5, color);
    ctx.restore();
  }
  /** Escurece as bordas do frame inteiro (chamado pelo renderizador). */
  function vignette(width: number, height: number, strength = 0.55) {
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
    g.addColorStop(0, "#00000000");
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // ── Interface interpretada ────────────────────────────────────────────────
  function card(x: number, y: number, width: number, height: number, opts: { radius?: number; fill?: string; stroke?: string; shadow?: boolean } = {}) {
    ctx.save();
    if (opts.shadow !== false) {
      ctx.shadowColor = "#00000090";
      ctx.shadowBlur = 48;
      ctx.shadowOffsetY = 20;
    }
    rect(x, y, width, height, opts.fill ?? c.surface + "f5", opts.radius ?? 26, opts.stroke ?? a("38"));
    ctx.restore();
  }
  function row(x: number, y: number, width: number, height: number, opts: { active?: boolean; fill?: string } = {}) {
    rect(x, y, width, height, opts.fill ?? (opts.active ? c.surface2 : c.surface + "cc"), 14, opts.active ? a("55") : c.border);
  }
  function input(x: number, y: number, width: number, height: number, value: string, placeholder: string, opts: { focused?: boolean; caret?: boolean; size?: number; align?: CanvasTextAlign } = {}) {
    rect(x, y, width, height, "#0c0c0e", 14, opts.focused ? a("70") : c.border);
    const size = opts.size ?? 18;
    const align = opts.align ?? "left";
    const tx = align === "right" ? x + width - 16 : x + 16;
    text(value || placeholder, tx, y + height / 2 + size * 0.36, size, value ? c.text : c.dim, 600, align);
    if (opts.focused && opts.caret) {
      const w = value ? measure(value, size, 600) : 0;
      const cx = align === "right" ? tx + 2 : tx + w + 2;
      line(cx, y + height / 2 - size * 0.55, cx, y + height / 2 + size * 0.5, c.accent, 2);
    }
  }
  /** Chip; devolve a largura desenhada. */
  function pill(x: number, y: number, label: string, opts: { active?: boolean; size?: number; height?: number } = {}) {
    const size = opts.size ?? 12;
    const height = opts.height ?? 28;
    const width = measure(label, size, 650) + 24;
    rect(x, y, width, height, opts.active ? a("28") : c.surface2, height / 2, opts.active ? a("70") : c.border);
    text(label, x + width / 2, y + height / 2 + size * 0.36, size, opts.active ? c.accent : c.muted, 650, "center");
    return width;
  }
  function button(x: number, y: number, width: number, height: number, label: string, opts: { enabled?: boolean; pressed?: number; ghost?: boolean; size?: number } = {}) {
    const enabled = opts.enabled !== false;
    const press = opts.pressed ?? 1;
    ctx.save();
    if (press < 1) {
      const s = 1 - Math.sin(press * Math.PI) * 0.04;
      ctx.translate(x + width / 2, y + height / 2);
      ctx.scale(s, s);
      ctx.translate(-(x + width / 2), -(y + height / 2));
    }
    if (opts.ghost) rect(x, y, width, height, c.surface2, height / 2, a("55"));
    else rect(x, y, width, height, enabled ? c.accent : c.surface2, height / 2);
    text(label, x + width / 2, y + height / 2 + (opts.size ?? 15) * 0.36, opts.size ?? 15, opts.ghost ? c.accent : enabled ? c.onAccent : c.dim, 700, "center");
    ctx.restore();
  }
  function stat(x: number, y: number, value: string, label: string, opts: { color?: string; size?: number; align?: CanvasTextAlign } = {}) {
    const align = opts.align ?? "left";
    text(value, x, y, opts.size ?? 40, opts.color ?? c.text, 800, align);
    text(label.toUpperCase(), x, y + 24, 11, c.muted, 650, align);
  }
  function check(x: number, y: number, size = 10, color = c.accent) {
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - size * 0.3, y + size * 0.65);
    ctx.lineTo(x + size, y - size * 0.65);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  function spinner(x: number, y: number, r = 10) {
    ctx.beginPath();
    ctx.arc(x, y, r, t * 4, t * 4 + Math.PI * 1.45);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  function progress(x: number, y: number, width: number, value: number, opts: { height?: number; color?: string } = {}) {
    const h = opts.height ?? 8;
    rect(x, y, width, h, c.surface2, h / 2);
    if (value > 0) rect(x, y, Math.max(h, width * clamp(value)), h, opts.color ?? c.accent, h / 2);
  }
  function avatar(x: number, y: number, r: number, initials: string, hue = 0) {
    circle(x, y, r, `hsl(${hue} 30% 22%)`);
    ring(x, y, r, 0, Math.PI * 2, a("50"));
    text(initials, x, y + r * 0.36, r * 0.9, c.text, 700, "center");
  }
  /** Ícone ⌐◨-◨ simplificado (dois quadrados + ponte), a assinatura da Gnars/Nouns. */
  function noggles(x: number, y: number, size: number, color = c.accent) {
    const s = size / 6;
    rect(x, y, s * 2.4, s * 2, color, s * 0.2);
    rect(x + s * 3.2, y, s * 2.4, s * 2, color, s * 0.2);
    rect(x + s * 2.4, y + s * 0.7, s * 0.8, s * 0.6, color, 0);
    rect(x - s * 0.9, y + s * 0.7, s * 0.9, s * 0.6, color, 0);
    rect(x + s * 0.5, y + s * 0.4, s * 0.9, s * 1.2, "#ffffff", 0);
    rect(x + s * 3.7, y + s * 0.4, s * 0.9, s * 1.2, "#ffffff", 0);
    rect(x + s * 1.4, y + s * 0.4, s * 0.8, s * 1.2, "#111111", 0);
    rect(x + s * 4.6, y + s * 0.4, s * 0.8, s * 1.2, "#111111", 0);
  }
  function cursor(s: CursorState) {
    if (s.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha *= s.opacity;
    ctx.translate(s.x, s.y);
    if (s.click < 1) {
      ctx.save();
      ctx.globalAlpha *= 1 - s.click;
      ctx.beginPath();
      ctx.arc(0, 0, 7 + s.click * 24, 0, Math.PI * 2);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    const press = 1 - Math.sin(s.click * Math.PI) * 0.1;
    ctx.scale(press, press);
    ctx.shadowColor = "#00000090";
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(1, 26); ctx.lineTo(8, 19); ctx.lineTo(14, 31); ctx.lineTo(19, 28); ctx.lineTo(13, 16); ctx.lineTo(23, 15);
    ctx.closePath();
    ctx.fillStyle = "#f7f7f5";
    ctx.fill();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  /** Desenha com alpha que sobe de `from` por `duration` s. */
  function fade(from: number, duration: number, draw: () => void) {
    const p = smooth((t - from) / duration);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha *= p;
    draw();
    ctx.restore();
  }
  /** Cascata: o item `index` entra em `from + index*gap`, subindo 14 px enquanto aparece. */
  function reveal(index: number, from: number, gap: number, draw: () => void, duration = 0.45) {
    const p = smooth((t - from - index * gap) / duration);
    if (p <= 0) return;
    ctx.save();
    ctx.globalAlpha *= p;
    ctx.translate(0, (1 - p) * 14);
    draw();
    ctx.restore();
  }

  return { ctx, t, c, a, text, measure, fit, wrap, rect, line, circle, ring, glow, image, imageCover, scene3d, polaroid, streak, coin, sparkline, vignette, card, row, input, pill, button, stat, check, spinner, progress, avatar, noggles, cursor, fade, reveal };
}
