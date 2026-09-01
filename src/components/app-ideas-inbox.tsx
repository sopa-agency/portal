"use client";

// Fila de triagem dos pedidos que chegam pelo /app-idea.
//
// Mínimo viável de propósito: ler, mudar de estado, e nada mais. Um CRUD aqui
// seria construir a ferramenta em vez de atender o pedido — e o texto é o
// produto, então a tela é feita pra ele caber inteiro.

import { useState, useTransition } from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { type AppIdeaRow, setAppIdeaStatus } from "@/app/actions/app-ideas";
import { labelFor, statusLabel, type IdeaStatus } from "@/lib/app-idea-options";

const NEXT: { to: IdeaStatus; label: string }[] = [
  { to: "new", label: "novo" },
  { to: "talking", label: "conversando" },
  { to: "done", label: "fechado" },
  { to: "archived", label: "arquivar" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Tudo que um visitante anônimo digitou renderiza como texto puro, nunca HTML. */
function IdeaCard({ idea, onSet, busy }: { idea: AppIdeaRow; onSet: (s: IdeaStatus) => void; busy: boolean }) {
  const [open, setOpen] = useState(idea.status === "new");
  const quiet = idea.status === "done" || idea.status === "archived";

  return (
    <article
      className={`rounded-2xl border p-4 transition-colors ${
        quiet ? "border-border bg-surface opacity-60" : "border-accent-border bg-surface-elevated"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{idea.name}</h3>
          <p className="mt-0.5 truncate text-sm text-foreground-muted">{idea.contact}</p>
        </div>
        <div className="flex items-center gap-2">
          <time className="whitespace-nowrap text-xs text-foreground-faint">{when(idea.createdAt)}</time>
          <select
            value={idea.status}
            disabled={busy}
            onChange={(e) => onSet(e.target.value as IdeaStatus)}
            aria-label="estado da triagem"
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
          >
            {NEXT.map((s) => (
              <option key={s.to} value={s.to}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(["kind", "audience", "existing", "urgency", "budget"] as const).map((q) => (
          <span key={q} className="rounded-full bg-accent-bg px-2.5 py-0.5 text-xs text-accent">
            {labelFor(q, idea[q])}
          </span>
        ))}
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground-subtle">
          {statusLabel(idea.status)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground-subtle hover:text-foreground"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "esconder o pedido" : "ler o pedido"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">{idea.pitch}</p>
          <p className="text-sm text-foreground-muted">
            <span className="font-medium text-foreground">Funcionou quando: </span>
            {idea.successCriteria}
          </p>
          {idea.references.trim() && (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground-muted">
              <span className="font-medium text-foreground">Referências: </span>
              {idea.references}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function AppIdeasInbox({ initial, error }: { initial: AppIdeaRow[]; error?: string }) {
  const [ideas, setIdeas] = useState<AppIdeaRow[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function move(idea: AppIdeaRow, status: IdeaStatus) {
    setBusyId(idea.id);
    startTransition(async () => {
      const res = await setAppIdeaStatus(idea.id, status);
      setBusyId(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, status } : i)));
    });
  }

  const live = ideas.filter((i) => i.status === "new" || i.status === "talking");
  const closed = ideas.filter((i) => i.status === "done" || i.status === "archived");

  return (
    <section className="mt-10">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Lightbulb className="h-4 w-4 text-accent" /> Pedidos de app
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Chegam pelo formulário público em <code className="text-foreground-subtle">/app-idea</code>.{" "}
          {live.length} aberto{live.length === 1 ? "" : "s"}.
        </p>
      </header>

      {/* Falha de leitura NÃO vira "nenhum pedido". São notícias diferentes. */}
      {error ? (
        <p className="rounded-2xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>
      ) : ideas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-foreground-muted">Nenhum pedido ainda.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {live.map((i) => (
            <IdeaCard key={i.id} idea={i} busy={busyId === i.id} onSet={(s) => move(i, s)} />
          ))}
          {closed.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-medium uppercase tracking-wider text-foreground-faint">
                Fechados e arquivados ({closed.length})
              </h3>
              {closed.map((i) => (
                <IdeaCard key={i.id} idea={i} busy={busyId === i.id} onSet={(s) => move(i, s)} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
