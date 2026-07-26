"use client";

import { useState, useTransition } from "react";
import { Check, Inbox, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { type Brief, setBriefHandled } from "@/app/actions/sopa-briefs";
import { Toaster } from "@/components/studio/ui/sonner";

// Briefs sent from the public SOPA site's contact form. Pending ones come
// first; "cuidei disso" moves a brief out of the queue without deleting it —
// the row stays as the record of the lead.

function when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Anything typed by an anonymous visitor renders as plain text, never HTML. */
function BriefCard({ brief, onToggle, busy }: { brief: Brief; onToggle: () => void; busy: boolean }) {
  return (
    <article
      className={`rounded-2xl border p-4 transition-colors ${
        brief.handled ? "border-border bg-surface opacity-60" : "border-accent-border bg-surface-elevated"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{brief.name}</h3>
          <p className="mt-0.5 truncate text-sm text-foreground-muted">{brief.contact}</p>
        </div>
        <div className="flex items-center gap-3">
          <time className="whitespace-nowrap text-xs text-foreground-faint">{when(brief.createdAt)}</time>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : brief.handled ? (
              <Undo2 className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {brief.handled ? "reabrir" : "cuidei disso"}
          </button>
        </div>
      </div>

      {(brief.types.length > 0 || brief.budget || brief.deadline) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {brief.types.map((t) => (
            <span key={t} className="rounded-full bg-accent-bg px-2.5 py-0.5 text-xs text-accent">
              {t}
            </span>
          ))}
          {(brief.budget || brief.deadline) && (
            <span className="text-xs text-foreground-faint">
              {brief.budget ?? "—"} · {brief.deadline ?? "—"}
            </span>
          )}
        </div>
      )}

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">{brief.message}</p>
    </article>
  );
}

export function SopaBriefs({ initial }: { initial: Brief[] }) {
  const [briefs, setBriefs] = useState<Brief[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(brief: Brief) {
    setBusyId(brief.id);
    startTransition(async () => {
      const res = await setBriefHandled(brief.id, !brief.handled);
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBriefs((prev) => prev.map((b) => (b.id === brief.id ? { ...b, handled: !b.handled } : b)));
    });
  }

  const pending = briefs.filter((b) => !b.handled);
  const handled = briefs.filter((b) => b.handled);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Toaster />
      <header className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Briefs</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Chegam pelo formulário do site público. {pending.length} pendente{pending.length === 1 ? "" : "s"}.
        </p>
      </header>

      {briefs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-foreground-faint" />
          <p className="mt-3 text-sm text-foreground-muted">Nenhum brief ainda.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((b) => (
            <BriefCard key={b.id} brief={b} busy={busyId === b.id} onToggle={() => toggle(b)} />
          ))}

          {handled.length > 0 && (
            <>
              <h2 className="mt-4 text-xs font-medium uppercase tracking-wider text-foreground-faint">
                Já cuidados ({handled.length})
              </h2>
              {handled.map((b) => (
                <BriefCard key={b.id} brief={b} busy={busyId === b.id} onToggle={() => toggle(b)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
