// Roteiro em dados: uma cena descrita em JSON (camadas com posição, tempo de
// entrada/saída e tipo) que o interpretador desenha com as mesmas primitivas
// das cenas em código. É o formato que a IA do portal escreve ("Gerar cena")
// e reescreve ("Remixar"), e que se edita inteiro na página. Validado com zod
// antes de ir para o banco ou para o canvas.

import { z } from "zod";
import type { Painter } from "./draw";
import { caretOn, clickAt, countUp, cursorAt, out, smooth, spring, typed } from "./take";
import type { AssetSource, FeatureFilm, FilmAssets } from "./types";

const coord = z.number().min(-420).max(420);
const size = z.number().min(0).max(900);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const named = z.enum(["text", "muted", "dim", "accent", "surface", "surface2", "border", "onAccent"]);
const color = z.union([named, hex]);
const align = z.enum(["left", "center", "right"]);
const timing = {
  /** Segundo em que a camada aparece (antes disso não existe). */
  in: z.number().min(0).max(30).optional(),
  /** Segundo em que a camada some. */
  out: z.number().min(0).max(30).optional(),
  /** Como entra: fade (padrão), rise (sobe 14 px), spring (cresce), none. */
  enter: z.enum(["fade", "rise", "spring", "none"]).optional(),
};
const base = z.object(timing);

const layerSchema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("card"), x: coord, y: coord, w: size, h: size, radius: size.optional() }),
  base.extend({ type: z.literal("rect"), x: coord, y: coord, w: size, h: size, fill: color.optional(), radius: size.optional(), stroke: color.optional() }),
  base.extend({ type: z.literal("row"), x: coord, y: coord, w: size, h: size, active: z.boolean().optional(), activeFrom: z.number().optional() }),
  base.extend({ type: z.literal("text"), value: z.string().max(200), x: coord, y: coord, size: size.optional(), color: color.optional(), weight: z.number().min(300).max(900).optional(), align: align.optional(), maxWidth: size.optional() }),
  base.extend({ type: z.literal("pill"), label: z.string().max(40), x: coord, y: coord, active: z.boolean().optional() }),
  base.extend({ type: z.literal("button"), label: z.string().max(40), x: coord, y: coord, w: size, h: size, enabled: z.boolean().optional(), ghost: z.boolean().optional(), press: z.number().optional() }),
  base.extend({ type: z.literal("input"), x: coord, y: coord, w: size, h: size, placeholder: z.string().max(60).optional(), typed: z.string().max(60).optional(), typeFrom: z.number().optional(), typeTo: z.number().optional(), size: size.optional(), align: align.optional() }),
  base.extend({ type: z.literal("image"), asset: z.string().max(40), x: coord, y: coord, w: size, h: size, fit: z.enum(["contain", "cover"]).optional(), radius: size.optional(), kenBurns: z.boolean().optional(), anchor: z.enum(["top", "center"]).optional() }),
  base.extend({ type: z.literal("polaroid"), asset: z.string().max(40), x: coord, y: coord, w: size, h: size, angle: z.number().min(-0.5).max(0.5).optional(), caption: z.string().max(40).optional() }),
  base.extend({ type: z.literal("coin"), asset: z.string().max(40), x: coord, y: coord, r: size, label: z.string().max(30).optional(), tint: hex.optional() }),
  base.extend({ type: z.literal("stat"), value: z.union([z.number(), z.string().max(30)]), label: z.string().max(30), x: coord, y: coord, size: size.optional(), color: color.optional(), countFrom: z.number().optional(), align: align.optional() }),
  base.extend({ type: z.literal("progress"), x: coord, y: coord, w: size, value: z.number().min(0).max(1), from: z.number().optional(), height: size.optional() }),
  base.extend({ type: z.literal("check"), x: coord, y: coord, size: size.optional() }),
  base.extend({ type: z.literal("avatar"), x: coord, y: coord, r: size, initials: z.string().max(2), hue: z.number().min(0).max(360).optional() }),
  base.extend({ type: z.literal("sparkline"), values: z.array(z.number().min(0).max(1)).min(2).max(40), x: coord, y: coord, w: size, h: size, from: z.number().optional() }),
  base.extend({ type: z.literal("streak"), x: coord, y: coord, x2: coord, y2: coord, delay: z.number().optional() }),
  base.extend({ type: z.literal("timer"), from: z.number().min(0).max(36000), x: coord, y: coord, size: size.optional(), color: color.optional(), align: align.optional() }),
  base.extend({ type: z.literal("cursor"), path: z.array(z.object({ at: z.number(), x: coord, y: coord })).min(1).max(20), clicks: z.array(z.number()).max(10).optional(), show: z.number().optional(), hide: z.number().optional() }),
  base.extend({ type: z.literal("burst"), at: z.number(), x: coord, y: coord, n: z.number().min(4).max(40).optional() }),
  base.extend({ type: z.literal("scene3d"), asset: z.string().max(40), x: coord, y: coord, w: size, h: size, spin: z.number().optional(), zoom: z.number().min(0.3).max(3).optional() }),
]);

