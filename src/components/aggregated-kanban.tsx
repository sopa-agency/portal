"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, X, CalendarPlus, Coins, Loader2, Trash2 } from "lucide-react";
import type { AggregatedColumn, AggregatedItem } from "@/lib/github-project";
import { createBounty, cancelBounty, proposeBountyPayment, markBountyPaid, type BountyDTO } from "@/app/actions/bounty";

/** Stable handle for a task across reloads: GitHub node id, then url, then item id. */
function taskKeyOf(it: AggregatedItem): string {
  return it.contentId ?? it.url ?? it.id;
}

// Read-only aggregated board for the SOPA hub: every portal's Kanban merged by
// status. Cards open a details dialog; from there you can create an EXEC meeting
// pre-filled with the task + its assignees, or (global admins) turn it into a
// bounty paid from the project's Safe.
export function AggregatedKanban({
  columns,
  bounties,
  canManage,
}: {
  columns: AggregatedColumn[];
  bounties: BountyDTO[];
  canManage: boolean;
}) {
  const [active, setActive] = useState<AggregatedItem | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const byKey = new Map(bounties.map((b) => [b.taskKey, b]));
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  if (total === 0) {
    return <p className="text-sm text-foreground-muted">Nenhuma tarefa nos boards (ou tokens do GitHub indisponíveis).</p>;
  }
  const isDone = (name: string) => /done|conclu|complete|finaliz/i.test(name);
  const doneCount = columns.filter((c) => isDone(c.name)).reduce((n, c) => n + c.items.length, 0);
  const boards = [...new Set(columns.flatMap((c) => c.items.map((i) => i.board)))].sort();
  const match = (it: AggregatedItem) => !board || it.board === board;
  const visible = columns
    .filter((c) => showDone || !isDone(c.name))
    .map((c) => ({ ...c, items: c.items.filter(match) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Project filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Projeto:</span>
        <button type="button" onClick={() => setBoard(null)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === null ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
          Todos <span className="text-foreground-faint">({total})</span>
        </button>
        {boards.map((b) => {
          const n = columns.reduce((s, c) => s + c.items.filter((i) => i.board === b).length, 0);
          return (
            <button key={b} type="button" onClick={() => setBoard(b)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${board === b ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
              {b} <span className="text-foreground-faint">({n})</span>
            </button>
          );
        })}
        {doneCount > 0 && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${showDone ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong"}`}>
            {showDone ? "Ocultar concluídas" : "Mostrar concluídas"} <span className="text-foreground-faint">({doneCount})</span>
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {visible.map((col) => (
        <section key={col.name} className="flex w-72 shrink-0 flex-col rounded-xl border border-border bg-surface">
          <header className="sticky top-0 flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <span className="truncate text-sm font-semibold text-foreground">{col.name}</span>
            <span className="shrink-0 rounded-full bg-foreground/10 px-1.5 text-[10px] text-foreground-muted">{col.items.length}</span>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {col.items.map((it) => {
              const bounty = byKey.get(taskKeyOf(it));
              return (
              <button
                key={it.id}
                type="button"
                onClick={() => setActive(it)}
                className="block w-full rounded-lg border border-border bg-surface-elevated p-2.5 text-left transition-colors hover:border-border-strong"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">{it.board}</span>
                  {it.number ? <span className="text-[10px] text-foreground-faint">#{it.number}</span> : null}
                  {bounty && <BountyBadge bounty={bounty} />}
                </div>
                <p className="line-clamp-3 text-sm text-foreground">{it.title}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {it.labels.slice(0, 3).map((l) => (
                    <span key={l.name} className="rounded px-1 text-[9px]" style={{ backgroundColor: `#${l.color}22`, color: `#${l.color}` }}>{l.name}</span>
                  ))}
                  <span className="ml-auto flex -space-x-1.5">
                    {it.assignees.slice(0, 4).map((a) => (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img key={a.login} src={a.avatarUrl} alt={a.login} title={a.login} className="h-4 w-4 rounded-full border border-surface object-cover" />
                    ))}
                  </span>
                </div>
              </button>
              );
            })}
          </div>
        </section>
      ))}
      </div>
      {active && (
        <TaskDialog
          item={active}
          bounty={byKey.get(taskKeyOf(active))}
          canManage={canManage}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function BountyBadge({ bounty }: { bounty: BountyDTO }) {
  const tone =
    bounty.status === "paid"
      ? "border-success/40 bg-success/10 text-success"
      : bounty.status === "proposed"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <span className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}>
      <Coins className="h-2.5 w-2.5" /> {bounty.amount} {bounty.tokenSymbol}
    </span>
  );
}

function TaskDialog({
  item,
  bounty,
  canManage,
  onClose,
}: {
  item: AggregatedItem;
  bounty: BountyDTO | undefined;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState(bounty?.payeeAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function createExecMeeting() {
    const prefill = {
      title: item.title,
      forProject: item.projectSlug,
      kind: "exec" as const,
      notes: item.body ?? "",
      logins: item.assignees.map((a) => a.login),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(prefill))));
    router.push(`/reunioes?new=${encodeURIComponent(b64)}`);
  }

  async function makeBounty() {
    setBusy(true); setMsg(null);
    const r = await createBounty({ projectSlug: item.projectSlug, taskKey: taskKeyOf(item), title: item.title, amount });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Bounty criado ✅" }); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function propose() {
    if (!bounty) return;
    setBusy(true); setMsg(null);
    const r = await proposeBountyPayment(bounty.id, payee);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Pagamento proposto no Safe ✅ — aguarda aprovação dos owners." }); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function cancel() {
    if (!bounty) return;
    setBusy(true); setMsg(null);
    const r = await cancelBounty(bounty.id);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Bounty cancelado." }); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  }

  async function markPaid() {
    if (!bounty) return;
    setBusy(true); setMsg(null);
    const r = await markBountyPaid(bounty.id);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Marcado como pago ✅" }); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{item.board}</span>
              {item.number ? <span className="text-xs text-foreground-faint">#{item.number}</span> : null}
              {bounty && <BountyBadge bounty={bounty} />}
            </div>
            <h3 className="text-base font-bold text-foreground">{item.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {item.assignees.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Responsáveis</span>
            <span className="flex flex-wrap items-center gap-1">
              {item.assignees.map((a) => (
                <span key={a.login} className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                  {a.login}
                </span>
              ))}
            </span>
          </div>
        )}

        {item.body ? (
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-elevated p-3 text-sm text-foreground-muted">{item.body}</div>
        ) : null}

        {/* Bounty panel */}
        {(bounty || canManage) && (
          <div className="space-y-2 rounded-xl border border-border bg-surface-elevated p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Coins className="h-3.5 w-3.5 text-amber-500" /> Bounty
            </div>
            {msg && <p className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}

            {!bounty && canManage && (
              <div className="flex items-end gap-2">
                <label className="flex-1 text-xs text-foreground-muted">Valor
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="ex.: 100" className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:border-border-strong focus:outline-none" />
                </label>
                <button type="button" onClick={makeBounty} disabled={busy || !amount.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Transformar em bounty"}
                </button>
              </div>
            )}

            {bounty && bounty.status === "open" && (
              <div className="space-y-2">
                <p className="text-xs text-foreground-muted">Reservado: <span className="font-semibold text-foreground">{bounty.amount} {bounty.tokenSymbol}</span>. Ao concluir, proponha o pagamento no Safe do projeto.</p>
                {canManage && (
                  <>
                    <label className="block text-xs text-foreground-muted">Carteira do beneficiário
                      <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x… (carteira de quem entregou)" className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-foreground focus:border-border-strong focus:outline-none" />
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={propose} disabled={busy || !payee.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Propor pagamento no Safe
                      </button>
                      <button type="button" onClick={cancel} disabled={busy} title="Cancelar bounty" className="rounded-lg border border-border p-2 text-foreground-faint hover:border-danger hover:text-danger disabled:opacity-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {bounty && bounty.status === "proposed" && (
              <div className="text-xs text-foreground-muted">
                <p className="text-warning">Pagamento proposto no Safe — aguardando aprovação dos owners.</p>
                {bounty.payeeAddress && <p className="mt-1 font-mono text-[11px]">→ {bounty.payeeAddress}</p>}
                {bounty.safeTxHash && <p className="mt-0.5 truncate font-mono text-[10px] text-foreground-faint">{bounty.safeTxHash}</p>}
                {canManage && (
                  <button type="button" onClick={markPaid} disabled={busy} className="mt-2 rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/20 disabled:opacity-50">
                    {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Marcar como pago"}
                  </button>
                )}
              </div>
            )}

            {bounty && bounty.status === "paid" && (
              <p className="text-xs text-success">Pago ✅ {bounty.payeeAddress ? `→ ${bounty.payeeAddress}` : ""}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={createExecMeeting} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90">
            <CalendarPlus className="h-4 w-4" /> Criar reunião EXEC
          </button>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-foreground-muted hover:border-border-strong hover:text-foreground">
              <ExternalLink className="h-4 w-4" /> Abrir no GitHub
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
