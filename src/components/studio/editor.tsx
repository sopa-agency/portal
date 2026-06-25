// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import {
  Plus, Trash2, Download, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, RotateCcw, ArrowUp, ArrowDown, Image as ImageIcon, Loader2, Crop, Check,
  Heart, MessageCircle, Send, Bookmark, MoreVertical, Undo2, Redo2, Pipette, MapPin, Flame,
} from "lucide-react";

import { Button } from "@/components/studio/ui/button";
import { Textarea } from "@/components/studio/ui/textarea";
import { Input } from "@/components/studio/ui/input";
import { Label } from "@/components/studio/ui/label";
import { Separator } from "@/components/studio/ui/separator";
import { Slider } from "@/components/studio/ui/slider";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/studio/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/studio/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/studio/ui/select";

import { CardArtwork, spotMapsUrl, spotQrUrl, type Assets } from "@/components/studio/card-artwork";
import QRCode from "qrcode";
import { CARD_W, CARD_H, COLORS, type ElKey } from "@/lib/studio/tokens";
import { elPos, withLayout, resetLayout } from "@/lib/studio/layout";
import { type ImgFit, type ImgNat, DEFAULT_FIT, MIN_SCALE, MAX_SCALE, clampFit, zoomAt } from "@/lib/studio/img-fit";
import { newId, normalizeDoc, migrateSubtitle } from "@/lib/studio/parse-script";
import { SEED_DOC } from "@/lib/studio/seed";
import { ZCarousel, type Card, type Carousel, type BoxColor } from "@/lib/studio/schema";
import { listSkateSpots, getSkateSpot, type SkateSpot } from "@/app/actions/skate-spots";
import { uploadMediaDirectClient } from "@/lib/upload-media-client";

const STORAGE_KEY = "reelflip-studio:doc:v2";
const RENDER_CONCURRENCY = 2; // Satori+resvg are memory-heavy; 2 bounds peak RAM on Vercel (was 3 → OOM/500 on the first concurrent batch with big photos)
const THUMB_W = 36; // largura do thumbnail na lista de cards (px)

const CLIENT_ASSETS: Assets = {
  capaHeader: "/studio/assets/capa-header.png?v=1", // chrome fixo do topo da capa (Figma 119:540/547/549/550)
  barcode: "/studio/assets/barcode.png?v=3", // ?v= força refetch quando o asset muda (browser cacheia por URL)
};

const RESIZABLE = new Set<string>(["subtitulo", "hook", "titulo", "spotInfo"]); // + blocos
// elementos editáveis (arrastáveis). kicker/selos/barcode são chrome "Fixo" → renderizados sem data-el.

// paleta da marca p/ os swatches do card "fundo" (label, hex) — picker nativo fica como fallback.
const BRAND_SWATCHES: [string, string][] = [
  ["Creme", COLORS.cream],
  ["Amarelo", COLORS.yellow],
  ["Vinho", COLORS.wine],
  ["Tinta", COLORS.ink],
  ["Azul", COLORS.blue],
  ["Cinza", COLORS.gray],
  ["Branco", "#ffffff"],
];