export const FilmSpecSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  label: z.string().min(1).max(40),
  url: z.string().min(3).max(80),
  seconds: z.number().min(6).max(20),
  headline: z.tuple([z.string().max(60), z.string().max(60)]),
  subtitle: z.string().max(120),
  captions: z.array(z.string().max(60)).min(1).max(6),
  /** A legenda i passa a valer a partir de captionTimes[i-1]; a 0 vale desde o início. */
  captionTimes: z.array(z.number().min(0)).max(5).optional(),
  tweet: z.string().max(400),
  exampleValues: z.boolean().optional(),
  assets: z.record(z.string().regex(/^[a-z0-9_-]{1,30}$/i), z.string().regex(/^(public:\/|drive:|data:)/).max(300)).optional(),
  layers: z.array(layerSchema).min(1).max(80),
});

export type FilmSpec = z.infer<typeof FilmSpecSchema>;
export type FilmLayer = z.infer<typeof layerSchema>;

/** Resultado de validar um JSON vindo da IA ou do editor. */
export function parseSpec(raw: unknown): { ok: true; spec: FilmSpec } | { ok: false; error: string } {
  const r = FilmSpecSchema.safeParse(raw);
  if (r.success) return { ok: true, spec: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue?.path.join(".") || "spec"}: ${issue?.message ?? "invalid"}` };
}

/** Pega o primeiro objeto JSON de um texto (a IA às vezes embrulha em prosa ou cerca). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in the response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const colorOf = (p: Painter, c?: string) => {
  if (!c) return p.c.text;
  switch (c) {
    case "text": return p.c.text;
    case "muted": return p.c.muted;
    case "dim": return p.c.dim;
    case "accent": return p.c.accent;
    case "surface": return p.c.surface;
    case "surface2": return p.c.surface2;
    case "border": return p.c.border;
    case "onAccent": return p.c.onAccent;
    default: return c;
  }
};
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function drawLayer(p: Painter, t: number, l: FilmLayer) {
  switch (l.type) {
    case "card": return p.card(l.x, l.y, l.w, l.h, { radius: l.radius });
    case "rect": return p.rect(l.x, l.y, l.w, l.h, colorOf(p, l.fill ?? "surface2"), l.radius ?? 12, l.stroke ? colorOf(p, l.stroke) : undefined);
    case "row": return p.row(l.x, l.y, l.w, l.h, { active: l.active || (l.activeFrom !== undefined && t >= l.activeFrom) });
    case "text": {
      if (l.maxWidth) return void p.wrap(l.value, l.x, l.y, l.size ?? 14, l.maxWidth, colorOf(p, l.color ?? "muted"), l.weight ?? 500);
      return p.text(l.value, l.x, l.y, l.size ?? 16, colorOf(p, l.color), l.weight ?? 700, l.align ?? "left");
    }
    case "pill": return void p.pill(l.x, l.y, l.label, { active: l.active });
    case "button": return p.button(l.x, l.y, l.w, l.h, l.label, { enabled: l.enabled, ghost: l.ghost, pressed: l.press !== undefined ? clickAt(t, [l.press]) : 1 });
    case "input": {
      const value = l.typed && l.typeFrom !== undefined ? typed(l.typed, t, l.typeFrom, l.typeTo ?? l.typeFrom + 1) : l.typed ?? "";
      const typing = l.typeFrom !== undefined && t >= l.typeFrom && t < (l.typeTo ?? l.typeFrom + 1) + 0.6;
      return p.input(l.x, l.y, l.w, l.h, value, l.placeholder ?? "", { focused: typing, caret: typing && caretOn(t), size: l.size, align: l.align });
    }
    case "image": {
      if (l.fit === "contain") {
        p.ctx.save();
        p.ctx.beginPath();
        p.ctx.roundRect(l.x, l.y, l.w, l.h, l.radius ?? 12);
        p.ctx.clip();
        if (!p.image(l.asset, l.x, l.y, l.w, l.h)) p.rect(l.x, l.y, l.w, l.h, p.c.surface2, 0);
        p.ctx.restore();
        return;
      }
      const kb = l.kenBurns ? { zoom: 1 + t * 0.008, dy: -t * 2 } : {};
      if (!p.imageCover(l.asset, l.x, l.y, l.w, l.h, l.radius ?? 12, { ...kb, anchor: l.anchor })) p.rect(l.x, l.y, l.w, l.h, p.c.surface2, l.radius ?? 12);
      return;
    }
    case "polaroid": return p.polaroid(l.asset, l.x, l.y, l.w, l.h, l.angle ?? 0, l.caption);
    case "coin": return p.coin(l.asset, l.x, l.y, l.r, l.label, l.tint);
    case "stat": {
      const value = typeof l.value === "number" ? String(countUp(t, l.countFrom ?? l.in ?? 0, l.value, 1.4)) : l.value;
      return p.stat(l.x, l.y, value, l.label, { size: l.size, color: l.color ? colorOf(p, l.color) : undefined, align: l.align });
    }
    case "progress": return p.progress(l.x, l.y, l.w, l.value * (l.from !== undefined ? out((t - l.from) / 1.4) : 1), { height: l.height });
    case "check": return p.check(l.x, l.y, l.size ?? 8);
    case "avatar": return p.avatar(l.x, l.y, l.r, l.initials, l.hue ?? 0);
    case "sparkline": return p.sparkline(l.values, l.x, l.y, l.w, l.h, l.from !== undefined ? (t - l.from) / 2.4 : 1);
    case "streak": return p.streak(l.x, l.y, l.x2, l.y2, l.delay ?? 0);
    case "timer": return p.text(mmss(Math.max(0, l.from - Math.floor(t))), l.x, l.y, l.size ?? 28, colorOf(p, l.color), 800, l.align ?? "left");
    case "cursor": return p.cursor(cursorAt(t, l.path, l.clicks ?? [], l.show ?? 0.4, l.hide ?? Infinity));
    case "burst": {
      const life = (t - l.at) / 1.1;
      if (life <= 0 || life >= 1) return;
      const n = l.n ?? 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3, speed = 90 + ((i * 37) % 60);
        p.ctx.save();
        p.ctx.globalAlpha *= 1 - life;
        p.ctx.translate(l.x + Math.cos(a) * speed * out(life), l.y + Math.sin(a) * speed * out(life) + life * life * 90);
        p.ctx.rotate(life * 6 + i);
        p.rect(-4, -4, 8, 8, i % 3 === 0 ? "#f5f4f2" : p.c.accent, 1);
        p.ctx.restore();
      }
      return;
    }
    case "scene3d": {
      if (!p.scene3d(l.asset, l.x, l.y, l.w, l.h, { spin: l.spin, zoom: l.zoom })) p.rect(l.x, l.y, l.w, l.h, p.c.surface2 + "60", 16);
      return;
    }
  }
}

/** Desenha a cena em dados no instante t (a ação, centrada em 0,0). */
export function drawSpec(p: Painter, t: number, spec: FilmSpec) {
  for (const l of spec.layers) {
    const start = l.in ?? 0;
    if (t < start) continue;
    if (l.out !== undefined && t >= l.out) continue;
    const enter = l.enter ?? "fade";
    const k = enter === "none" ? 1 : enter === "spring" ? spring((t - start) / 0.9) : smooth((t - start) / 0.45);
    if (k <= 0) continue;
    p.ctx.save();
    if (enter !== "none") p.ctx.globalAlpha *= Math.min(1, k);
    if (enter === "rise") p.ctx.translate(0, (1 - k) * 14);
    if (enter === "spring") {
      const cx = "x" in l ? l.x + ("w" in l ? l.w / 2 : 0) : 0;
      const cy = "y" in l ? l.y + ("h" in l ? l.h / 2 : 0) : 0;
      p.ctx.translate(cx, cy);
      p.ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
      p.ctx.translate(-cx, -cy);
    }
    drawLayer(p, t, l);
    p.ctx.restore();
  }
}

/** Converte a cena em dados numa FeatureFilm que o motor desenha como as outras. */
export function specToFilm(spec: FilmSpec, extra: { tweetDoc?: string; prepare?: FeatureFilm["prepare"] } = {}): FeatureFilm {
  const times = spec.captionTimes ?? [];
  return {
    id: spec.id,
    label: spec.label,
    url: spec.url,
    tweetDoc: extra.tweetDoc,
    seconds: spec.seconds,
    headline: spec.headline,
    subtitle: spec.subtitle,
    steps: [spec.captions[0] ?? "", spec.captions[1] ?? spec.captions[0] ?? "", spec.captions[2] ?? spec.captions[spec.captions.length - 1] ?? ""],
    captions: spec.captions,
    captionAt: times.length ? (t) => times.filter((x) => t >= x).length : undefined,
    tweet: spec.tweet,
    exampleValues: spec.exampleValues,
    assets: spec.assets as Record<string, AssetSource> | undefined,
    prepare: extra.prepare,
    draw: (p: Painter, t: number, _assets: FilmAssets) => drawSpec(p, t, spec),
  };
}

/** Uma cena de exemplo, pequena, que também serve de modelo no prompt da IA. */
export const EXAMPLE_SPEC: FilmSpec = {
  version: 1,
  id: "proposal-vote",
  label: "Proposals",
  url: "gnars.com/proposals",
  seconds: 10,
  headline: ["Every trip started", "as a proposal."],
  subtitle: "Onchain funding on Base",
  captions: ["Open a proposal", "See the vote", "Cast yours"],
  captionTimes: [3, 6.5],
  tweet: "Every trip, rail and video part Gnars has funded started as a proposal. https://gnars.com/proposals",
  exampleValues: true,
  assets: { photo: "public:/projects/gnars/films/rails/minas-gerais.jpg" },
  layers: [
    { type: "card", x: -250, y: -240, w: 500, h: 480 },
    { type: "image", asset: "photo", x: -250, y: -240, w: 500, h: 150, radius: 26, fit: "cover", kenBurns: true },
    { type: "pill", label: "PROP 131 · ACTIVE", x: -222, y: -70, active: true, in: 0.6, enter: "rise" },
    { type: "text", value: "NogglesRail in Medellín", x: -222, y: -10, size: 24, weight: 800, in: 0.8, enter: "rise" },
    { type: "text", value: "Requesting 1.2 ETH · by pharra.eth", x: -222, y: 16, size: 13, color: "muted", weight: 500, in: 1 },
    { type: "text", value: "FOR", x: -222, y: 60, size: 11, color: "muted", weight: 650, in: 3 },
    { type: "progress", x: -222, y: 70, w: 444, value: 0.78, from: 3, height: 10, in: 3 },
    { type: "text", value: "834 votes · ends in 2 days", x: -222, y: 106, size: 13, color: "muted", weight: 500, in: 3.2 },
    { type: "button", label: "For", x: -222, y: 176, w: 214, h: 52, press: 6.5, in: 1.4, out: 7 },
    { type: "button", label: "Against", x: 8, y: 176, w: 214, h: 52, ghost: true, in: 1.4, out: 7 },
    { type: "rect", x: -222, y: 176, w: 444, h: 52, fill: "accent", radius: 26, in: 7 },
    { type: "text", value: "Voted for", x: 0, y: 208, size: 16, color: "onAccent", align: "center", in: 7 },
    { type: "burst", at: 7.05, x: -110, y: 200 },
    { type: "cursor", path: [{ at: 0.6, x: 230, y: 230 }, { at: 3, x: 0, y: 40 }, { at: 6, x: -115, y: 200 }, { at: 6.5, x: -115, y: 200 }, { at: 8, x: 240, y: 250 }], clicks: [6.5], hide: 8 },
  ],
};

/** O que a IA precisa saber para escrever uma cena válida. */
export const SPEC_GUIDE = `A scene is a JSON object (version 1) with: id (slug), label, url (page shown, e.g. "gnars.com/auctions"), seconds (6-20), headline (2 short lines; line 2 is the punch), subtitle, captions (1-6 short stage captions) + captionTimes (when each caption after the first starts), tweet (the post caption, with line breaks), exampleValues (true when any number on screen is an example), assets (id -> "public:/path" from the asset list you are given) and layers.

The film engine draws the opening (logo, headline, subtitle, caption) and the closing (logo + url) by itself. Your layers are ONLY the action: an interface card with one scripted interaction, centred at (0,0) in a box from x=-280..280 and y=-260..260 (the card is usually { "type":"card", "x":-250, "y":-240, "w":500, "h":480 }). Text baseline y; sizes 11-30. Time is in seconds; "in" is when a layer appears, "out" when it disappears, "enter" is fade | rise | spring | none. Tell one story: the cursor moves (cursor.path keyframes), clicks (cursor.clicks and button.press at the same second), the input types (input.typed between typeFrom and typeTo), the state changes (old layers get "out", new layers get "in"), something celebrates (burst). Keep it to 12-30 layers. Never use real-looking measured numbers: amounts are examples. Only use asset ids from the given list; unknown assets are skipped.

Layer types and fields:
- card {x,y,w,h,radius?} — the surface. rect {x,y,w,h,fill?,radius?,stroke?} fill/stroke: text|muted|dim|accent|surface|surface2|border|onAccent|#rrggbb. row {x,y,w,h,active?,activeFrom?} — list row.
- text {value,x,y,size?,color?,weight?,align?,maxWidth?} (maxWidth wraps into a paragraph). pill {label,x,y,active?}. button {label,x,y,w,h,enabled?,ghost?,press?}. input {x,y,w,h,placeholder?,typed?,typeFrom?,typeTo?,size?,align?}.
- image {asset,x,y,w,h,fit:"contain"|"cover",radius?,kenBurns?,anchor?} (use contain for logos/artwork, cover for photos). polaroid {asset,x,y,w,h,angle?,caption?}. coin {asset,x,y,r,label?,tint?} (a token/logo medallion).
- stat {value(number counts up),label,x,y,size?,color?,countFrom?,align?}. progress {x,y,w,value 0-1,from?,height?}. check {x,y,size?}. avatar {x,y,r,initials,hue?}. sparkline {values[0-1],x,y,w,h,from?}. streak {x,y,x2,y2,delay?} (light running along a line). timer {from(seconds),x,y,size?,color?,align?} (counts down mm:ss).
- cursor {path:[{at,x,y}],clicks?:[seconds],show?,hide?}. burst {at,x,y,n?} (confetti). scene3d {asset,x,y,w,h,spin?,zoom?} (only when a 3D asset is listed).`;
