// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { CARD_W, CARD_H, COLORS, DEF, FONT_TITLE, FONT_DISPLAY, FONT_GROTESK } from "@/lib/studio/tokens";
import { elPos as pos } from "@/lib/studio/layout";
import { imgBox } from "@/lib/studio/img-fit";
import type { Card } from "@/lib/studio/schema";

// Capa: todo o chrome fixo do topo (barra azul + REELFLIP + kicker + quadrinho + selo) é um único
// PNG transparente (capaHeader) — texto Chalets vem renderizado do Figma, então não precisa da fonte.
export type Assets = { capaHeader: string; barcode: string };

// Subtítulo (rich): *palavra* vira amarelo (Figma usa "MEMÓRIA"). Satori não faz texto
// inline-colorido com quebra de linha; o jeito Satori-safe é 1 item flex por palavra +
// flexWrap, com as palavras marcadas pintadas de amarelo.
function splitWords(text: string): { w: string; hot: boolean }[] {
  const out: { w: string; hot: boolean }[] = [];
  for (const seg of (text || "").split(/(\*[^*]+\*)/g)) {
    if (!seg) continue;
    const hot = seg.length > 2 && seg.startsWith("*") && seg.endsWith("*");
    for (const w of (hot ? seg.slice(1, -1) : seg).split(/\s+/)) if (w) out.push({ w, hot });
  }
  return out;
}

// Caixa de texto (pill). Usa flex + inline-style (subset suportado pelo Satori).
// rich=true → layout por palavras (flexWrap) com destaque *amarelo*; senão, texto simples.
function Pill(props: {
  el?: string; x: number; y: number; w: number; text: string; fontSize: number;
  bg: string; color: string; border: number; radius: number; font?: string; padY?: number;
  weight?: 400 | 700; lineHeight?: number; rich?: boolean;
}) {
  const { el, x, y, w, text, fontSize, bg, color, border, radius, font = FONT_DISPLAY, padY = 16, weight = 700, lineHeight = 1.33, rich } = props;
  return (
    <div
      data-el={el}
      style={{
        position: "absolute", left: x, top: y, width: w, display: "flex", boxSizing: "border-box",
        padding: `${padY}px 18px`, backgroundColor: bg, border: `${border}px solid #000`, borderRadius: radius,
      }}
    >
      {rich ? (
        <div style={{ width: "100%", display: "flex", flexWrap: "wrap", justifyContent: "center", alignContent: "center", columnGap: Math.round(fontSize * 0.28), rowGap: Math.round(fontSize * 0.2), fontFamily: font, fontWeight: weight, fontSize, color, lineHeight }}>
          {splitWords(text).map((t, i) => (
            <div key={i} style={{ display: "flex", color: t.hot ? COLORS.yellow : color }}>{t.w}</div>
          ))}
        </div>
      ) : (
        <div style={{ width: "100%", textAlign: "center", fontFamily: font, fontWeight: weight, fontSize, color, lineHeight }}>
          {text || " "}
        </div>
      )}
    </div>
  );
}

export function CardArtwork({ card, assets }: { card: Card; assets: Assets }) {
  const bg = card.tipo === "fundo" ? card.bgColor || "#ffffff" : COLORS.gray;
  const photo = card.tipo !== "fundo" ? card.imagem : null;
  // dimensões naturais da foto (p/ enquadrar na proporção real); null → cover na proporção do card
  const nat = card.tipo !== "fundo" && card.imgW && card.imgH ? { w: card.imgW, h: card.imgH } : null;
  const box = imgBox(card.imgFit, nat); // enquadramento (pan/zoom) — idêntico no preview e no Satori

  return (
    <div
      style={{
        position: "relative", width: CARD_W, height: CARD_H, display: "flex", overflow: "hidden",
        backgroundColor: bg, fontFamily: FONT_DISPLAY,
      }}
    >
      {photo ? (
        <img
          src={photo}
          width={box.w}
          height={box.h}
          // maxWidth:none anula o preflight do Tailwind (img{max-width:100%}) que clampava
          // a imagem à largura do card e quebrava o enquadramento (preview ≠ Satori/export).
          style={{ position: "absolute", left: box.left, top: box.top, width: box.w, height: box.h, maxWidth: "none", maxHeight: "none", objectFit: "cover" }}
        />
      ) : null}

      {card.tipo === "capa" ? (
        <CapaLayer card={card} assets={assets} />
      ) : card.tipo === "spot" ? (
        <SpotLayer card={card} />
      ) : (
        <Pill
          el="subtitulo"
          {...pos(card, "subtitulo")}
          text={card.subtitulo}
          fontSize={24}
          bg={COLORS.cream}
          color={COLORS.ink}
          border={6}
          radius={0}
          padY={12}
        />
      )}

      {/* Free text blocks — addable/movable on EVERY card (incl. spot). */}
      {card.blocos.map((b) => (
        <BlocoBox key={b.id} b={b} />
      ))}
    </div>
  );
}

