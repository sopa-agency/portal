"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Flame, Folder, HardDrive, Image as ImageIcon, Link2, Loader2, Search, Upload, X } from "lucide-react";
import { listMagazineImages, signMagazineCoverUpload } from "@/app/actions/magazine";
import { getPostImages } from "@/app/actions/homepage-pickers";

// Reusable image source picker modal: Upload (→ Pinata) / Drive / SkateHive post
// images / paste URL, plus an optional "this post's images" tab. Returns a plain
// URL via onPick — unlike the cover editor, there's no canvas here, so we store
// the direct URL (Hive/IPFS render fine in <img>). Reuses the same actions and
// Drive endpoints the magazine cover editor uses.

type Tab = "upload" | "drive" | "skatehive" | "post" | "url";
type DriveFile = { id: string; name: string; mimeType: string };
const FOLDER = "application/vnd.google-apps.folder";
const driveRaw = (id: string) => `/api/brain/drive/file?id=${encodeURIComponent(id)}&mode=raw`;

async function uploadToPinata(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const signed = await signMagazineCoverUpload(file.name, file.size, file.type);
  if (!signed.ok) return signed;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("network", "public");
  const res = await fetch(signed.url, { method: "POST", body: fd });
  if (!res.ok) return { ok: false, error: `Pinata HTTP ${res.status}` };
  const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
  const cid = json?.data?.cid;
  if (!cid) return { ok: false, error: "Pinata não retornou CID." };
  return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
}

