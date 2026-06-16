"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X, Trash2, Loader2, ImagePlus } from "lucide-react";
import {
  type BoardCard,
  createCard,
  updateCard,
  deleteCard,
  signSopaLogoUpload,
} from "@/app/actions/sopa-boards";

/** Direct browser→Pinata logo upload via the SOPA-scoped signed URL (the shared
 *  post-creator uploader requires Post Creator, which SOPA doesn't have). */
async function uploadLogo(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signSopaLogoUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata upload HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function SopaPortfolio({ initial }: { initial: BoardCard[] }) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [editing, setEditing] = useState<BoardCard | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(
    id: string | null,
    title: string,
    body: string,
    logoUrl: string | null,
  ) {
    startTransition(async () => {
      if (id) {
        const updated = await updateCard(id, { title, body, logoUrl });
        setCards((prev) => prev.map((c) => (c.id === id ? updated : c)));
      } else {
        const created = await createCard({
          board: "portfolio",
          title,
          body,
          logoUrl: logoUrl ?? undefined,
        });
        setCards((prev) => [...prev, created]);
      }
      setEditing(null);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCard(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
      setEditing(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            SOPA
          </p>
          <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
        </div>
        <div className="flex items-center gap-3">
          {pending && (
            <span className="flex items-center gap-1.5 text-xs text-foreground-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> salvando…
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo card
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-foreground-muted">
            Nenhum card ainda. Crie o primeiro com “Novo card”.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition hover:border-border-strong"
            >
              {c.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logoUrl}
                  alt=""
                  className="mb-3 h-12 w-12 rounded-lg border border-border bg-surface-elevated object-contain p-1"
                />
              )}
              <span className="text-base font-semibold text-foreground">{c.title}</span>
              {c.body && (
                <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-foreground-muted">
                  {c.body}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <PortfolioDialog
          card={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          busy={pending}
        />
      )}
    </div>
  );
}

function PortfolioDialog({
  card,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  card: BoardCard | null;
  onClose: () => void;
  onSave: (id: string | null, title: string, body: string, logoUrl: string | null) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [body, setBody] = useState(card?.body ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(card?.logoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const canSave = title.trim().length > 0;

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    const res = await uploadLogo(file);
    setUploading(false);
    if (res.ok) setLogoUrl(res.url);
    else setUploadErr(res.error);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {card ? "Editar card" : "Novo card"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-foreground-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Logo</label>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <ImagePlus className="h-5 w-5 text-foreground-faint" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
            <button
              type="button"
              disabled={uploading || busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {logoUrl ? "Trocar logo" : "Enviar logo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl(null)}
                className="w-fit text-[11px] text-foreground-muted hover:text-danger"
              >
                Remover
              </button>
            )}
          </div>
        </div>
        {uploadErr && <p className="mb-3 text-xs text-danger">{uploadErr}</p>}

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Título</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Detalhes</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Descrição, resultado, links…"
          className="mb-4 w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        <div className="flex items-center justify-between">
          {card ? (
            confirmDel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(card.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Confirmar exclusão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground-muted hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            )
          ) : (
            <span />
          )}

          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => onSave(card?.id ?? null, title, body, logoUrl)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