/** A free, draggable text block (data-el="bloco:<id>"). */
function BlocoBox({ b }: { b: Card["blocos"][number] }) {
  return (
    <div
      data-el={`bloco:${b.id}`}
      style={{
        position: "absolute", left: b.x, top: b.y, width: b.w, display: "flex", boxSizing: "border-box",
        padding: "16px 18px", backgroundColor: COLORS.yellow, border: "8px solid #000", borderRadius: 24,
      }}
    >
      <div style={{ width: "100%", textAlign: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: b.fontSize, color: "#000", lineHeight: 1.33 }}>
        {b.texto || " "}
      </div>
    </div>
  );
}

function CapaLayer({ card, assets }: { card: Extract<Card, { tipo: "capa" }>; assets: Assets }) {
  // editáveis (arrastáveis no editor → têm data-el)
  const tp = pos(card, "titulo");
  const bp = DEF.barcode;
  return (
    <>
      {/* chrome FIXO do topo (barra azul + REELFLIP + kicker + quadrinho + selo) pré-renderizado
          como PNG transparente (Chalets real do Figma) — antes do título p/ o título ficar por cima. */}
      <img src={assets.capaHeader} width={1080} height={322} style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 322 }} />

      {/* título: técnica do Figma (nós 1:323/1:324) — cópia PRETA deslocada (sombra dura)
          atrás de uma cópia AMARELA, ambas com contorno preto (stroke wt5 + drop shadow). */}
      {(() => {
        const titleBase = {
          width: "100%", textAlign: "center" as const, fontFamily: FONT_TITLE,
          fontSize: tp.fontSize ?? 240, lineHeight: 0.89, letterSpacing: -2.4,
        };
        const stroke = { WebkitTextStroke: "10px #000", paintOrder: "stroke" as const };
        return (
          <div data-el="titulo" style={{ position: "absolute", left: tp.x, top: tp.y, width: tp.w, display: "flex" }}>
            <div style={{ position: "relative", width: "100%", display: "flex" }}>
              {/* sombra dura: cópia AZUL deslocada p/ baixo-esquerda (Figma 119:544 — antes era preta) */}
              <div style={{ ...titleBase, ...stroke, position: "absolute", left: -14, top: 18, color: COLORS.blue }}>
                {card.titulo}
              </div>
              {/* fill amarelo com contorno preto */}
              <div style={{ ...titleBase, ...stroke, position: "relative", color: COLORS.yellow, textShadow: "0px 4px 6px rgba(0,0,0,0.35)" }}>
                {card.titulo}
              </div>
            </div>
          </div>
        );
      })()}

      {/* caption (caixa AZUL, texto branco) — Figma 119:539/543: TOOM Regular, *destaque* em amarelo */}
      <Pill el="hook" {...pos(card, "hook")} text={card.subtitulo} rich fontSize={32} bg={COLORS.blue} color="#f5f5f5" border={7} radius={0} padY={18} weight={400} lineHeight={1.0} />

      {/* código de barras (Figma 27:535): caixa branca + barras que transbordam + número fake */}
      {/* caixa branca de fundo (Figma 27:519): w=202, atrás das barras */}
      <div style={{ position: "absolute", left: 19, top: bp.y, width: 202, height: 100, backgroundColor: "#fff" }} />
      {/* barras (Figma 27:521): w=222, transbordam a caixa nas laterais.
          Asset já recortado p/ a faixa de barras uniformes (sem guard descenders) → stretch simples. */}
      <img src={assets.barcode} width={bp.w} height={74} style={{ position: "absolute", left: bp.x, top: 1214 }} />
      {/* número estilo código de barras (Figma 27:520): 10px, centrado, encostado nas barras */}
      <div style={{ position: "absolute", left: 22, top: 1288, width: 198, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_GROTESK, fontSize: 10, fontWeight: 400, color: "#000" }}>
        000000TÁCURIOSOCOMOQUÊ?000
      </div>
    </>
  );
}

