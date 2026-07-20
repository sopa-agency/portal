"use client";

import { useState, useTransition } from "react";
import { Briefcase, Plus, Pencil, Trash2, Check, X, Loader2, Link2 } from "lucide-react";
import {
  createSopaJob,
  updateSopaJob,
  deleteSopaJob,
  type SopaJobDTO,
  type JobStatus,
} from "@/app/actions/sopa-jobs";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export type OnchainShare = {
  key: string;
  projectName: string;
  label: string;
  /** Gross that passed through the split. */
  realizedUsd: number;
  /** SOPA's cut, read from the split's own config on-chain. Null = unreadable. */
  sopaShare: number | null;
  /** Every recipient, so the page can show where the other half goes. */
  recipients: { address: string; share: number; label: string }[];
};

type Draft = { client: string; amountUsd: string; occurredOn: string; status: JobStatus; description: string };

const emptyDraft = (): Draft => ({
  client: "",
  amountUsd: "",
  occurredOn: new Date().toISOString().slice(0, 10),
  status: "paid",
  description: "",
});

function JobForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  return (
    <div className="space-y-2 rounded-lg border border-accent-border bg-accent-bg/40 p-2.5">
      <div className="flex flex-wrap gap-2">
        <input
          value={d.client}
          onChange={(e) => setD({ ...d, client: e.target.value })}
          placeholder="Cliente / job (ex: Venice bot)"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <input
          value={d.amountUsd}
          onChange={(e) => setD({ ...d, amountUsd: e.target.value })}
          inputMode="decimal"
          placeholder="USD"
          className="w-24 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border-strong focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={d.occurredOn}
          onChange={(e) => setD({ ...d, occurredOn: e.target.value })}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <select
          value={d.status}
          onChange={(e) => setD({ ...d, status: e.target.value as JobStatus })}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        >
          <option value="paid">Pago</option>
          <option value="pending">A receber</option>
        </select>
      </div>
      <input
        value={d.description}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        placeholder="Descrição / escopo (opcional)"
        className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
        <button
          type="button"
          onClick={() => onSave(d)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salvar
        </button>
      </div>
    </div>
  );
}

