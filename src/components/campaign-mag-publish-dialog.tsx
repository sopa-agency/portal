"use client";

import { useEffect, useState } from "react";
import { Loader2, X, ExternalLink, Flame, ImageOff, Send, Globe, Tag, Users, Languages } from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import { getHiveMagPostPreview } from "@/app/actions/campaigns";

type Preview = Extract<Awaited<ReturnType<typeof getHiveMagPostPreview>>, { ok: true }>;

type Props = {
  open: boolean;
  documentId: string;
  publishing: boolean;
  /** Result of the publish attempt (from the parent's send transition). */
  result: null | { ok: true; url?: string } | { ok: false; error: string };
  onClose: () => void;
  onConfirm: () => void;
};

export function CampaignMagPublishDialog({ open, documentId, publishing, result, onClose, onConfirm }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setLoadError(null);
    getHiveMagPostPreview(documentId)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setPreview(r);
        else setLoadError(r.error);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  if (!open) return null;

  const published = result?.ok ? result.url : undefined;
  const publishError = result && !result.ok ? result.error : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15">
              <Flame className="h-4 w-4 text-red-400" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Publish Hive blog (mag post)</h2>
              <p className="text-xs text-foreground-subtle">Review exactly what will be posted — this is public and permanent.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-12 text-foreground-muted">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Building preview…</p>
            </div>
          )}

          {loadError && !loading && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              <p className="font-semibold">Could not build preview</p>
              <p className="mt-1 text-xs">{loadError}</p>
            </div>
          )}

          {preview && !loading && (
            <div className="space-y-4">
              {/* Success banner */}
              {published && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                  <p className="text-sm font-medium text-success">Published to Hive ✓</p>
                  <a
                    href={published}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-success/40 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/10"
                  >
                    View post <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {/* Thumbnail */}
              {preview.thumbnail ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={preview.thumbnail}
                  alt="Post thumbnail"
                  className="max-h-56 w-full rounded-xl border border-border object-cover"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-xs text-foreground-faint">
                  <ImageOff className="h-4 w-4" /> No image in the post body
                </div>
              )}

              {/* Title */}
              <h3 className="text-xl font-bold leading-tight text-foreground">{preview.title}</h3>

              {/* Metadata grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 text-sm">
                <MetaRow icon={<Send className="h-3.5 w-3.5" />} label="Author">
                  {preview.account ? (
                    <span className="font-mono">@{preview.account}</span>
                  ) : (
                    <span className="text-danger">no posting account set</span>
                  )}
                </MetaRow>
                <MetaRow icon={<Globe className="h-3.5 w-3.5" />} label="Community">
                  <span className="font-mono">{preview.community}</span>
                </MetaRow>
                <MetaRow icon={<Tag className="h-3.5 w-3.5" />} label="Tags">
                  <span className="flex flex-wrap gap-1">
                    {preview.tags.map((t) => (
                      <span key={t} className="rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-foreground-muted">
                        {t}
                      </span>
                    ))}
                  </span>
                </MetaRow>
                <MetaRow icon={<ImageOff className="h-3.5 w-3.5" />} label="Images">
                  {preview.images.length} embedded
                </MetaRow>
                <MetaRow icon={<Users className="h-3.5 w-3.5" />} label="Beneficiaries">
                  {preview.beneficiaries.length === 0 ? (
                    <span className="text-foreground-subtle">none</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {preview.beneficiaries.map((b) => (
                        <span key={b.account} className="rounded-full bg-accent-bg px-2 py-0.5 text-[11px] text-accent">
                          @{b.account} {(b.weight / 100).toFixed(0)}%
                        </span>
                      ))}
                    </span>
                  )}
                </MetaRow>
                <MetaRow icon={<Languages className="h-3.5 w-3.5" />} label="PT translation">
                  {preview.hasPtTranslation ? "included" : "—"}
                </MetaRow>
              </dl>

              {/* Body preview */}
              <div>
                <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">Body preview</p>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-4">
                  <MarkdownContent markdown={preview.bodyMarkdown} />
                </div>
              </div>

              {publishError && !published && (
                <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                  <p className="font-semibold">Publish failed</p>
                  <p className="mt-1 text-xs">{publishError}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {published ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={publishing}
                className="rounded-lg border border-border bg-foreground/5 px-3 py-2 text-sm text-foreground-muted hover:bg-foreground/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={publishing || loading || !!loadError || !preview?.account}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flame className="h-4 w-4" />}
                {publishing ? "Publishing…" : "Confirm & publish"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function MetaRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-foreground-subtle">
        {icon}
        {label}
      </dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