export function ImageSourcePicker({
  onPick,
  onClose,
  postRef,
  title = "Escolher imagem",
}: {
  onPick: (url: string) => void;
  onClose: () => void;
  /** When set, enables a "this post's images" tab. */
  postRef?: { author: string; permlink: string };
  title?: string;
}) {
  const [tab, setTab] = useState<Tab>(postRef ? "post" : "upload");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drive
  const [drive, setDrive] = useState<DriveFile[] | null>(null);
  const [driveErr, setDriveErr] = useState<string | null>(null);
  const [driveStack, setDriveStack] = useState<string[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  // SkateHive feed
  const [sh, setSh] = useState<{ url: string; title: string }[] | null>(null);
  const [shErr, setShErr] = useState<string | null>(null);
  const [shLoading, setShLoading] = useState(false);
  const [shUser, setShUser] = useState("");
  // Post images
  const [postImgs, setPostImgs] = useState<string[] | null>(null);
  const [postErr, setPostErr] = useState<string | null>(null);
  const [postLoading, setPostLoading] = useState(false);
  // URL
  const [urlInput, setUrlInput] = useState("");

  const loadDrive = useCallback(async (folderId?: string) => {
    setDriveErr(null); setDrive(null); setDriveLoading(true);
    try {
      const res = await fetch(`/api/brain/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; files?: DriveFile[]; error?: string; reason?: string };
      if (data.ok && data.files) setDrive(data.files.filter((f) => f.mimeType === FOLDER || f.mimeType.startsWith("image/")));
      else { setDrive([]); setDriveErr(data.error ?? data.reason ?? "Drive não conectado."); }
    } catch (e) { setDrive([]); setDriveErr(e instanceof Error ? e.message : "Falha no Drive."); }
    finally { setDriveLoading(false); }
  }, []);

  const loadSh = useCallback(async (username?: string) => {
    setShErr(null); setSh(null); setShLoading(true);
    try {
      const r = await listMagazineImages(username);
      if (r.ok) setSh(r.images); else { setSh([]); setShErr(r.error); }
    } catch (e) { setSh([]); setShErr(e instanceof Error ? e.message : "Falha ao buscar."); }
    finally { setShLoading(false); }
  }, []);

  const loadPost = useCallback(async () => {
    if (!postRef) return;
    setPostErr(null); setPostImgs(null); setPostLoading(true);
    try {
      const r = await getPostImages(postRef.author, postRef.permlink);
      if (r.ok) setPostImgs(r.images); else { setPostImgs([]); setPostErr(r.error); }
    } catch (e) { setPostImgs([]); setPostErr(e instanceof Error ? e.message : "Falha ao buscar."); }
    finally { setPostLoading(false); }
  }, [postRef]);

  useEffect(() => {
    if (tab === "drive" && drive === null && !driveLoading) void loadDrive(driveStack[driveStack.length - 1]);
    if (tab === "skatehive" && sh === null && !shLoading) void loadSh();
    if (tab === "post" && postImgs === null && !postLoading) void loadPost();
  }, [tab, drive, driveLoading, driveStack, loadDrive, sh, shLoading, loadSh, postImgs, postLoading, loadPost]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Selecione uma imagem."); return; }
    setError(null); setUploading(true);
    try {
      const r = await uploadToPinata(f);
      if (r.ok) onPick(r.url); else setError(r.error);
    } finally { setUploading(false); }
  }

  function submitUrl() {
    const u = urlInput.trim();
    if (!/^https:\/\/\S+$/.test(u)) { setError("URL inválida (https)."); return; }
    onPick(u);
  }

  const tabBtn = (id: Tab, label: string, Icon: typeof Upload) => (
    <button type="button" onClick={() => { setTab(id); setError(null); }}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${tab === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  const grid = (items: { url: string; alt?: string }[] | null, loading: boolean, empty: string) => (
    <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
      {loading && <div className="col-span-3 flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
      {!loading && items?.map((im, i) => (
        <button key={`${im.url}-${i}`} type="button" onClick={() => onPick(im.url)} title={im.alt} className="aspect-square overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.url} alt={im.alt ?? ""} className="h-full w-full object-cover" loading="lazy" />
        </button>
      ))}
      {!loading && items && items.length === 0 && <p className="col-span-3 py-6 text-center text-[11px] text-foreground-faint">{empty}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-0.5">
          {postRef && tabBtn("post", "Do post", ImageIcon)}
          {tabBtn("upload", "Enviar", Upload)}
          {tabBtn("drive", "Drive", HardDrive)}
          {tabBtn("skatehive", "SkateHive", Flame)}
          {tabBtn("url", "URL", Link2)}
        </div>

        <div className="mt-3">
          {tab === "post" && grid(postImgs?.map((u) => ({ url: u })) ?? null, postLoading, postErr ?? "Sem imagens no post.")}

          {tab === "upload" && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-foreground-faint transition hover:border-border-strong hover:text-foreground disabled:opacity-50">
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
              <span className="text-xs">{uploading ? "Enviando…" : "Enviar imagem"}</span>
            </button>
          )}

          {tab === "drive" && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <button type="button" onClick={() => setDriveStack((p) => { const n = p.slice(0, -1); void loadDrive(n[n.length - 1]); return n; })} disabled={driveStack.length === 0 || driveLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted disabled:opacity-40 hover:border-border-strong">
                  <ArrowLeft className="h-3 w-3" /> Voltar
                </button>
                <span className="text-[10px] text-foreground-faint">Escolha no Drive</span>
              </div>
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {driveLoading && <div className="col-span-3 flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
                {!driveLoading && drive?.map((f) => f.mimeType === FOLDER ? (
                  <button key={f.id} type="button" onClick={() => { setDriveStack((p) => [...p, f.id]); void loadDrive(f.id); }} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-border bg-surface p-1 text-foreground-muted transition hover:border-border-strong">
                    <Folder className="h-5 w-5" /><span className="line-clamp-2 text-center text-[9px] leading-tight">{f.name}</span>
                  </button>
                ) : (
                  <button key={f.id} type="button" onClick={() => onPick(driveRaw(f.id))} title={f.name} className="aspect-square overflow-hidden rounded-lg border border-border bg-surface transition hover:border-accent-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={driveRaw(f.id)} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
                {!driveLoading && drive && drive.length === 0 && <p className="col-span-3 py-6 text-center text-[11px] text-foreground-faint">{driveErr ?? "Pasta vazia."}</p>}
              </div>
            </div>
          )}

          {tab === "skatehive" && (
            <div>
              <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                <input value={shUser} onChange={(e) => setShUser(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void loadSh(shUser); } }}
                  placeholder="@usuário (vazio = comunidade)" className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:outline-none" />
                <button type="button" onClick={() => void loadSh(shUser)} className="rounded px-2 py-1 text-[11px] text-accent hover:bg-accent-bg">Buscar</button>
              </div>
              {grid(sh?.map((s) => ({ url: s.url, alt: s.title })) ?? null, shLoading, shErr ?? "Nenhuma imagem.")}
            </div>
          )}

          {tab === "url" && (
            <div className="space-y-2">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitUrl(); } }}
                  placeholder="Colar URL de imagem (https://…)" className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:outline-none" />
              </div>
              <button type="button" onClick={submitUrl} disabled={!urlInput.trim()} className="w-full rounded-lg border border-accent-border bg-accent-bg py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">Usar esta imagem</button>
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