// "Receita da SOPA": the agency's own income — client jobs (manual, editable)
// plus its on-chain share of the brand swap splits (computed, read-only).
export function SopaRevenuePanel({
  initialJobs,
  canEdit,
  onchainShare,
}: {
  initialJobs: SopaJobDTO[];
  canEdit: boolean;
  onchainShare: OnchainShare[];
}) {
  const [jobs, setJobs] = useState<SopaJobDTO[]>(initialJobs);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Only count a split whose config we could actually read. An unreadable split
  // contributes nothing rather than being guessed at a default share.
  const shareTotal = onchainShare.reduce((s, o) => s + o.realizedUsd * (o.sopaShare ?? 0), 0);
  const unreadable = onchainShare.filter((o) => o.sopaShare == null).length;
  const jobsPaid = jobs.filter((j) => j.status === "paid").reduce((s, j) => s + j.amountUsd, 0);
  const jobsPending = jobs.filter((j) => j.status === "pending").reduce((s, j) => s + j.amountUsd, 0);
  const realizedTotal = shareTotal + jobsPaid;

  const doCreate = (d: Draft) =>
    start(async () => {
      setErr(null);
      const res = await createSopaJob({
        client: d.client,
        amountUsd: Number(d.amountUsd),
        occurredOn: d.occurredOn,
        status: d.status,
        description: d.description,
      });
      if (res.ok) {
        setJobs((prev) => [res.job, ...prev].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)));
        setAdding(false);
      } else setErr(res.error);
    });

  const doUpdate = (id: string, d: Draft) =>
    start(async () => {
      setErr(null);
      const res = await updateSopaJob(id, {
        client: d.client,
        amountUsd: Number(d.amountUsd),
        occurredOn: d.occurredOn,
        status: d.status,
        description: d.description,
      });
      if (res.ok) {
        setJobs((prev) => prev.map((j) => (j.id === id ? res.job : j)).sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)));
        setEditId(null);
      } else setErr(res.error);
    });

  const doDelete = (id: string) =>
    start(async () => {
      setErr(null);
      const res = await deleteSopaJob(id);
      if (res.ok) setJobs((prev) => prev.filter((j) => j.id !== id));
      else setErr(res.error);
    });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Briefcase className="h-4 w-4 text-accent" /> Receita da SOPA
          </h2>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Receita da agência: jobs de clientes + a fatia on-chain dos swap splits das marcas.
          </p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Recebido</div>
            <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">{usd(realizedTotal)}</div>
          </div>
          {jobsPending > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground-faint">A receber</div>
              <div className="text-base font-semibold text-warning">{usd(jobsPending)}</div>
            </div>
          )}
        </div>
      </div>

      {/* On-chain agency share of the brand swap splits (read-only, computed). */}
      {onchainShare.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Link2 className="h-3.5 w-3.5" /> Participação on-chain nos swaps
          </h3>
          <p className="mb-2.5 text-[11px] text-foreground-faint">
            A taxa de cada swap cai num split contract que divide entre a SOPA e o tesouro da marca. As fatias abaixo são lidas do
            próprio contrato — não são um valor assumido.
          </p>
          <ul className="space-y-2.5">
            {onchainShare.map((o) => (
              <li key={o.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-foreground-muted">
                    <span className="font-medium text-foreground">{o.projectName}</span>
                    <span className="text-foreground-faint"> · {o.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {o.sopaShare == null ? (
                      <span className="text-warning">divisão não lida</span>
                    ) : (
                      <>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(o.realizedUsd * o.sopaShare)}</span>
                        <span className="ml-1.5 text-[10px] text-foreground-faint">de {usd(o.realizedUsd)} distribuídos</span>
                      </>
                    )}
                  </span>
                </div>
                {/* Where the whole fee goes — both halves, not just ours. */}
                {o.recipients.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
                    {o.recipients.map((r) => (
                      <span
                        key={r.address}
                        title={r.address}
                        className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                          r.label === "SOPA" ? "bg-accent-bg text-accent" : "bg-surface-elevated text-foreground-faint"
                        }`}
                      >
                        {r.label} {Math.round(r.share * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t border-border pt-1.5 text-xs">
              <span className="font-medium text-foreground-muted">Subtotal on-chain</span>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{usd(shareTotal)}</span>
            </li>
          </ul>
          {unreadable > 0 && (
            <p className="mt-2 text-[11px] text-warning">
              {unreadable === 1 ? "1 split não teve" : `${unreadable} splits não tiveram`} a divisão lida on-chain e{" "}
              {unreadable === 1 ? "ficou" : "ficaram"} fora do subtotal — melhor faltar do que chutar.
            </p>
          )}
        </div>
      )}

      {/* Jobs — manual, editable. */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Briefcase className="h-3.5 w-3.5" /> Jobs · {usd(jobsPaid)}
            {jobsPending > 0 && <span className="text-warning"> +{usd(jobsPending)} a receber</span>}
          </h3>
          {canEdit && !adding && editId === null && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar job
            </button>
          )}
        </div>

        {err && <p className="mb-2 text-[11px] text-danger">{err}</p>}

        {adding && (
          <div className="mb-2">
            <JobForm initial={emptyDraft()} busy={pending} onSave={doCreate} onCancel={() => setAdding(false)} />
          </div>
        )}

        {jobs.length === 0 && !adding ? (
          <p className="py-6 text-center text-xs text-foreground-faint">
            Nenhum job ainda.{canEdit ? " Adicione o primeiro (ex: Venice bot)." : ""}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {jobs.map((j) =>
              editId === j.id ? (
                <li key={j.id}>
                  <JobForm
                    initial={{
                      client: j.client,
                      amountUsd: String(j.amountUsd),
                      occurredOn: j.occurredOn,
                      status: j.status,
                      description: j.description ?? "",
                    }}
                    busy={pending}
                    onSave={(d) => doUpdate(j.id, d)}
                    onCancel={() => setEditId(null)}
                  />
                </li>
              ) : (
                <li
                  key={j.id}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{j.client}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                          j.status === "paid" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-warning/15 text-warning"
                        }`}
                      >
                        {j.status === "paid" ? "pago" : "a receber"}
                      </span>
                    </div>
                    {j.description && <p className="truncate text-[11px] text-foreground-subtle">{j.description}</p>}
                    <p className="text-[10px] text-foreground-faint">{fmtDate(j.occurredOn)}</p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      j.status === "paid" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground-muted"
                    }`}
                  >
                    {usd(j.amountUsd)}
                  </span>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditId(j.id)}
                        aria-label="Editar job"
                        className="rounded-md p-1 text-foreground-faint hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => doDelete(j.id)}
                        aria-label="Remover job"
                        className="rounded-md p-1 text-foreground-faint hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
