"use client";

import { useState, useTransition } from "react";
import { Briefcase, Plus, Pencil, Trash2, Check, X, Loader2, Link2, ExternalLink } from "lucide-react";
import {
  createSopaJob,
  updateSopaJob,
  deleteSopaJob,
  type SopaJobDTO,
  type JobStatus,
} from "@/app/actions/sopa-jobs";
import { useConfirm } from "@/components/confirm-dialog";
import { usd } from "@/lib/format";
import { useLocale, useT } from "@/components/locale-provider";
import { agruparOnchainShare, subtotalOnchain, type OnchainShare } from "@/lib/onchain-share";

const fmtDate = (iso: string, intlLocale: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale, { day: "2-digit", month: "short", year: "numeric" });

// O tipo mora junto da regra de soma; a página continua importando daqui.
export type { OnchainShare };

/**
 * O contrato no explorer da 0xSplits.
 *
 * `chainId` é obrigatório lá: sem ele o explorer abre na rede errada e mostra
 * "conta não encontrada" para um contrato que existe. Rede nula (stream que não
 * declara cadeia) cai na Base, que é onde estes splits vivem.
 */
const CHAIN_IDS: Record<string, number> = { base: 8453, ethereum: 1, optimism: 10, arbitrum: 42161 };
function splitsExplorerUrl(address: string, chain: string | null): string {
  const id = (chain && CHAIN_IDS[chain]) || 8453;
  return `https://explorer.splits.org/accounts/${address}/?chainId=${id}`;
}

type Draft = { client: string; amountUsd: string; occurredOn: string; status: JobStatus; description: string; credit: string[] };

const emptyDraft = (): Draft => ({
  client: "",
  amountUsd: "",
  occurredOn: new Date().toISOString().slice(0, 10),
  status: "paid",
  description: "",
  credit: [],
});

