"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, X, ExternalLink, ImageOff, BookUp, Globe, Mail, Users, Check, AlertTriangle } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";

export type ParagraphPreview = {
  title: string;
  markdown: string;
  imageUrl?: string;
  publication: string;
  publicationSlug: string;
  subscribers: number;
};
export type ParagraphSendResult = { url: string; published: boolean; emailed: boolean };

type Preview = ParagraphPreview;
type SendResult = ParagraphSendResult;

type Props = {
  /** Loads the preview (title/cover/body + subscriber count). Source-agnostic:
   *  a Hive post (blog tab) or a campaign document (campaign creator). */
  loadPreview: () => Promise<({ ok: true } & ParagraphPreview) | { ok: false; error: string }>;
  onSend: (opts: { publish: boolean; sendNewsletter: boolean }) => Promise<({ ok: true } & ParagraphSendResult) | { ok: false; error: string }>;
  onClose: () => void;
  onDone: (r: SendResult) => void;
};

export function ParagraphPublishDialog({ loadPreview, onSend, onClose, onDone }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendNewsletter, setSendNewsletter] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [done, setDone] = useState<SendResult | null>(null);
  const [busy, startSend] = useTransition();
  // Which action is in flight (so we can show the spinner on the right button).
  const [pending, setPending] = useState<"draft" | "publish" | null>(null);

  // Load the preview once when the dialog mounts (it is mounted fresh per open).
  useEffect(() => {
    let cancelled = false;
    loadPreview()
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setPreview(r);
        else setLoadError(r.error);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (publish: boolean) => {
    setPending(publish ? "publish" : "draft");
    startSend(async () => {
      setSendError(null);
      const res = await onSend({ publish, sendNewsletter });
      if (res.ok) { setDone(res); onDone(res); }
      else setSendError(res.error);
      setPending(null);
    });
  };

  const subs = preview?.subscribers ?? 0;
  const willEmail = sendNewsletter && subs > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg">
              <BookUp className="h-4 w-4 text-accent" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Enviar pro Paragraph</h2>
              <p className="text-xs text-foreground-subtle">Revise exatamente o que vai ser postado — e quem recebe por email.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-foreground-muted">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Montando o preview…</p>
            </div>
          )}

          {loadError && !loading && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <p className="font-semibold">Não consegui montar o preview</p>
              <p className="mt-1 text-xs">{loadError}</p>
            </div>
          )}

          {preview && !loading && (
            <div className="space-y-4">
              {done && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                  <p className="text-sm font-medium text-success">
                    {done.published ? (done.emailed ? `Publicado + email enviado a ${subs} inscritos ✓` : "Publicado no Paragraph ✓") : "Rascunho salvo no Paragraph ✓"}
                  </p>
                  <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-success/40 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/10">
                    Ver <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {/* Cover */}
              {preview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.imageUrl} alt="" className="max-h-56 w-full rounded-xl border border-border object-cover" />
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-xs text-foreground-faint">
                  <ImageOff className="h-4 w-4" /> Sem imagem de capa no post
                </div>
              )}

              <h3 className="text-xl font-bold leading-tight text-foreground">{preview.title}</h3>

              {/* Destination summary */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle"><Globe className="h-3.5 w-3.5" /> Publicação</span>
                  <span className="text-foreground">@{preview.publicationSlug || preview.publication}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle"><Users className="h-3.5 w-3.5" /> Inscritos</span>
                  <span className="text-foreground">{subs.toLocaleString("pt-BR")}</span>
                </div>
              </div>

              {/* Body preview */}
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">Preview do conteúdo</p>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-4">
                  <MarkdownContent markdown={preview.markdown} />
                </div>
              </div>

              {/* Email toggle */}
              <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${willEmail ? "border-warning/40 bg-warning/10" : "border-border bg-surface hover:border-border-strong"}`}>
                <input type="checkbox" checked={sendNewsletter} onChange={(e) => setSendNewsletter(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-warning)]" />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Mail className="h-4 w-4" /> Enviar por email aos inscritos</span>
                  <span className="text-xs text-foreground-muted">
                    {willEmail
                      ? <><AlertTriangle className="mr-1 inline h-3 w-3 text-warning" />Vai disparar email para {subs.toLocaleString("pt-BR")} inscritos. Não dá pra desfazer.</>
                      : "Só funciona ao publicar. Deixe desmarcado para não notificar ninguém por email."}
                  </span>
                </span>
              </label>

              {sendError && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  <p className="font-semibold">Falhou</p>
                  <p className="mt-1 text-xs">{sendError}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {done ? (
            <button type="button" onClick={onClose} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">Pronto</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="mr-auto rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground-muted hover:bg-foreground/10 disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => send(false)}
                disabled={busy || loading || !!loadError}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
              >
                {busy && pending === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookUp className="h-4 w-4" />}
                Salvar rascunho
              </button>
              <button
                type="button"
                onClick={() => send(true)}
                disabled={busy || loading || !!loadError}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${willEmail ? "bg-warning text-black" : "bg-accent text-accent-foreground"}`}
              >
                {busy && pending === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : willEmail ? <Mail className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                {willEmail ? `Publicar + email (${subs})` : "Publicar"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
