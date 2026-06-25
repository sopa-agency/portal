// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Assets } from "@/components/studio/card-artwork";

const root = process.cwd();

type FontSpec = { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" };
let _fonts: FontSpec[] | null = null;

export async function loadFonts(): Promise<FontSpec[]> {
  if (_fonts) return _fonts;
  const brand = (file: string) => readFile(path.join(root, "public", "studio", "fonts", file));
  const node = (p: string) => readFile(path.join(root, "node_modules", p));
  const [toomReg, toomBold, bazinga, made, joystix, inter400, inter600, inter700] = await Promise.all([
    brand("TOOM-Regular.otf"),
    brand("TOOM-Bold-Italic.otf"),
    brand("Bazinga-Regular.otf"),
    brand("MADE-GoodTime-Grotesk.otf"),
    brand("joystix.otf"), // SkateHive brand display font (spot template)
    node("@fontsource/inter/files/inter-latin-400-normal.woff"),
    node("@fontsource/inter/files/inter-latin-600-normal.woff"),
    node("@fontsource/inter/files/inter-latin-700-normal.woff"),
  ]);
  _fonts = [
    // TOOM: peso 700 = Bold-Italic (corpo dos cards); 400 = Regular (disponível p/ caption)
    { name: "TOOM", data: toomReg, weight: 400, style: "normal" },
    { name: "TOOM", data: toomBold, weight: 700, style: "normal" },
    { name: "Bazinga", data: bazinga, weight: 400, style: "normal" },
    { name: "MADE GoodTime Grotesk", data: made, weight: 400, style: "normal" },
    // Joystix: SkateHive's signature pixel/arcade font (per skatehive3.0).
    { name: "Joystix", data: joystix, weight: 400, style: "normal" },
    // Inter = fallback de glifos (não é mais papel da marca)
    { name: "Inter", data: inter400, weight: 400, style: "normal" },
    { name: "Inter", data: inter600, weight: 600, style: "normal" },
    { name: "Inter", data: inter700, weight: 700, style: "normal" },
  ];
  return _fonts;
}

/**
 * Fetch a remote image into a data-URI so Satori never has to do its own
 * network fetch at render time. Satori is given explicit width/height, so when
 * its internal fetch is slow/fails it silently renders the card WITHOUT the
 * photo (blank where the image should be) — which is exactly the "first cards
 * have no image" failure on big Hive originals under concurrent renders.
 * Retries + a generous timeout make every card embed its pixels deterministically.
 */
async function fetchImageDataUri(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "portal-skatehive", Accept: "image/*" },
        redirect: "follow",
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      let ct = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!ct.startsWith("image/")) ct = "image/jpeg"; // some gateways mislabel
      return `data:${ct};base64,` + buf.toString("base64");
    } catch {
      // transient (abort/network) — fall through to the next attempt
    }
  }
  return null;
}

// Satori não busca path relativo no server: resolve "/posts/..." (public) -> data-URI.
// http(s) → baixado p/ data-URI (confiável). data: passa direto. Cacheado por src.
const _imgCache = new Map<string, string>();
export async function resolveImg(src: string | null | undefined): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  if (src.startsWith("http")) {
    if (_imgCache.has(src)) return _imgCache.get(src)!;
    const uri = await fetchImageDataUri(src);
    if (uri) _imgCache.set(src, uri);
    return uri ?? src; // fall back to the raw URL so Satori can still try
  }
  if (!src.startsWith("/")) return src;
  if (_imgCache.has(src)) return _imgCache.get(src)!;
  // path-traversal guard: "/../.env" sairia de public/. Resolve e exige que fique dentro de public/.
  const publicDir = path.resolve(root, "public");
  const abs = path.resolve(publicDir, "." + src);
  if (abs !== publicDir && !abs.startsWith(publicDir + path.sep)) return null;
  // Portal adaptation: a missing/stale image path must not kill the render —
  // the card just renders without its background.
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return null;
  }
  const ext = src.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  const uri = `data:image/${ext};base64,` + buf.toString("base64");
  _imgCache.set(src, uri);
  return uri;
}

// Cache em memória p/ o processo. Trocar um arquivo em public/assets exige reload do módulo (HMR/restart).
let _assets: Assets | null = null;
export async function loadAssets(): Promise<Assets> {
  if (_assets) return _assets;
  const dir = path.join(root, "public", "studio", "assets");
  const du = async (file: string) =>
    "data:image/png;base64," + (await readFile(path.join(dir, file))).toString("base64");
  const [capaHeader, barcode] = await Promise.all([
    du("capa-header.png"),
    du("barcode.png"),
  ]);
  _assets = { capaHeader, barcode };
  return _assets;
}
