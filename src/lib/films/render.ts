// O renderizador: fundo em dolly contínuo, abertura com títulos em cascata,
// a ação da cena (film.draw) e a assinatura em crossfade com o logo e a URL.
// Prévia e exportação chamam a mesma função. Adaptado do renderFeature.ts do
// swaps.pro; o que era da marca deles virou `brand`.

import { painter, paletteFor } from "./draw";
import { out, smooth } from "./take";
import { captionOf, type FeatureFilm, type FilmAssets, type FilmBrand } from "./types";

export function renderFilm(canvas: HTMLCanvasElement, film: FeatureFilm, seconds: number, assets: FilmAssets, brand: FilmBrand) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;
  const c = paletteFor(brand.accent);
  const wide = canvas.width > canvas.height;
  // Coordenadas lógicas: 1280 de largura no 16:9, 720 nos formatos em pé.
  const w = wide ? 1280 : 720;
  const h = (canvas.height * w) / canvas.width;
  const t = seconds;
  const bodyIn = smooth((t - 0.5) / 1.1);
  const closing = smooth((t - film.seconds + 1.8) / 0.7);
  ctx.setTransform(canvas.width / w, 0, 0, canvas.width / w, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const p = painter(ctx, c, t, assets);

  // Fundo: luz da cor do projeto, partículas determinísticas, órbitas lentas.
  p.glow(w * 0.68, h * 0.5, w * 0.64, c.accent + "22");
  p.glow(w * 0.15, h * 0.18, w * 0.46, "#ffffff08");
  for (let i = 0; i < 85; i++) {
    const depth = 0.3 + (i % 9) / 9;
    const px = ((i * 157.37 + t * 9 * depth) % (w + 120)) - 60;
    const py = ((((i * 97.71 - t * 13 * depth) % (h + 120)) + h + 120) % (h + 120)) - 60;
    p.circle(px, py, 0.5 + depth, `rgba(255,255,255,${0.05 + depth * 0.12})`);
  }
  ctx.save();
  ctx.translate(w * 0.55, h * 0.58);
  ctx.rotate(-0.4 + t * 0.035);
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 270 + i * 85, 95 + i * 48, 0, 0, Math.PI * 2);
    ctx.strokeStyle = c.accent + "12";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // Chrome do filme: logo + nome no topo, rótulo da cena à direita.
  ctx.save();
  ctx.globalAlpha = 1 - closing;
  const hasLogo = p.image("logo", 40, 26, 44, 44);
  p.text(brand.name.toUpperCase(), hasLogo ? 96 : 40, 57, 22, c.text, 800);
  p.text(film.label.toUpperCase(), w - 44, 55, 12, c.muted, 650, "right");

  // Abertura: duas linhas de título, subtítulo, legenda do passo.
  const titleY = wide ? 224 : h > 1000 ? 240 : 157;
  const headSize = wide ? 59 : 52;
  const titleW = wide ? 560 : w - 88;
  p.fade(0, 0.75, () => p.fit(film.headline[0], 44, titleY, headSize, titleW));
  p.fade(0.18, 0.8, () => p.fit(film.headline[1], 44, titleY + 66, headSize, titleW, c.accent));
  p.fade(0.45, 0.75, () => p.text(film.subtitle, 44, titleY + 109, 16, c.muted, 500));
  if (wide) {
    p.line(44, titleY + 144, 345, titleY + 144, c.accent + "30");
    p.text(captionOf(film, t).toUpperCase(), 44, titleY + 181, 12, c.accent, 600);
    p.text(brand.site, 44, 650, 24, c.text, 600);
  }

  // Ação: centrada, com escala por formato, entrando com bodyIn.
  const cx = wide ? 946 : 360;
  // No 9:16 a ação desce um pouco, para não deixar o terço de baixo vazio.
  const cy = wide ? 345 : titleY + (h > 1000 ? 470 : 395);
  const scale = wide ? 0.96 : 0.94;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= bodyIn;
  film.draw(p, t, assets);
  ctx.restore();
  if (!wide) p.text(brand.site, w / 2, Math.min(h - 46, cy + 305), 23, c.text, 600, "center");
  ctx.restore();

  // Assinatura: logo grande, nome, URL da página.
  if (closing > 0) {
    ctx.save();
    ctx.globalAlpha = closing;
    ctx.translate(w / 2, h / 2);
    p.glow(0, 0, wide ? 500 : 390, c.accent + "30");
    const logoSize = wide ? 150 : 130;
    const rise = (1 - out(Math.max(0, t - film.seconds + 1.8) / 1.2)) * 12;
    const drew = p.image("logo", -logoSize / 2, -logoSize - 10 + rise, logoSize, logoSize);
    p.text(brand.name.toUpperCase(), 0, drew ? 52 : 10, wide ? 64 : 54, c.text, 800, "center");
    const url = film.url;
    ctx.font = `650 14px ${"-apple-system, sans-serif"}`;
    const width = p.measure(url, 14, 650) + 32;
    p.rect(-width / 2, (drew ? 84 : 42), width, 34, c.surface + "ee", 17, c.accent + "40");
    p.text(url, 0, (drew ? 84 : 42) + 22, 14, c.accent, 650, "center");
    ctx.restore();
  }
}
