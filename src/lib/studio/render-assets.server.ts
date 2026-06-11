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
  const [toomReg, toomBold, bazinga, made, inter400, inter600, inter700] = await Promise.all([
    brand("TOOM-Regular.otf"),
    brand("TOOM-Bold-Italic.otf"),
    brand("Bazinga-Regular.otf"),
    brand("MADE-GoodTime-Grotesk.otf"),
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
    // Inter = fallback de glifos (não é mais papel da marca)
    { name: "Inter", data: inter400, weight: 400, style: "normal" },
    { name: "Inter", data: inter600, weight: 600, style: "normal" },
    { name: "Inter", data: inter700, weight: 700, style: "normal" },
  ];
  return _fonts;
}

// Satori não busca path relativo no server: resolve "/posts/..." (public) -> data-URI.
// data: e http(s) passam direto. Cacheado por path.
const _imgCache = new Map<string, string>();
export async function resolveImg(src: string | null | undefined): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("http")) return src;
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
  const [seloReel, seloPreco, barcode] = await Promise.all([
    du("selo-reelflip.png"),
    du("selo-preco.png"),
    du("barcode.png"),
  ]);
  _assets = { seloReel, seloPreco, barcode };
  return _assets;
}
