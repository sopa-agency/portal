// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import { CARD_W, CARD_H, COLORS, DEF, FONT_TITLE, FONT_DISPLAY, FONT_GROTESK } from "@/lib/studio/tokens";
import { elPos as pos } from "@/lib/studio/layout";
import { imgBox } from "@/lib/studio/img-fit";
import type { Card } from "@/lib/studio/schema";

export type Assets = { seloReel: string; seloPreco: string; barcode: string };

// Caixa de texto (pill). Usa flex + inline-style (subset suportado pelo Satori).
function Pill(props: {
  el?: string; x: number; y: number; w: number; text: string; fontSize: number;
  bg: string; color: string; border: number; radius: number; font?: string; padY?: number;
  weight?: 400 | 700; lineHeight?: number;
}) {
  const { el, x, y, w, text, fontSize, bg, color, border, radius, font = FONT_DISPLAY, padY = 16, weight = 700, lineHeight = 1.33 } = props;
  return (
    <div
      data-el={el}
      style={{
        position: "absolute", left: x, top: y, width: w, display: "flex", boxSizing: "border-box",
        padding: `${padY}px 18px`, backgroundColor: bg, border: `${border}px solid #000`, borderRadius: radius,
      }}
    >
      <div style={{ width: "100%", textAlign: "center", fontFamily: font, fontWeight: weight, fontSize, color, lineHeight }}>
        {text || " "}
      </div>
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
      ) : (
        <>
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
          {card.blocos.map((b) => (
            <div
              key={b.id}
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
          ))}
        </>
      )}
    </div>
  );
}

function CapaLayer({ card, assets }: { card: Extract<Card, { tipo: "capa" }>; assets: Assets }) {
  // editáveis (arrastáveis no editor → têm data-el)
  const tp = pos(card, "titulo");
  // grupo "Fixo" (Figma 27:532): chrome estático, posições travadas no DEF, SEM data-el (não editável)
  const kk = DEF.kicker, sr = DEF.seloReel, sp = DEF.seloPreco, bp = DEF.barcode;
  return (
    <>
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
              {/* sombra dura: cópia preta deslocada p/ baixo-esquerda */}
              <div style={{ ...titleBase, ...stroke, position: "absolute", left: -14, top: 18, color: "#000" }}>
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

      {/* caption (caixa vinho, texto branco) — Figma usa TOOM Regular, não bold */}
      <Pill el="hook" {...pos(card, "hook")} text={card.subtitulo} fontSize={32} bg={COLORS.wine} color="#f5f5f5" border={7} radius={0} padY={18} weight={400} lineHeight={1.0} />

      {/* ===== grupo Fixo (chrome estático, não editável) ===== */}
      {/* kicker */}
      <div style={{ position: "absolute", left: kk.x, top: kk.y, width: kk.w, height: 81, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: COLORS.wine, border: "6px solid #000" }}>
        <div style={{ fontFamily: FONT_GROTESK, fontSize: 32, fontWeight: 400, color: "#000" }}>UM ‘FLIP’ NA PERSPECTIVA</div>
      </div>

      {/* linha divisória vertical na barra do topo (Figma 27:527) */}
      <div style={{ position: "absolute", left: 151, top: 0, width: 6, height: 81, backgroundColor: "#000" }} />

      {/* selos reais */}
      <img src={assets.seloReel} width={sr.w} height={sr.h} style={{ position: "absolute", left: sr.x, top: sr.y }} />
      <img src={assets.seloPreco} width={sp.w} height={sp.h} style={{ position: "absolute", left: sp.x, top: sp.y }} />

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
