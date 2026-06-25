// Vendored from r4topunk/reelflip-studio @ e186251 — sync manually; keep diffs minimal.
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
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
 * Hive's image CDN: resize + RE-ENCODE any source URL to a clean baseline image.
 * This is the key reliability fix — a card photo that's a progressive/CMYK JPEG,
 * an odd webp, or a multi-MB original makes Satori/resvg render the card blank
 * (or OOM under concurrency on Vercel). Routing through the proxy normalizes the
 * format and bounds the size to ~1280px, so every photo decodes the same way.
 */
function hiveProxy(url: string, width = 1280): string {
  return `https://images.hive.blog/${width}x0/${url}`;
}

async function fetchOnce(url: string, timeoutMs = 12000): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "portal-skatehive", Accept: "image/*" },
      redirect: "follow",
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a remote image and RE-ENCODE it to JPEG via sharp before embedding.
 * This is the actual fix: Satori/resvg cannot decode webp/avif (and the Hive
 * CDN serves webp even when asked to resize), throwing "u is not iterable" and
 * 400-ing the render. sharp decodes any format (webp/avif/png/jpeg/gif/tiff/
 * CMYK) and emits a clean baseline JPEG that Satori always handles. Resizes to
 * ≤1600px so the data-URI stays small and memory stays bounded under concurrency.
 */
async function fetchImageDataUri(url: string, attempts = 2): Promise<string | null> {
  // proxy-first (smaller download) → raw original (if the proxy can't reach host)
  const sources = url.startsWith("https://images.hive.blog/") && /\/\d+x\d+\//.test(url)
    ? [url]
    : [hiveProxy(url, 1600), url];
  for (let i = 0; i < attempts; i++) {
    for (const src of sources) {
      const buf = await fetchOnce(src);
      if (!buf) continue;
      try {
        const jpeg = await sharp(buf, { failOn: "none" })
          .rotate() // honor EXIF orientation
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 84 })
          .toBuffer();
        return "data:image/jpeg;base64," + jpeg.toString("base64");
      } catch {
        // sharp couldn't decode this source — try the next one
      }
    }
  }
  return null;
}

// Satori não busca path relativo no server: resolve "/posts/..." (public) -> data-URI.
// http(s) → baixado p/ data-URI (confiável). data: passa direto. Cacheado por src.
// Remote data-URIs are big, so the cache is bounded (FIFO) to avoid growth.
const _imgCache = new Map<string, string>();
const _IMG_CACHE_MAX = 48;
function cacheImg(key: string, val: string) {
  if (_imgCache.size >= _IMG_CACHE_MAX) {
    const oldest = _imgCache.keys().next().value;
    if (oldest !== undefined) _imgCache.delete(oldest);
  }
  _imgCache.set(key, val);
}
export async function resolveImg(src: string | null | undefined): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  if (src.startsWith("http")) {
    if (_imgCache.has(src)) return _imgCache.get(src)!;
    const uri = await fetchImageDataUri(src);
    if (uri) cacheImg(src, uri);
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
  cacheImg(src, uri);
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