// Portal addition: SkateHive "Skate Spot Found!" overlay. Brand colors (lime on
// black) are intentional and theme-independent — this renders to a flat PNG, not
// to themed UI. Satori-safe: flexbox + absolute + inline styles, brand fonts, no
// emoji (Satori has no emoji font loaded). Renders in both the live canvas and
// the server Satori export from the same component.
const SPOT_LIME = "#a3e635";
// SkateHive's brand display font (loaded in globals.css + Satori loadFonts).
const SPOT_DISPLAY_FONT = "Joystix";

// The spot name is rendered on ONE line that shrinks to fit. Letting it wrap made
// the live preview (browser) and the export (server Satori) break lines at
// different points — two layout engines wrap differently. A single no-wrap line
// sized deterministically here renders identically in both. Joystix is monospace,
// so width ≈ chars · fontSize · ADVANCE; ADVANCE is set slightly generous so the
// computed size never overflows the 960px box (CARD_W − 60·2).
const JOYSTIX_ADVANCE = 0.62;
function fitSpotNameSize(text: string, base = 78, min = 34, boxW = 960): number {
  const chars = Math.max(1, text.length);
  return Math.max(min, Math.min(base, Math.floor(boxW / (chars * JOYSTIX_ADVANCE))));
}
function SpotLayer({ card }: { card: Extract<Card, { tipo: "spot" }> }) {
  // Banner + info block are draggable template elements (data-el + layout override).
  const banner = pos(card, "spotBanner");
  const info = pos(card, "spotInfo");
  const infoW = info.w ?? 960;
  return (
    <>
      {/* bottom scrim so the text stays legible over any photo */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 720, display: "flex",
          backgroundImage:
            "linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.78) 30%, rgba(0,0,0,0.32) 62%, rgba(0,0,0,0) 100%)",
        }}
      />

      {/* top banner — Joystix (SkateHive's brand pixel font). Draggable. */}
      <div data-el="spotBanner" style={{ position: "absolute", left: banner.x, top: banner.y, display: "flex", transform: "rotate(-2.5deg)" }}>
        <div
          style={{
            display: "flex", alignItems: "center", backgroundColor: SPOT_LIME, color: "#0a0a0a",
            padding: "16px 28px", border: "5px solid #000", borderRadius: 6,
            fontFamily: SPOT_DISPLAY_FONT, fontSize: 38,
          }}
        >
          SKATE SPOT FOUND!
        </div>
      </div>

      {/* spot name + location + author — draggable/resizable group. */}
      <div data-el="spotInfo" style={{ position: "absolute", left: info.x, top: info.y, width: infoW, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex", whiteSpace: "nowrap", fontFamily: SPOT_DISPLAY_FONT,
            fontSize: fitSpotNameSize((card.spotName || "Spot sem nome").toUpperCase(), 78, 34, infoW),
            lineHeight: 1.1, color: "#ffffff", textShadow: "0px 4px 14px rgba(0,0,0,0.6)",
          }}
        >
          {(card.spotName || "Spot sem nome").toUpperCase()}
        </div>
        {card.spotLocation ? (
          <div style={{ display: "flex", alignItems: "center", marginTop: 26 }}>
            <div style={{ display: "flex", width: 26, height: 26, marginRight: 14, borderRadius: 999, border: `6px solid ${SPOT_LIME}` }} />
            <div style={{ display: "flex", fontFamily: "Inter", fontWeight: 700, fontSize: 44, color: SPOT_LIME }}>
              {card.spotLocation}
            </div>
          </div>
        ) : null}
        {card.spotAuthor ? (
          <div style={{ display: "flex", marginTop: 16, fontFamily: "Inter", fontWeight: 400, fontSize: 34, color: "rgba(255,255,255,0.82)" }}>
            found by @{card.spotAuthor}
          </div>
        ) : null}
      </div>
    </>
  );
}
