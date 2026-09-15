// Assets do filme: resolve `public:` e `drive:` para URLs same-origin e
// carrega tudo como HTMLImageElement antes de liberar a exportação. Como no
// swaps.pro, imagem que falha vira "tentar de novo", nunca um placeholder —
// mas um asset do Drive que não existe só some do desenho (a cena avisa).

import type { AssetSource } from "./types";

export const DRIVE_FOLDER = "🎬 Filmes";

export type DriveIndex = Map<string, string>; // "screens/auctions.png" → fileId

export type DriveIndexResult = { ok: true; index: DriveIndex; folderId: string } | { ok: false; note: string };

type DriveFile = { id: string; name: string; mimeType: string };
const FOLDER = "application/vnd.google-apps.folder";

async function listDrive(folderId?: string): Promise<{ ok: true; files: DriveFile[]; folderId: string } | { ok: false; note: string }> {
  const res = await fetch(`/api/brain/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`, { cache: "no-store" });
  let data: { ok: boolean; files?: DriveFile[]; folderId?: string; error?: string; note?: string; reason?: string };
  try {
    data = await res.json();
  } catch {
    return { ok: false, note: `Drive list failed (HTTP ${res.status})` };
  }
  if (!data.ok || !data.files) return { ok: false, note: data.note ?? data.error ?? data.reason ?? "Drive not configured" };
  return { ok: true, files: data.files, folderId: data.folderId ?? folderId ?? "" };
}

/** Indexa "🎬 Filmes" (e um nível de subpastas) da raiz do Drive do projeto. */
export async function fetchDriveIndex(): Promise<DriveIndexResult> {
  const root = await listDrive();
  if (!root.ok) return root;
  const folder = root.files.find((f) => f.mimeType === FOLDER && /filmes|films/i.test(f.name));
  if (!folder) return { ok: false, note: `No "${DRIVE_FOLDER}" folder in the project's Drive root` };
  const index: DriveIndex = new Map();
  const top = await listDrive(folder.id);
  if (!top.ok) return top;
  for (const f of top.files) {
    if (f.mimeType === FOLDER) {
      const sub = await listDrive(f.id);
      if (sub.ok) for (const s of sub.files) if (s.mimeType !== FOLDER) index.set(`${f.name}/${s.name}`, s.id);
    } else index.set(f.name, f.id);
  }
  return { ok: true, index, folderId: folder.id };
}

/** URL same-origin de um asset, ou null quando o Drive não tem o arquivo. */
export function resolveSource(src: AssetSource, drive: DriveIndex | null): string | null {
  if (src.startsWith("public:")) return src.slice("public:".length);
  if (src.startsWith("data:")) return src;
  const path = src.slice("drive:".length);
  const id = drive?.get(path);
  return id ? `/api/brain/drive/file?id=${encodeURIComponent(id)}&mode=raw` : null;
}

export type LoadedAssets = { assets: Record<string, HTMLImageElement | undefined>; missing: string[] };

function loadImage(id: string, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error(`Timed out loading "${id}"`)), 20_000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not load "${id}" (${url})`));
    };
    image.src = url;
  });
}

/**
 * Carrega os assets. Os `required` (logo da marca) derrubam tudo se falharem;
 * os do Drive que não existem entram em `missing` e o filme segue sem eles.
 */
export async function loadFilmAssets(sources: Record<string, AssetSource>, drive: DriveIndex | null, required: string[] = ["logo"]): Promise<LoadedAssets> {
  const assets: Record<string, HTMLImageElement | undefined> = {};
  const missing: string[] = [];
  await Promise.all(
    Object.entries(sources).map(async ([id, src]) => {
      const url = resolveSource(src, drive);
      if (!url) {
        if (required.includes(id)) throw new Error(`Required asset "${id}" not found (${src})`);
        missing.push(id);
        return;
      }
      try {
        assets[id] = await loadImage(id, url);
      } catch (err) {
        if (required.includes(id)) throw err;
        missing.push(id);
      }
    }),
  );
  return { assets, missing: missing.sort() };
}