function JobForm({
  initial,
  busy,
  roster,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  /** Quem pode ser creditado. Vazio = o seletor não aparece, em vez de uma
   *  fileira vazia que parece defeito. */
  roster: { username: string }[];
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const t = useT().treasury.agency;
  const [d, setD] = useState<Draft>(initial);
  return (
    <div className="space-y-2 rounded-lg border border-accent-border bg-accent-bg/40 p-2.5">
      {/* QUEM TROUXE o job. Mesma ideia dos streams no organograma: receita
          medida só vira mérito quando se sabe de quem ela veio. Elenco vazio
          esconde a linha inteira, em vez de mostrar uma fileira sem nada que
          parece defeito. */}
      {roster.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint">
            trouxe
          </span>
          {roster.map((m) => {
            const u = m.username.toLowerCase();
            const on = d.credit.includes(u);
            return (
              <button
                key={u}
                type="button"
                aria-pressed={on}
                onClick={() => setD({ ...d, credit: on ? d.credit.filter((x) => x !== u) : [...d.credit, u] })}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  on
                    ? "border-accent-border bg-accent-bg text-accent"
                    : "border-border text-foreground-faint hover:border-border-strong hover:text-foreground-muted"
                }`}
              >
                @{m.username}
              </button>
            );
          })}
          {d.credit.length > 1 && (
            <span className="ml-1 text-[10px] text-foreground-faint">dividido por igual entre {d.credit.length}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={d.client}
          onChange={(e) => setD({ ...d, client: e.target.value })}
          aria-label={t.clientLabel}
          placeholder={t.clientPlaceholder}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <input
          value={d.amountUsd}
          onChange={(e) => setD({ ...d, amountUsd: e.target.value })}
          inputMode="decimal"
          aria-label={t.amountLabel}
          placeholder="USD"
          className="w-24 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs tabular-nums text-foreground focus:border-border-strong focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          aria-label={t.dateLabel}
          value={d.occurredOn}
          onChange={(e) => setD({ ...d, occurredOn: e.target.value })}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        />
        <select
          aria-label={t.statusLabel}
          value={d.status}
          onChange={(e) => setD({ ...d, status: e.target.value as JobStatus })}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
        >
          <option value="paid">{t.statusPaid}</option>
          <option value="pending">{t.statusPending}</option>
        </select>
      </div>
      <input
        value={d.description}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        aria-label={t.descriptionLabel}
        placeholder={t.descriptionPlaceholder}
        className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground focus:border-border-strong focus:outline-none"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> {t.cancel}
        </button>
        <button
          type="button"
          onClick={() => onSave(d)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t.save}
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
  roster = [],
}: {
  initialJobs: SopaJobDTO[];
  canEdit: boolean;
  onchainShare: OnchainShare[];
  /** Quem pode ser creditado por um job. */
  roster?: { username: string }[];
}) {
  const { locale, t: dict } = useLocale();
  const t = dict.treasury.agency;
  const intlLocale = locale === "pt" ? "pt-BR" : "en-US";
  const [jobs, setJobs] = useState<SopaJobDTO[]>(initialJobs);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { confirm, confirmUI } = useConfirm();

  // Uma linha por CONTRATO, não por stream. Dois produtos do mesmo projeto
  // podem cobrar taxa no mesmo split (swaps.pro: "Swaps fees" e "Batch Send
  // Fees" caem em 0xeB29…3A36); a leitura é do contrato, então cada stream
  // voltava com o mesmo gross e a soma contava a pota duas vezes — $58.74 na
  // tela, $34.52 na cadeia. Agrupar mantém os dois rótulos à vista e o dinheiro
  // contado uma vez.
  const grupos = agruparOnchainShare(onchainShare);
  // Only count a split whose config we could actually read. An unreadable split
  // contributes nothing rather than being guessed at a default share.
  // Split não lido NÃO entra no subtotal — nem como zero. Somar um zero que na
  // verdade é "não sei" é como o subtotal virava $0 com distribuição acontecendo
  // nos quatro contratos. Um grupo com qualquer membro não lido é tratado igual.
  const naoLidos = grupos.filter((g) => g.naoLido);
  const shareTotal = subtotalOnchain(grupos);
  const unreadable = grupos.filter((g) => g.sopaShare == null).length;
  const jobsPaid = jobs.filter((j) => j.status === "paid").reduce((s, j) => s + j.amountUsd, 0);
  const jobsPending = jobs.filter((j) => j.status === "pending").reduce((s, j) => s + j.amountUsd, 0);
  const realizedTotal = shareTotal + jobsPaid;

  const doCreate = (d: Draft) =>
    start(async () => {
      setErr(null);
      const res = await createSopaJob({
        credit: d.credit,
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
        credit: d.credit,
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

  const doDelete = async (id: string) => {
    const j = jobs.find((x) => x.id === id);
    const okToDelete = await confirm({
      title: t.removeTitle,
      message: j ? t.removeMessage(j.client, usd(j.amountUsd)) : t.removeMessageGeneric,
      confirmLabel: t.remove,
    });
    if (!okToDelete) return;
    start(async () => {
      setErr(null);
      const res = await deleteSopaJob(id);
      if (res.ok) setJobs((prev) => prev.filter((x) => x.id !== id));
      else setErr(res.error);
    });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Briefcase className="h-4 w-4 text-accent" /> {t.title}
          </h2>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            {t.hint}
          </p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">{t.received}</div>
            <div className="text-base font-semibold text-success">{usd(realizedTotal)}</div>
          </div>
          {jobsPending > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground-faint">{t.receivable}</div>
              <div className="text-base font-semibold text-warning">{usd(jobsPending)}</div>
            </div>
          )}
        </div>
      </div>

      {/* On-chain agency share of the brand swap splits (read-only, computed). */}
      {onchainShare.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Link2 className="h-3.5 w-3.5" /> {t.onchainTitle}
          </h3>
          <p className="mb-2.5 text-[11px] text-foreground-faint">
            {t.onchainHint}
          </p>
          <ul className="space-y-2.5">
            {grupos.map((o) => (
              <li key={o.key} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-foreground-muted">
                    <span className="font-medium text-foreground">{o.projectName}</span>
                    {/* Todos os produtos que alimentam este contrato, lado a
                        lado. Esconder um deles leria como "sumiu um produto";
                        o que há é uma pota só, alimentada por dois. */}
                    <span className="text-foreground-faint" title={o.labels.length > 1 ? t.sharedPot : undefined}>
                      {" "}· {o.labels.join(" + ")}
                    </span>
                    {/* O contrato, conferível. A seção afirma "lido do contrato";
                        sem o link, a pessoa tem que acreditar na nossa palavra. */}
                    <a
                      href={splitsExplorerUrl(o.address, o.chain)}
                      target="_blank"
                      rel="noreferrer"
                      title={o.address}
                      className="ml-1.5 inline-flex translate-y-[1px] text-foreground-faint transition-colors hover:text-accent"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {o.sopaShare == null ? (
                      <span className="text-warning">{t.unreadShare}</span>
                    ) : o.naoLido ? (
                      // NÃO LIDO. Este era o bug: o indexador da Base devolvia
                      // 500, o zero descia até aqui e a tela o escrevia como
                      // "ainda não distribuiu" — em splits com 16, 5 e 3
                      // distribuições na cadeia. Zero de leitura falha nunca
                      // mais fala pela cadeia.
                      <span className="text-warning" title={o.realizedError}>{t.unreadRealized}</span>
                    ) : o.realizedUsd === 0 ? (
                      // "US$ 0,00 de US$ 0,00" é verdade e lê como fracasso.
                      // O split existe, a fatia está lida do contrato — o que
                      // não houve foi distribuição. São coisas diferentes e a
                      // linha diz qual das duas é.
                      <span className="text-foreground-subtle">{t.notDistributed}</span>
                    ) : (
                      <>
                        {/* Leitura parcial vira "pelo menos", não um total com
                            cara de exato. */}
                        {o.realizedError && (
                          <span className="mr-1 text-[10px] text-warning" title={o.realizedError}>{t.partial}</span>
                        )}
                        <span className="font-semibold text-success">{usd(o.realizedUsd * o.sopaShare)}</span>
                        <span className="ml-1.5 text-[10px] text-foreground-faint">{t.outOf(usd(o.realizedUsd))}</span>
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
              <span className="font-medium text-foreground-muted">{t.subtotal}</span>
              <span className="shrink-0 font-semibold tabular-nums text-success">{usd(shareTotal)}</span>
            </li>
          </ul>
          {naoLidos.length > 0 && (
            <p className="mt-2 text-[11px] text-warning">
              ⚠ {naoLidos.length === 1 ? "1 split não teve" : `${naoLidos.length} splits não tiveram`} as
              distribuições lidas e {naoLidos.length === 1 ? "ficou" : "ficaram"} fora do subtotal — isso NÃO
              quer dizer que não houve distribuição.
            </p>
          )}
          {unreadable > 0 && (
            <p className="mt-2 text-[11px] text-warning">
              {t.unreadable(unreadable)}
            </p>
          )}
        </div>
      )}

      {/* Jobs — manual, editable. */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            <Briefcase className="h-3.5 w-3.5" /> {t.jobs} · {usd(jobsPaid)}
            {jobsPending > 0 && <span className="text-warning">{t.jobsPending(usd(jobsPending))}</span>}
          </h3>
          {canEdit && !adding && editId === null && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-lime-400/30"
            >
              <Plus className="h-3.5 w-3.5" /> {t.addJob}
            </button>
          )}
        </div>

        {err && <p className="mb-2 text-[11px] text-danger">{err}</p>}

        {adding && (
          <div className="mb-2">
            <JobForm initial={emptyDraft()} busy={pending} roster={roster} onSave={doCreate} onCancel={() => setAdding(false)} />
          </div>
        )}

        {jobs.length === 0 && !adding ? (
          <p className="py-6 text-center text-xs text-foreground-faint">
            {t.empty}{canEdit ? t.emptyAdd : ""}
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
                      credit: j.credit ?? [],
                    }}
                    busy={pending}
                    roster={roster}
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
                          j.status === "paid" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                        }`}
                      >
                        {j.status === "paid" ? t.paid : t.pending}
                      </span>
                    </div>
                    {j.description && <p className="truncate text-[11px] text-foreground-subtle">{j.description}</p>}
                    <p className="text-[10px] text-foreground-faint">{fmtDate(j.occurredOn, intlLocale)}</p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      j.status === "paid" ? "text-success" : "text-foreground-muted"
                    }`}
                  >
                    {usd(j.amountUsd)}
                  </span>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => setEditId(j.id)}
                        aria-label={t.editJob}
                        className="rounded-md p-1 text-foreground-faint hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => doDelete(j.id)}
                        aria-label={t.removeJob}
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
      {confirmUI}
    </section>
  );
}