// seletor creme/amarela compartilhado pelos cards de texto (sub-título + caixas).
function ColorPick({ value, onChange }: { value: BoxColor; onChange: (c: BoxColor) => void }) {
  const opts: [BoxColor, string, string][] = [
    ["creme", COLORS.cream, "Creme"],
    ["amarela", COLORS.yellow, "Amarela"],
  ];
  return (
    <div className="flex items-center gap-1">
      {opts.map(([key, hex, label]) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          aria-pressed={value === key}
          title={label}
          onClick={() => onChange(key)}
          className={`size-4 rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-selection ${value === key ? "ring-2 ring-foreground" : "ring-1 ring-border-strong"}`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}

function newCard(tipo: Card["tipo"]): Card {
  const base = { id: newId(), imgFit: { x: 0, y: 0, scale: 1 }, imgW: null, imgH: null, layout: {} as Record<string, never>, subtitulo: "" };
  if (tipo === "capa") return { tipo: "capa", imagem: null, titulo: "TÍTULO", ...base, subtitulo: "gancho da capa", blocos: [] };
  // subtitulo vira a 1ª caixa (creme) via migrateSubtitle → card já nasce com Caixa 1 (creme) + Caixa 2 (amarela).
  if (tipo === "fundo")
    return migrateSubtitle({ tipo: "fundo", bgColor: "#ffffff", ...base, subtitulo: "CONTEXTO…", blocos: [{ id: newId(), texto: "Texto de contexto / explicação.", x: 73, y: 740, w: 934, fontSize: 30 }] });
  if (tipo === "spot")
    return { tipo: "spot", imagem: null, spotName: "", spotLocation: "", spotAuthor: "", spotPermlink: "", spotDescription: "", ...base, blocos: [] };
  return migrateSubtitle({ tipo: "conteudo", imagem: null, ...base, subtitulo: "NOVA CHAMADA…", blocos: [{ id: newId(), texto: "Texto do card.", x: 90, y: 950, w: 900, fontSize: 30 }] });
}

// Seed doc for SkateHive spot mode: one blank "Skate Spot Found!" card.
function makeSpotSeed(): Carousel {
  return { meta: { handle: "skatehive", local: "", legenda: "" }, cards: [newCard("spot")] };
}

// Compose the post caption from a spot card so the post carries the spot's
// description + credit alongside the design. "" for non-spot docs.
function spotCaption(doc: Carousel): string {
  const spot = doc.cards.find(
    (c): c is Extract<Card, { tipo: "spot" }> => c.tipo === "spot" && (!!c.spotDescription?.trim() || !!c.spotName?.trim()),
  );
  if (!spot) return "";
  const parts: string[] = [];
  if (spot.spotDescription?.trim()) parts.push(spot.spotDescription.trim());
  const loc = [spot.spotName?.trim(), spot.spotLocation?.trim()].filter(Boolean).join(" — ");
  if (loc) parts.push(`📍 ${loc}`);
  if (spot.spotAuthor?.trim()) parts.push(`🛹 spot por @${spot.spotAuthor.trim()}`);
  return parts.join("\n\n");
}

// Studio começa LIMPO: 1 capa em branco (sem o roteiro-exemplo de 10 cards).
// meta da marca vem do SEED_DOC (handle/local), legenda zerada.
function makeBlankDoc(): Carousel {
  return { meta: { ...SEED_DOC.meta, legenda: "" }, cards: [newCard("capa")] };
}

type Rect = { x: number; y: number; w: number; h: number };

// Portal adaptation: optional hook — when set, a "Usar no post" CTA renders
// every card to PNG and hands the files + the doc's caption to the host
// (the Post Creator wizard). Standalone behavior is unchanged when absent.
export function Editor({
  onUseInPost,
  onDocChange,
  initialDoc,
  spotMode = false,
}: {
  onUseInPost?: (files: File[], caption: string, aspectHint?: number, doc?: Carousel) => Promise<void>;
  /** Persistência por draft: quando setado, o host gerencia o doc (sem localStorage).
   *  Chamado (debounced) a cada mudança p/ o host guardar junto do draft. */
  onDocChange?: (doc: Carousel) => void;
  /** Doc inicial vindo do draft carregado (JSON validado via Zod). Ausente = studio limpo. */
  initialDoc?: unknown;
  /** SkateHive "Skate Spot Found!" mode: seeds a spot card + spot-map picker
   *  instead of the default reelflip card template. */
  spotMode?: boolean;
} = {}) {
  const storageKey = spotMode ? "skatehive-spot-studio:doc:v1" : STORAGE_KEY;
  const filePrefix = spotMode ? "skatespot" : "reelflip";
  // managed = host (Post Creator) cuida da persistência via draft → ignora localStorage.
  const managed = !!onDocChange;
  const onDocChangeRef = useRef(onDocChange); onDocChangeRef.current = onDocChange;
  const [doc, setDoc] = useState<Carousel>(() => {
    if (spotMode) return makeSpotSeed();
    if (initialDoc) {
      const p = ZCarousel.safeParse(initialDoc);
      if (p.success && p.data.cards.length) return normalizeDoc(p.data);
    }
    return makeBlankDoc();
  });
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState(0.30);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [busy, setBusy] = useState<null | "one" | "zip">(null);
  const [framing, setFraming] = useState(false); // modo "enquadrar imagem" (pan/zoom do fundo)
  const [grabbing, setGrabbing] = useState(false); // feedback de cursor durante o pan da imagem
  // "Burn" preview: show the REAL rendered PNG (same Satori pipeline as the post)
  // so the preview matches the exported card exactly, not the browser DOM approx.
  const [burn, setBurn] = useState(false);
  const [burnUrl, setBurnUrl] = useState<string | null>(null);
  const [burnBusy, setBurnBusy] = useState(false);
  // SkateHive spot map picker (spotMode only)
  const [spotsOpen, setSpotsOpen] = useState(false);
  const [spots, setSpots] = useState<SkateSpot[] | null>(null);
  const [spotsErr, setSpotsErr] = useState<string | null>(null);
  const [spotsPage, setSpotsPage] = useState(1);
  const [spotsHasMore, setSpotsHasMore] = useState(false);
  const [spotsBusy, setSpotsBusy] = useState(false);

  const innerRef = useRef<HTMLDivElement>(null);
  const fileImg = useRef<HTMLInputElement>(null);
  const drag = useRef<null | { key: string; mode: "move" | "resize"; cardIdx: number; sx: number; sy: number; ox: number; oy: number; ow: number }>(null);
  const imgDrag = useRef<null | { sx: number; sy: number; ox: number; oy: number; cardIdx: number }>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const framingSnap = useRef<ImgFit | null>(null); // imgFit ao entrar no enquadramento → Esc reverte

  const card = doc.cards[active];

  // Spot card → live QR for the spot's skatehive.app page (the burn recomputes
  // it server-side). Falls back to the Maps link for legacy cards w/o a permlink.
  const spotLocation = card?.tipo === "spot" ? card.spotLocation : "";
  const spotAuthor = card?.tipo === "spot" ? card.spotAuthor : "";
  const spotPermlink = card?.tipo === "spot" ? card.spotPermlink : "";
  const [spotQr, setSpotQr] = useState("");
  useEffect(() => {
    const url = (spotAuthor && spotPermlink) ? spotQrUrl(spotAuthor, spotPermlink, spotLocation) : (spotLocation ? spotMapsUrl(spotLocation) : "");
    if (!url) { setSpotQr(""); return; }
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 300 })
      .then((d) => { if (live) setSpotQr(d); })
      .catch(() => { if (live) setSpotQr(""); });
    return () => { live = false; };
  }, [spotLocation, spotAuthor, spotPermlink]);

  // Burn preview: (re)render the active card to a real PNG, debounced, whenever
  // it changes while burn mode is on. The object URL is the exact post output.
  const cardHash = JSON.stringify(card);
  useEffect(() => {
    if (!burn) { setBurnUrl(null); return; }
    let alive = true;
    setBurnBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/studio/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const url = URL.createObjectURL(await res.blob());
        if (!alive) { URL.revokeObjectURL(url); return; }
        setBurnUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      } catch {
        if (alive) setBurnUrl(null);
      } finally {
        if (alive) setBurnBusy(false);
      }
    }, 500);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burn, cardHash]);

  // ---- updaters (imutáveis) ----
  const updateCard = useCallback((i: number, fn: (c: Card) => Card) => {
    setDoc((d) => ({ ...d, cards: d.cards.map((c, ci) => (ci === i ? fn(c) : c)) }));
  }, []);
  const patchActive = useCallback((fn: (c: Card) => Card) => updateCard(active, fn), [active, updateCard]);

  // Spot-level fields (name/location/author/description) belong to the SPOT, not
  // the card — editing them updates every card of the same spot (a multi-photo
  // carousel shares one spotPermlink). Falls back to the active card when there's
  // no permlink to group by (a manually-built spot card).
  const patchSpotGroup = useCallback(
    (patch: Partial<Extract<Card, { tipo: "spot" }>>) => {
      setDoc((d) => {
        const cur = d.cards[active];
        if (!cur || cur.tipo !== "spot") return d;
        const key = cur.spotPermlink?.trim();
        return {
          ...d,
          cards: d.cards.map((c) => {
            if (c.tipo !== "spot") return c;
            const sameSpot = key ? c.spotPermlink?.trim() === key : c === cur;
            return sameSpot ? ({ ...c, ...patch } as Card) : c;
          }),
        };
      });
    },
    [active],
  );

  const addCard = (tipo: Card["tipo"]) => {
    setDoc((d) => {
      const cards = [...d.cards];
      cards.splice(active + 1, 0, newCard(tipo));
      return { ...d, cards };
    });
    setActive((a) => a + 1);
    setSelected(null);
  };
  const delCard = (i: number) => {
    if (doc.cards.length === 1) return toast.error("Precisa de ao menos 1 card.");
    const lastIdx = doc.cards.length - 2; // índice máx. válido depois de remover 1
    setDoc((d) => ({ ...d, cards: d.cards.filter((_, ci) => ci !== i) }));
    setActive((a) => (i < a ? a - 1 : Math.min(a, lastIdx)));
    setSelected(null);
  };
  const moveCard = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= doc.cards.length) return;
    setDoc((d) => {
      const cards = [...d.cards];
      [cards[i], cards[j]] = [cards[j], cards[i]];
      return { ...d, cards };
    });
    setActive(j);
  };

  const setType = (tipo: Card["tipo"]) =>
    patchActive((c) => {
      const common = { id: c.id, imgFit: c.imgFit, imgW: c.imgW, imgH: c.imgH, layout: c.layout, subtitulo: c.subtitulo, blocos: c.blocos };
      if (tipo === "capa") return { tipo: "capa", imagem: ("imagem" in c ? c.imagem : null) ?? null, titulo: ("titulo" in c ? c.titulo : "") || "TÍTULO", ...common };
      // conteudo/fundo: migrateSubtitle converte um gancho herdado da capa na 1ª caixa (creme).
      if (tipo === "fundo") {
        const blocos = c.blocos.length ? c.blocos : [{ id: newId(), texto: "Texto de contexto / explicação.", x: 73, y: 740, w: 934, fontSize: 30 }];
        return migrateSubtitle({ tipo: "fundo", bgColor: ("bgColor" in c ? c.bgColor : "#ffffff") || "#ffffff", ...common, blocos });
      }
      return migrateSubtitle({ tipo: "conteudo", imagem: ("imagem" in c ? c.imagem : null) ?? null, ...common });
    });

  // Troca o data-URI de um card pela URL (Pinata) — só se a imagem atual ainda for o
  // data-URI (não clobbar uma troca mais nova). Mantém dims/enquadramento.
  const setCardImageUrl = (id: string, url: string) => {
    setDoc((d) => ({
      ...d,
      cards: d.cards.map((c) =>
        c.id === id && "imagem" in c && typeof c.imagem === "string" && c.imagem.startsWith("data:")
          ? ({ ...c, imagem: url } as Card)
          : c,
      ),
    }));
  };
  const onImage = (file: File) => {
    const targetId = doc.cards[active]?.id;
    const r = new FileReader();
    r.onload = () => {
      const src = r.result as string; // data-URI: preview instantâneo + medir dims
      const im = new window.Image();
      im.onload = () => patchActive((c) => ({ ...c, imagem: src, imgW: im.naturalWidth, imgH: im.naturalHeight, imgFit: DEFAULT_FIT }) as Card);
      im.onerror = () => patchActive((c) => ({ ...c, imagem: src, imgW: null, imgH: null, imgFit: DEFAULT_FIT }) as Card);
      im.src = src;
    };
    r.readAsDataURL(file);
    // sobe pro Pinata em paralelo e troca o data-URI pela URL → doc leve (não base64 no banco).
    // mantém o data-URI como fallback se o upload falhar.
    void uploadMediaDirectClient(file).then((up) => {
      if (!up.ok) {
        toast.warning("Imagem mantida localmente", { description: "Upload falhou — o card fica pesado até reenviar." });
        return;
      }
      if (targetId) setCardImageUrl(targetId, up.url);
    });
  };

  // ---- SkateHive spot map ----
  const loadSpots = useCallback(async (page: number) => {
    setSpotsBusy(true);
    setSpotsErr(null);
    const r = await listSkateSpots(page);
    if (r.ok) {
      setSpots((prev) => (page === 1 ? r.spots : [...(prev ?? []), ...r.spots]));
      setSpotsHasMore(r.hasMore);
      setSpotsPage(page);
    } else setSpotsErr(r.error);
    setSpotsBusy(false);
  }, []);
  const openSpots = () => {
    setSpotsOpen(true);
    if (!spots) void loadSpots(1);
  };
  // Fill the active card from a picked spot. A spot with multiple photos becomes
  // a CAROUSEL: one "Skate Spot Found!" card per photo (same name/location/author/
  // permlink), the first replacing the active card and the rest inserted after it.
  // Natural dims are measured per photo so framing/zoom works like an upload.
  const measureImg = (src: string) =>
    new Promise<{ w: number | null; h: number | null }>((res) => {
      const im = new window.Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: null, h: null });
      im.src = src;
    });
  const pickSpot = async (spot: SkateSpot) => {
    setSpotsOpen(false);
    const tid = toast.loading("Carregando spot…");
    // The list is light (cover only) — pull this permlink's full post now so a
    // multi-photo spot becomes the full carousel. Fall back to the lite data.
    let full = spot;
    const r = await getSkateSpot(spot.author, spot.permlink);
    if (r.ok) full = r.spot;
    toast.dismiss(tid);
    const photos = full.photos.length ? full.photos : full.photo ? [full.photo] : [];
    const fields = {
      tipo: "spot" as const,
      spotName: full.name, spotLocation: full.location, spotAuthor: full.author,
      spotPermlink: full.permlink, spotDescription: full.description,
    };
    if (photos.length === 0) {
      patchActive((c) => ({ ...c, ...fields, imagem: null, imgW: null, imgH: null, imgFit: DEFAULT_FIT }) as Card);
      return;
    }
    const dims = await Promise.all(photos.map(measureImg));
    setDoc((d) => {
      const cards = [...d.cards];
      const baseCard = cards[active];
      const deck = photos.map((photo, i) => {
        // First card keeps the active card's identity/layout; extras are fresh.
        const seed = i === 0 ? baseCard : newCard("spot");
        return { ...seed, ...fields, imagem: photo, imgW: dims[i].w, imgH: dims[i].h, imgFit: DEFAULT_FIT } as Card;
      });
      cards.splice(active, 1, ...deck);
      return { ...d, cards };
    });
    if (photos.length > 1) toast.success(`Carrossel criado · ${photos.length} fotos do spot`);
  };

  const addBloco = () =>
    patchActive((c) => ({ ...c, blocos: [...c.blocos, { id: newId(), texto: "Novo texto.", x: 120, y: 300, w: 840, fontSize: 30 }] }));
  const updateBloco = (id: string, patch: Partial<Card["blocos"][number]>) =>
    patchActive((c) => ({ ...c, blocos: c.blocos.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const delBloco = (id: string) => patchActive((c) => ({ ...c, blocos: c.blocos.filter((b) => b.id !== id) }));

  // ---- drag / resize (custom, lida com a escala do canvas) ----
  const startDrag = (e: React.PointerEvent, key: string, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    if (drag.current) return; // evita re-entrada → listeners duplicados
    setSelected(key);
    let ox = 0, oy = 0, ow = 0;
    if (key.startsWith("bloco:")) {
      const b = card.blocos.find((x) => x.id === key.slice(6));
      if (b) { ox = b.x; oy = b.y; ow = b.w; }
    } else {
      const p = elPos(card, key as ElKey);
      ox = p.x; oy = p.y; ow = p.w;
    }
    drag.current = { key, mode, cardIdx: active, sx: e.clientX, sy: e.clientY, ox, oy, ow };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };
  const onDragMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scaleRef.current;
    const dy = (e.clientY - d.sy) / scaleRef.current;
    if (d.mode === "resize") {
      const w = Math.max(140, Math.round(d.ow + dx));
      applyPos(d.key, { w });
    } else {
      applyPos(d.key, { x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) });
    }
  }, []);
  const onDragEnd = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  }, [onDragMove]);

  // aplica posição (abs) ao modelo — usa refs p/ evitar stale closure no listener
  const applyPos = useCallback((key: string, patch: { x?: number; y?: number; w?: number }) => {
    const idx = drag.current ? drag.current.cardIdx : activeRef.current; // alvo travado no card onde o drag começou
    setDoc((d) => ({
      ...d,
      cards: d.cards.map((c, ci) => {
        if (ci !== idx) return c;
        if (key.startsWith("bloco:")) {
          const id = key.slice(6);
          return { ...c, blocos: c.blocos.map((b) => (b.id === id ? { ...b, ...patch } : b)) } as Card;
        }
        return withLayout(c, key as ElKey, patch);
      }),
    }));
  }, []);

  const scaleRef = useRef(scale); scaleRef.current = scale;
  const activeRef = useRef(active); activeRef.current = active;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const framingRef = useRef(framing); framingRef.current = framing;

  // ---- histórico (undo/redo) ----
  // checkpoint debounced: drags e digitação em rajada coalescem em 1 passo de undo.
  const past = useRef<Carousel[]>([]);
  const future = useRef<Carousel[]>([]);
  const lastCommitted = useRef<Carousel>(doc); // doc no último checkpoint
  const fromHistory = useRef(false); // pula o checkpoint quando a mudança veio do undo/redo/replace
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histLen, setHistLen] = useState({ p: 0, f: 0 });
  const syncHist = useCallback(() => setHistLen({ p: past.current.length, f: future.current.length }), []);

  const commitCheckpoint = useCallback(() => {
    if (checkpointTimer.current) { clearTimeout(checkpointTimer.current); checkpointTimer.current = null; }
    if (doc === lastCommitted.current) return;
    past.current.push(lastCommitted.current);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    lastCommitted.current = doc;
    syncHist();
  }, [doc, syncHist]);

  useEffect(() => {
    if (fromHistory.current) { fromHistory.current = false; lastCommitted.current = doc; return; }
    if (doc === lastCommitted.current) return;
    if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
    checkpointTimer.current = setTimeout(commitCheckpoint, 350);
    return () => { if (checkpointTimer.current) clearTimeout(checkpointTimer.current); };
  }, [doc, commitCheckpoint]);

  const restoreSnapshot = useCallback((snap: Carousel) => {
    fromHistory.current = true;
    setActive((a) => Math.min(a, snap.cards.length - 1));
    setSelected(null);
    setFraming(false);
    setDoc(snap);
  }, []);
  const undo = useCallback(() => {
    commitCheckpoint();
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(lastCommitted.current);
    lastCommitted.current = prev;
    syncHist();
    restoreSnapshot(prev);
  }, [commitCheckpoint, restoreSnapshot, syncHist]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(lastCommitted.current);
    lastCommitted.current = next;
    syncHist();
    restoreSnapshot(next);
  }, [restoreSnapshot, syncHist]);

  // troca o doc inteiro (load/import/restore) — zera o histórico (a troca em si não é "undoável" por gesto)
  const replaceDoc = useCallback((next: Carousel) => {
    past.current = []; future.current = [];
    lastCommitted.current = next;
    fromHistory.current = true;
    syncHist();
    setActive(0); setSelected(null); setFraming(false);
    setDoc(next);
  }, [syncHist]);

  // nudge por teclado do elemento selecionado (refs → sem stale closure)
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const key = selectedRef.current;
    if (!key) return;
    setDoc((d) => ({
      ...d,
      cards: d.cards.map((c, ci) => {
        if (ci !== activeRef.current) return c;
        if (key.startsWith("bloco:")) {
          const id = key.slice(6);
          return { ...c, blocos: c.blocos.map((b) => (b.id === id ? { ...b, x: b.x + dx, y: b.y + dy } : b)) } as Card;
        }
        const p = elPos(c, key as ElKey);
        return withLayout(c, key as ElKey, { x: p.x + dx, y: p.y + dy });
      }),
    }));
  }, []);

  // ---- autosave (debounced) ----
  // managed → entrega o doc ao host (Post Creator) p/ salvar junto do draft.
  // standalone → localStorage best-effort.
  const quotaWarned = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      if (managed) { onDocChangeRef.current?.(doc); return; }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(doc));
      } catch {
        // QuotaExceeded: imagens data-URI estouram o limite do navegador → autosave best-effort.
        if (!quotaWarned.current) {
          quotaWarned.current = true;
          toast.warning("Autosave pausado", { description: "Documento grande p/ o navegador guardar (imagens)." });
        }
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc, storageKey, managed]);

  // restaura do localStorage 1x no mount (pós-hidratação → sem mismatch). Zod migra docs antigos.
  // managed → o doc vem do draft (initialDoc), não do localStorage.
  useEffect(() => {
    if (managed || typeof window === "undefined") return;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(storageKey); } catch { return; }
    if (!raw) return;
    try {
      // Portal adaptation: docs salvos no app standalone usam /posts/… — no
      // portal os samples vivem em /studio/posts/…. Migra no restore.
      const migrated = raw.replaceAll('"/posts/', '"/studio/posts/');
      const parsed = ZCarousel.safeParse(JSON.parse(migrated));
      if (!parsed.success || !parsed.data.cards.length) return;
      replaceDoc(normalizeDoc(parsed.data));
    } catch { /* ignora restauro corrompido — segue com o seed */ }
  }, [replaceDoc, storageKey, managed]);

  // ---- enquadramento da imagem de fundo (pan + zoom, estilo Figma) ----
  // o fn recebe (fit, nat) — nat = dimensões naturais da foto, derivadas do card aqui dentro
  const applyFit = useCallback((idx: number, fn: (f: ImgFit, nat: ImgNat) => ImgFit) => {
    setDoc((d) => ({
      ...d,
      cards: d.cards.map((c, ci) => {
        if (ci !== idx) return c;
        const nat = c.tipo !== "fundo" && c.imgW && c.imgH ? { w: c.imgW, h: c.imgH } : null;
        return { ...c, imgFit: fn(c.imgFit, nat) } as Card;
      }),
    }));
  }, []);

  // backfill das dimensões naturais p/ imagens sem medida (seed/import) — necessário p/ enquadrar certo
  const dimsLoading = useRef<Set<string>>(new Set());
  useEffect(() => {
    doc.cards.forEach((c) => {
      if (c.tipo === "fundo" || !c.imagem || (c.imgW && c.imgH)) return;
      const src = c.imagem;
      if (dimsLoading.current.has(src)) return;
      dimsLoading.current.add(src);
      const im = new window.Image();
      im.onload = () => {
        dimsLoading.current.delete(src);
        setDoc((d) => ({ ...d, cards: d.cards.map((cc) => (cc.tipo !== "fundo" && cc.imagem === src && !(cc.imgW && cc.imgH) ? ({ ...cc, imgW: im.naturalWidth, imgH: im.naturalHeight } as Card) : cc)) }));
      };
      im.onerror = () => dimsLoading.current.delete(src);
      im.src = src;
    });
  }, [doc.cards]);

  // ---- entrar/comitar/cancelar enquadramento (estilo Figma: ✓/Enter comete, Esc reverte) ----
  // enter captura o fit atual (snapshot); cancel restaura; commit descarta o snapshot.
  const enterFraming = () => { framingSnap.current = card.imgFit; setFraming(true); };
  const commitFraming = useCallback(() => { framingSnap.current = null; setFraming(false); }, []);
  const cancelFraming = useCallback(() => {
    const snap = framingSnap.current;
    if (snap) applyFit(activeRef.current, () => snap);
    framingSnap.current = null;
    setFraming(false);
  }, [applyFit]);

  const onImgDragMove = useCallback((e: PointerEvent) => {
    const d = imgDrag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scaleRef.current;
    const dy = (e.clientY - d.sy) / scaleRef.current;
    applyFit(d.cardIdx, (f, nat) => clampFit({ ...f, x: d.ox + dx, y: d.oy + dy }, nat));
  }, [applyFit]);
  const onImgDragEnd = useCallback(() => {
    imgDrag.current = null;
    setGrabbing(false);
    window.removeEventListener("pointermove", onImgDragMove);
    window.removeEventListener("pointerup", onImgDragEnd);
  }, [onImgDragMove]);
  const startImgDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (imgDrag.current) return;
    const f = card.imgFit;
    imgDrag.current = { sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, cardIdx: active };
    setGrabbing(true);
    window.addEventListener("pointermove", onImgDragMove);
    window.addEventListener("pointerup", onImgDragEnd);
  };

  // zoom-no-cursor via scroll — listener nativo non-passive (React onWheel é passive → não dá p/ preventDefault)
  useEffect(() => {
    if (!framing) return;
    const el = innerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / scaleRef.current;
      const cy = (e.clientY - rect.top) / scaleRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyFit(activeRef.current, (f, nat) => zoomAt(f, f.scale * factor, cx, cy, nat));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [framing, applyFit]);

  // limpa listeners órfãos se o componente desmontar no meio de um drag
  useEffect(() => () => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointermove", onImgDragMove);
    window.removeEventListener("pointerup", onImgDragEnd);
  }, [onDragMove, onDragEnd, onImgDragMove, onImgDragEnd]);

  // seleção é por-card: limpa ao trocar de card (evita editar/apagar elemento do card errado)
  useEffect(() => { setSelected(null); setFraming(false); }, [active]);

  // ---- medição dos elementos renderizados (design px via offset*) ----
  useLayoutEffect(() => {
    const measure = () => {
      const root = innerRef.current;
      if (!root) return;
      const map: Record<string, Rect> = {};
      root.querySelectorAll<HTMLElement>("[data-el]").forEach((n) => {
        const k = n.getAttribute("data-el")!;
        map[k] = { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
      });
      setRects(map);
    };
    measure();
    // re-mede quando as fontes carregam (métricas mudam)
    if (typeof document !== "undefined" && document.fonts?.ready) document.fonts.ready.then(measure);
  }, [doc, active, scale]);

  // reset do scroll do inspetor ao trocar de card (evita o glitch de reflow do scroll)
  useLayoutEffect(() => { inspectorRef.current?.scrollTo({ top: 0 }); }, [active]);

  // ---- teclado ----
  const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = document.activeElement?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return; // deixa o undo nativo do texto agir
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (e.key === "Escape") { if (framingRef.current) cancelFraming(); else setSelected(null); return; }
      if (e.key === "Enter" && framingRef.current) { e.preventDefault(); commitFraming(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current?.startsWith("bloco:")) { delBloco(selectedRef.current.slice(6)); return; }
      const dir = NUDGE[e.key];
      if (dir) {
        // com elemento selecionado: setas movem ±1px (Shift = ±10). Sem seleção: trocam de card.
        if (selectedRef.current) { e.preventDefault(); const k = e.shiftKey ? 10 : 1; nudgeSelected(dir[0] * k, dir[1] * k); return; }
        if (e.key === "ArrowLeft") setActive((a) => Math.max(0, a - 1));
        else if (e.key === "ArrowRight") setActive((a) => Math.min(doc.cards.length - 1, a + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.cards.length, active, undo, redo, nudgeSelected, cancelFraming, commitFraming]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- export (server Satori) ----
  const renderPng = async (c: Card, attempts = 3): Promise<Blob> => {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch("/api/studio/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: c }) });
        if (!res.ok) { lastErr = new Error("render falhou: " + (await res.text())); continue; }
        return await res.blob();
      } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error("render falhou");
  };
  const exportOne = async () => {
    setBusy("one");
    try {
      const blob = await renderPng(card);
      downloadBlob(blob, `${filePrefix}_${String(active + 1).padStart(2, "0")}.png`);
      toast.success("Card exportado");
    } catch (e) { toast.error("Falha ao exportar o card.", { description: "Tente novamente." }); console.error(e); }
    finally { setBusy(null); }
  };
  const useInPost = async () => {
    if (!onUseInPost) return;
    setBusy("zip");
    const tid = toast.loading(`Renderizando 0/${doc.cards.length}…`);
    try {
      const cards = [...doc.cards];
      const slots: (File | null)[] = new Array(cards.length).fill(null);
      let next = 0, done = 0;
      const worker = async () => {
        while (next < cards.length) {
          const i = next++;
          try {
            const blob = await renderPng(cards[i]);
            slots[i] = new File([blob], `${filePrefix}_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" });
          } catch (e) {
            console.error(`render card ${i + 1} falhou`, e); // slot stays null → reported below
          }
          done++;
          toast.loading(`Renderizando ${done}/${cards.length}…`, { id: tid });
        }
      };
      await Promise.all(Array.from({ length: Math.min(RENDER_CONCURRENCY, cards.length) }, worker));
      // Keep order, drop the cards that failed all retries rather than aborting
      // the whole batch (a 4-card carousel still ships the 3 that rendered).
      const files = slots.filter((f): f is File => f != null);
      const failed = slots.length - files.length;
      if (files.length === 0) throw new Error("Nenhum card renderizou.");
      toast.loading("Enviando para o post…", { id: tid });
      // Reelflip cards render at a fixed 1080×1350 (4:5) — pass that so the post
      // creator locks the preview crop instead of re-probing each PNG.
      // Spot template: seed the caption from the spot's description + credit so
      // the post carries it alongside the design (other templates pass "").
      // passa o doc editável junto → o Post Creator salva no draft (studio ↔ post).
      await onUseInPost(files, spotCaption(doc), 1080 / 1350, doc);
      if (failed > 0) toast.warning(`${failed} card(s) falharam no render e ficaram de fora.`, { id: tid });
      else toast.success("Cards no post!", { id: tid });
    } catch (e) { toast.error("Falha ao usar no post.", { id: tid, description: "Tente novamente." }); console.error(e); }
    finally { setBusy(null); }
  };

  const exportZip = async () => {
    setBusy("zip");
    const tid = toast.loading(`Renderizando 0/${doc.cards.length}…`);
    try {
      const zip = new JSZip();
      const cards = [...doc.cards]; // snapshot — evita race se os cards mudarem durante o render
      // pool de N renders em paralelo (Satori é o gargalo) — preserva a ordem via índice
      let next = 0, done = 0;
      const worker = async () => {
        while (next < cards.length) {
          const i = next++;
          const blob = await renderPng(cards[i]);
          zip.file(`${filePrefix}_${String(i + 1).padStart(2, "0")}.png`, blob);
          done++;
          toast.loading(`Renderizando ${done}/${cards.length}…`, { id: tid }); // 1 toast atualizado, sem spam
        }
      };
      await Promise.all(Array.from({ length: Math.min(RENDER_CONCURRENCY, cards.length) }, worker));
      downloadBlob(await zip.generateAsync({ type: "blob" }), `${filePrefix}_carrossel.zip`);
      toast.success("Zip pronto", { id: tid });
    } catch (e) { toast.error("Falha ao exportar o .zip.", { id: tid, description: "Tente novamente." }); console.error(e); }
    finally { setBusy(null); }
  };

  const titleFs = card.tipo === "capa" ? (elPos(card, "titulo").fontSize ?? 240) : 240;
  const cardImg = card.tipo !== "fundo" ? card.imagem : null;
  const fit = card.imgFit;

  return (
    <TooltipProvider delay={400}>
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {/* ESQUERDA */}
      <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar">
        <div className="p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{spotMode ? "Spots" : "Carrossel"}</h2>
          <div className="flex flex-wrap gap-1.5">
            {spotMode ? (
              <>
                <Button size="sm" onClick={openSpots}><MapPin className="size-3.5" />Escolher do mapa</Button>
                <Button size="sm" variant="secondary" onClick={() => addCard("spot")}><Plus className="size-3.5" />Card</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => addCard("conteudo")}><Plus className="size-3.5" />Conteúdo</Button>
                <Button size="sm" variant="secondary" onClick={() => addCard("fundo")}><Plus className="size-3.5" />Fundo</Button>
                <Button size="sm" variant="secondary" onClick={() => addCard("capa")}><Plus className="size-3.5" />Capa</Button>
              </>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <div className="flex flex-col gap-1.5 pb-3">
            {doc.cards.map((c, i) => (
              <div
                key={c.id}
                className={`group flex items-center gap-0.5 rounded-md border p-1 transition-colors ${i === active ? "border-selection bg-selection/10" : "border-transparent bg-muted/40 hover:bg-muted"}`}
              >
                {/* área selecionável = botão real (teclado nativo, sem listbox semi-implementada) */}
                <button
                  type="button"
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => { setActive(i); setSelected(null); }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-selection"
                >
                  {/* thumbnail ao vivo (mesmo CardArtwork do canvas, escalado) */}
                  <div className="shrink-0 overflow-hidden rounded-sm border border-border/60 bg-white" style={{ width: THUMB_W, height: Math.round((THUMB_W * CARD_H) / CARD_W) }}>
                    <div style={{ width: CARD_W, height: CARD_H, transform: `scale(${THUMB_W / CARD_W})`, transformOrigin: "top left" }}>
                      <CardArtwork card={c} assets={CLIENT_ASSETS} />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`w-fit rounded px-1.5 py-0.5 text-[10px] uppercase ${i === active ? "bg-selection/20 text-foreground" : "bg-muted text-muted-foreground"}`}>
                      {c.tipo === "capa" ? "capa" : c.tipo === "fundo" ? "fundo" : c.tipo === "spot" ? "spot" : i + 1}
                    </span>
                    <span className="truncate">{(c.subtitulo || (c.tipo === "capa" ? c.titulo : c.tipo === "spot" ? c.spotName : c.blocos[0]?.texto) || "sem título").slice(0, 22)}</span>
                  </div>
                </button>
                {/* ações irmãs (não aninhadas no botão selecionável) */}
                <Button variant="ghost" size="icon-xs" aria-label="Mover card para cima" className="text-muted-foreground" onClick={() => moveCard(i, -1)}><ArrowUp className="size-3.5" /></Button>
                <Button variant="ghost" size="icon-xs" aria-label="Mover card para baixo" className="text-muted-foreground" onClick={() => moveCard(i, 1)}><ArrowDown className="size-3.5" /></Button>
                <Button variant="ghost" size="icon-xs" aria-label="Apagar card" className="text-muted-foreground" onClick={() => delCard(i)}><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-1.5 p-3">
          {onUseInPost && (
            <Button size="sm" onClick={useInPost} disabled={!!busy}>
              {busy === "zip" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Usar no post →
            </Button>
          )}
          <Button size="sm" onClick={exportOne} disabled={!!busy} aria-busy={busy === "one"}>
            {busy === "one" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {busy === "one" ? "Exportando…" : "Exportar card"}
          </Button>
          <Button size="sm" variant="secondary" onClick={exportZip} disabled={!!busy} aria-busy={busy === "zip"}>
            {busy === "zip" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {busy === "zip" ? "Exportando…" : "Exportar todos (.zip)"}
          </Button>
        </div>
      </aside>

      {/* CENTRO */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Card anterior" onClick={() => setActive((a) => Math.max(0, a - 1))}><ChevronLeft className="size-4" /></Button>} />
              <TooltipContent>Card anterior (←)</TooltipContent>
            </Tooltip>
            <span aria-live="polite" className="w-16 text-center text-xs text-muted-foreground tabular-nums">{active + 1} / {doc.cards.length}</span>
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Próximo card" onClick={() => setActive((a) => Math.min(doc.cards.length - 1, a + 1))}><ChevronRight className="size-4" /></Button>} />
              <TooltipContent>Próximo card (→)</TooltipContent>
            </Tooltip>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Desfazer" disabled={!histLen.p} onClick={undo}><Undo2 className="size-4" /></Button>} />
              <TooltipContent>Desfazer (⌘Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Refazer" disabled={!histLen.f} onClick={redo}><Redo2 className="size-4" /></Button>} />
              <TooltipContent>Refazer (⌘⇧Z)</TooltipContent>
            </Tooltip>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Diminuir zoom" onClick={() => setScale((s) => Math.max(0.15, +(s - 0.04).toFixed(2)))}><ZoomOut className="size-4" /></Button>} />
              <TooltipContent>Diminuir zoom</TooltipContent>
            </Tooltip>
            <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
            <Tooltip>
              <TooltipTrigger render={<Button size="icon" variant="secondary" aria-label="Aumentar zoom" onClick={() => setScale((s) => Math.min(0.9, +(s + 0.04).toFixed(2)))}><ZoomIn className="size-4" /></Button>} />
              <TooltipContent>Aumentar zoom</TooltipContent>
            </Tooltip>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <Tooltip>
            <TooltipTrigger render={
              <Button size="icon" variant={burn ? "default" : "secondary"} aria-label="Preview real (burn)" aria-pressed={burn} onClick={() => setBurn((b) => !b)}>
                {burnBusy ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
              </Button>
            } />
            <TooltipContent>Preview real — exatamente como vai pro post (PNG renderizado)</TooltipContent>
          </Tooltip>
        </div>

        {/* mockup do feed (chrome FIXO — não exporta) */}
        <div className="overflow-hidden rounded-[28px] bg-white shadow-2xl" style={{ width: CARD_W * scale }}>
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="size-9 rounded-full" style={{ background: spotMode ? "#a3e635" : COLORS.blue }} />
            <div className="leading-tight"><div className="text-sm font-semibold text-neutral-900">{spotMode ? "skatehive" : "reelflip"}</div><div className="text-[11px] text-neutral-500">{spotMode ? "skate spots" : "São Paulo, Brasil"}</div></div>
            <MoreVertical className="ml-auto size-5 text-neutral-800" />
          </div>
          <div className="relative" style={{ width: CARD_W * scale, height: CARD_H * scale }}>
            <div
              ref={innerRef}
              className="absolute left-0 top-0 origin-top-left"
              style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})` }}
              onPointerDown={() => setSelected(null)}
            >
              <div
                data-bg
                style={{ position: "absolute", inset: 0 }}
                onDoubleClick={() => cardImg && enterFraming()}
              >
                <CardArtwork card={card} assets={{ ...CLIENT_ASSETS, spotQr }} />
              </div>

              {/* Burn preview — the real rendered PNG laid over the DOM preview,
                  so what you see is exactly what gets posted. */}
              {burn && burnUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={burnUrl} alt="" width={CARD_W} height={CARD_H} style={{ position: "absolute", inset: 0, width: CARD_W, height: CARD_H }} />
              )}

              {/* modo enquadramento: captura arraste (pan) + scroll (zoom) sobre a imagem de fundo */}
              {framing && cardImg && (
                <div
                  onPointerDown={startImgDrag}
                  onDoubleClick={commitFraming}
                  style={{ position: "absolute", inset: 0, cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }}
                >
                  {/* moldura + grade rule-of-thirds (guia visual, não exporta) */}
                  <div style={{ position: "absolute", inset: 0, outline: "4px solid var(--selection)", outlineOffset: -4, pointerEvents: "none" }} />
                  {[1, 2].map((i) => (
                    <div key={`v${i}`} style={{ position: "absolute", left: (CARD_W / 3) * i, top: 0, width: 2, height: CARD_H, background: "color-mix(in oklch, var(--selection) 55%, transparent)", pointerEvents: "none" }} />
                  ))}
                  {[1, 2].map((i) => (
                    <div key={`h${i}`} style={{ position: "absolute", top: (CARD_H / 3) * i, left: 0, height: 2, width: CARD_W, background: "color-mix(in oklch, var(--selection) 55%, transparent)", pointerEvents: "none" }} />
                  ))}
                </div>
              )}

              {/* overlays de interação dos textos — ocultos durante o enquadramento p/ evitar conflito de gesto */}
              {!framing && Object.entries(rects).map(([key, r]) => {
                const isSel = selected === key;
                const resizable = RESIZABLE.has(key) || key.startsWith("bloco:");
                // affordances counter-escaladas: dividir por scale → tamanho constante em px de tela
                // (sem isso, a 42% a alça de 16px vira ~7px e o outline some). cor/hover vêm da classe.
                const hs = 16 / scale;
                return (
                  <div
                    key={key}
                    className="editor-overlay"
                    data-selected={isSel || undefined}
                    onPointerDown={(e) => startDrag(e, key, "move")}
                    style={{
                      position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, cursor: "move",
                      outlineWidth: (isSel ? 3 : 1.5) / scale, outlineOffset: 2 / scale, background: "transparent",
                    }}
                  >
                    {isSel && resizable && (
                      <div
                        onPointerDown={(e) => startDrag(e, key, "resize")}
                        style={{ position: "absolute", right: -hs / 2, top: "50%", width: hs, height: hs, marginTop: -hs / 2, borderRadius: 4 / scale, background: "var(--selection)", border: `${1 / scale}px solid var(--background)`, cursor: "ew-resize" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* badge de modo enquadramento (fora do canvas escalado, p/ texto nítido) */}
            {framing && cardImg && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-foreground/90 px-3 py-1 text-[11px] font-medium text-background shadow-lg tabular-nums">
                Enquadrando · {fit.scale.toFixed(2)}× · arraste · scroll p/ zoom · <b>Enter</b> aplica · <b>Esc</b> cancela
              </div>
            )}
          </div>
          <div className="flex items-center gap-5 px-4 py-3 text-neutral-900" aria-hidden>
            <Heart className="size-[22px] fill-[#FF3040] text-[#FF3040]" strokeWidth={1.5} />
            <MessageCircle className="size-[22px]" strokeWidth={1.5} />
            <Send className="size-[22px]" strokeWidth={1.5} />
            <Bookmark className="ml-auto size-[22px]" strokeWidth={1.5} />
          </div>
        </div>
        <p className="max-w-md text-center text-xs text-muted-foreground">Arraste p/ mover · alça redimensiona · <b>2× clique</b> na foto enquadra · setas <b>nudge</b> (Shift ±10) · <b>Del</b> apaga bloco · <b>⌘Z</b> desfaz · <b>←/→</b> troca card. Autosave local + posições por card. PNG via Satori (server).</p>
      </main>

      {/* DIREITA */}
      <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar">
        <div ref={inspectorRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Card</h2>
            {!spotMode && (
              <>
                <Label className="text-muted-foreground">Tipo</Label>
                <Select value={card.tipo} onValueChange={(v) => { commitFraming(); setType(v as Card["tipo"]); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conteudo">Conteúdo (foto)</SelectItem>
                    <SelectItem value="fundo">Fundo (cor sólida)</SelectItem>
                    <SelectItem value="capa">Capa</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {card.tipo === "fundo" ? (
              <>
                <Label className="text-muted-foreground">Cor de fundo</Label>
                <div className="flex flex-wrap gap-1.5">
                  {BRAND_SWATCHES.map(([name, hex]) => {
                    const isSel = card.bgColor?.toLowerCase() === hex.toLowerCase();
                    return (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Cor ${name}`}
                        aria-pressed={isSel}
                        title={name}
                        onClick={() => patchActive((c) => ({ ...c, bgColor: hex }) as Card)}
                        className={`size-7 rounded-md border ${isSel ? "border-transparent ring-2 ring-offset-2 ring-offset-sidebar ring-selection" : "border-border/60"}`}
                        style={{ background: hex }}
                      />
                    );
                  })}
                  {/* picker nativo como fallback (cor fora da paleta) */}
                  <label className="relative size-7 cursor-pointer overflow-hidden rounded-md border border-border/60" title="Cor personalizada">
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground"><Pipette className="size-3.5" /></span>
                    <input type="color" aria-label="Cor personalizada do fundo" value={card.bgColor} onChange={(e) => patchActive((c) => ({ ...c, bgColor: e.target.value }) as Card)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                  </label>
                </div>
                <Input value={card.bgColor} onChange={(e) => patchActive((c) => ({ ...c, bgColor: e.target.value }) as Card)} className="h-7 font-mono text-xs" aria-label="Hex da cor de fundo" />
              </>
            ) : (
              <>
                {card.tipo === "spot" && (
                  <Button size="sm" onClick={openSpots}><MapPin className="size-3.5" />Escolher spot do mapa</Button>
                )}
                <Label className="text-muted-foreground">{card.tipo === "spot" ? "Foto do spot" : "Imagem de fundo"}</Label>
                <Button size="sm" variant="secondary" onClick={() => fileImg.current?.click()}><ImageIcon className="size-3.5" />{cardImg ? "Trocar imagem" : "Escolher imagem"}</Button>
                <input ref={fileImg} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onImage(e.target.files[0])} />
                {cardImg && (
                  <>
                    <Button size="sm" variant={framing ? "default" : "secondary"} onClick={() => (framing ? commitFraming() : enterFraming())}>
                      {framing ? <Check className="size-3.5" /> : <Crop className="size-3.5" />}
                      {framing ? "Concluir enquadramento" : "Enquadrar imagem"}
                    </Button>
                    <Label className="text-muted-foreground">Escala da foto: {fit.scale.toFixed(2)}×</Label>
                    <Slider
                      value={[fit.scale]} min={MIN_SCALE} max={MAX_SCALE} step={0.01}
                      onValueChange={(v) => applyFit(active, (f, nat) => clampFit({ ...f, scale: Array.isArray(v) ? v[0] : v }, nat))}
                    />
                    <Button size="sm" variant="ghost" className="justify-start text-muted-foreground" onClick={() => applyFit(active, () => DEFAULT_FIT)}>
                      <RotateCcw className="size-3.5" />Resetar enquadramento
                    </Button>
                  </>
                )}
              </>
            )}

            {card.tipo === "capa" && (
              <>
                <Label className="text-muted-foreground">Título</Label>
                <Textarea value={card.titulo} onChange={(e) => patchActive((c) => ({ ...c, titulo: e.target.value }) as Card)} rows={2} />
                <Label className="text-muted-foreground">Tamanho do título: {titleFs}px</Label>
                <Slider value={[titleFs]} min={80} max={320} step={10} onValueChange={(v) => patchActive((c) => withLayout(c, "titulo", { fontSize: Array.isArray(v) ? v[0] : v }))} />
              </>
            )}

            {card.tipo === "spot" && (
              <>
                <Label className="text-muted-foreground">Nome do spot</Label>
                <Input value={card.spotName} onChange={(e) => patchSpotGroup({ spotName: e.target.value })} placeholder="Waxed Three Stair" />
                <Label className="text-muted-foreground">Localização</Label>
                <Input value={card.spotLocation} onChange={(e) => patchSpotGroup({ spotLocation: e.target.value })} placeholder="Minneapolis, MN" />
                <Label className="text-muted-foreground">Crédito (autor)</Label>
                <Input value={card.spotAuthor} onChange={(e) => patchSpotGroup({ spotAuthor: e.target.value })} placeholder="web-gnar" />
                <Label className="text-muted-foreground">Descrição (vai pra legenda do post)</Label>
                <Textarea
                  value={card.spotDescription}
                  onChange={(e) => patchSpotGroup({ spotDescription: e.target.value })}
                  rows={4}
                  placeholder="Descrição do spot — vira a legenda quando você usa no post."
                />
              </>
            )}

            {card.tipo === "capa" && (
              <>
                <Label className="text-muted-foreground">Subtítulo / gancho</Label>
                <Textarea value={card.subtitulo} onChange={(e) => patchActive((c) => ({ ...c, subtitulo: e.target.value }) as Card)} rows={2} />
                <p className="text-xs text-foreground-subtle">Envolva uma palavra em <code>*asteriscos*</code> para destacá-la em amarelo.</p>
              </>
            )}

            {card.tipo !== "capa" && (
              <>
                <div className="mt-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium">{card.tipo === "spot" ? "Elementos livres" : "Chat boxes"}</h3>
                  <Button size="sm" variant="secondary" onClick={addBloco}><Plus className="size-3.5" />Add</Button>
                </div>
                {card.blocos.map((b, i) => (
                  <div key={b.id} className={`rounded-md border p-2 transition-colors ${selected === "bloco:" + b.id ? "border-selection" : "border-border"}`}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <button className="rounded font-medium outline-none focus-visible:ring-2 focus-visible:ring-selection" aria-current={selected === "bloco:" + b.id ? "true" : undefined} onClick={() => setSelected("bloco:" + b.id)}>Caixa {i + 1}</button>
                      <div className="flex items-center gap-2">
                        <ColorPick value={b.color ?? "amarela"} onChange={(color) => updateBloco(b.id, { color })} />
                        <Button variant="ghost" size="icon-xs" aria-label={`Apagar caixa ${i + 1}`} className="text-muted-foreground" onClick={() => delBloco(b.id)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </div>
                    <Textarea value={b.texto} onChange={(e) => updateBloco(b.id, { texto: e.target.value })} rows={3} className="text-xs" />
                  </div>
                ))}
              </>
            )}

            {card.tipo !== "spot" && (
              <Button size="sm" variant="ghost" className="mt-1 justify-start text-muted-foreground" onClick={() => patchActive(resetLayout)}><RotateCcw className="size-3.5" />Resetar posições</Button>
            )}
          </div>
        </div>
      </aside>

      {/* SkateHive spot map picker */}
      <Dialog open={spotsOpen} onOpenChange={setSpotsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Escolher spot do mapa SkateHive</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Spots enviados pela comunidade. Clique p/ preencher o card (foto + nome + local + crédito).</p>
          {spotsErr ? (
            <p className="text-sm text-danger">{spotsErr}</p>
          ) : spots === null ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando spots…</p>
          ) : spots.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum spot encontrado.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {spots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickSpot(s)}
                    className="group overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-selection"
                  >
                    <div className="aspect-square overflow-hidden bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.photo ?? ""} alt="" className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    </div>
                    <div className="p-2">
                      <div className="truncate text-xs font-semibold text-foreground">{s.name || "Spot sem nome"}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{s.location || `@${s.author}`}</div>
                    </div>
                  </button>
                ))}
              </div>
              {spotsHasMore && (
                <Button size="sm" variant="secondary" className="mt-3 w-full" disabled={spotsBusy} onClick={() => void loadSpots(spotsPage + 1)}>
                  {spotsBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Carregar mais
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
