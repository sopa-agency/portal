// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import type { Carousel, Card } from "./schema";

// Contador determinístico (não randomUUID): o seed gera os mesmos ids no server e no client,
// evitando mismatch de hidratação nos data-el="bloco:…". A unicidade entre sessões é garantida
// por bumpId() ao carregar docs externos (JSON/script salvos com ids mais altos que o contador).
let _uid = 1;
export const newId = () => "b" + _uid++;

// Avança o contador além de um id "b<N>" já existente → newId() nunca colide com ids carregados.
export function bumpId(id: string) {
  const m = /^b(\d+)$/.exec(id);
  if (m) _uid = Math.max(_uid, Number(m[1]) + 1);
}

// Normaliza um doc carregado (JSON/import): reserva os ids existentes e preenche os que faltam
// (cards de JSONs antigos sem id). Idempotente.
export function normalizeDoc(doc: Carousel): Carousel {
  for (const c of doc.cards) {
    bumpId(c.id);
    for (const b of c.blocos) bumpId(b.id);
  }
  return { ...doc, cards: doc.cards.map((c) => (c.id ? c : { ...c, id: newId() })) };
}

// Parser do formato de roteiro:
//   ### [ SLIDE N — CAPA/CTA ]
//   **TÍTULO:** / **SUBTÍTULO:** / **TEXTO:**
//   ## LEGENDA
const LABELS = "(?:T[ÍI]TULO|SUBT[ÍI]TULO|TEXTO)";

export function parseScript(raw: string): Carousel {
  const txt = raw.replace(/\r\n/g, "\n");
  const seg = txt.split(/^##\s*LEGENDA\s*$/m);
  const body = seg[0];
  const legenda = seg[1] ? seg[1].replace(/^[\s-]+/, "").trim() : "";
  const parts = body.split(/^###\s*\[([^\]]*)\]\s*$/m);

  const field = (content: string, label: string) => {
    const re = new RegExp(
      "\\*\\*" + label + ":\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*" + LABELS + "\\s*:|\\n\\s*---|$)",
      "i",
    );
    const m = content.match(re);
    return m ? m[1].trim().replace(/\n+/g, " ").trim() : "";
  };

  const cards: Card[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i] || "";
    const content = parts[i + 1] || "";
    const titulo = field(content, "T[ÍI]TULO");
    const subtitulo = field(content, "SUBT[ÍI]TULO");
    const texto = field(content, "TEXTO");

    if (/CAPA/i.test(header)) {
      cards.push({
        tipo: "capa",
        id: newId(),
        imagem: null,
        imgFit: { x: 0, y: 0, scale: 1 },
        imgW: null,
        imgH: null,
        layout: {},
        titulo: titulo || subtitulo || "TÍTULO",
        subtitulo,
        blocos: [],
      });
    } else {
      cards.push({
        tipo: "conteudo",
        id: newId(),
        imagem: null,
        imgFit: { x: 0, y: 0, scale: 1 },
        imgW: null,
        imgH: null,
        layout: {},
        subtitulo,
        blocos: texto ? [{ id: newId(), texto, x: 90, y: 880, w: 900, fontSize: 30 }] : [],
      });
    }
  }

  return { meta: { handle: "reelflip", local: "São Paulo, Brasil", legenda }, cards };
}
