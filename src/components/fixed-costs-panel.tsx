"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Check, X, TrendingDown, Wallet, CalendarClock } from "lucide-react";
import {
  COST_CATEGORIES,
  normalizeMonthlyUsd,
  type Cadence,
  type CostCategory,
  type Currency,
  type FixedCostDTO,
} from "@/lib/fixed-costs";
import { createFixedCost, updateFixedCost, deleteFixedCost } from "@/app/actions/fixed-costs";
import { useConfirm } from "@/components/confirm-dialog";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const usd = (n: number, d = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : d });
const fmtAmount = (n: number, c: Currency) =>
  n.toLocaleString(c === "BRL" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: c,
    maximumFractionDigits: n < 100 ? 2 : 0,
  });

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(COST_CATEGORIES.map((c) => [c.value, c.label]));

function months(treasuryUsd: number, burnUsd: number): number | null {
  return burnUsd > 0 ? treasuryUsd / burnUsd : null;
}
const fmtMonths = (m: number | null) => (m === null ? "∞" : m >= 10 ? Math.round(m).toString() : m.toFixed(1));

/** Runway → semantic color band: <6mo danger, <12 warning, else success. */
function runwayTone(m: number | null): { text: string; bar: string; ring: string } {
  if (m === null) return { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10" };
  if (m < 6) return { text: "text-danger", bar: "bg-danger", ring: "border-danger/30 bg-danger/10" };
  if (m < 12) return { text: "text-warning", bar: "bg-warning", ring: "border-warning/30 bg-warning/10" };
  return { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10" };
}

export type CostGroupMeta = { slug: string; name: string; treasuryUsd: number };

type DraftState = {
  label: string;
  amount: string;
  currency: Currency;
  cadence: Cadence;
  category: CostCategory | "";
  notes: string;
};

const EMPTY_DRAFT: DraftState = { label: "", amount: "", currency: "USD", cadence: "monthly", category: "", notes: "" };

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function FixedCostsPanel({
  groups,
  initialCosts,
  usdBrl,
  canEdit,
}: {
  groups: CostGroupMeta[];
  initialCosts: FixedCostDTO[];
  usdBrl: number;
  canEdit: boolean;
}) {
  const [costs, setCosts] = useState<FixedCostDTO[]>(initialCosts);
  const { confirm, confirmUI } = useConfirm();

  const bySlug = useMemo(() => {
    const m: Record<string, FixedCostDTO[]> = {};
    for (const g of groups) m[g.slug] = [];
    for (const c of costs) (m[c.projectSlug] ??= []).push(c);
    return m;
  }, [costs, groups]);

  const burnOf = (slug: string) => (bySlug[slug] ?? []).filter((c) => c.active).reduce((s, c) => s + c.monthlyUsd, 0);

  // Combined KPIs (live — recompute as costs change).
  const totalTreasury = groups.reduce((s, g) => s + g.treasuryUsd, 0);
  const totalBurn = groups.reduce((s, g) => s + burnOf(g.slug), 0);
  const totalMonths = months(totalTreasury, totalBurn);

  const upsert = (cost: FixedCostDTO) =>
    setCosts((prev) => (prev.some((c) => c.id === cost.id) ? prev.map((c) => (c.id === cost.id ? cost : c)) : [...prev, cost]));
  const remove = (id: string) => setCosts((prev) => prev.filter((c) => c.id !== id));

  const multi = groups.length > 1;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg text-accent">
          <TrendingDown className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-none text-foreground">Custos fixos & runway</h2>
          <p className="mt-1 text-[11px] leading-none text-foreground-faint">
            quanto a operação queima por mês vs. o tesouro disponível
          </p>
        </div>
      </div>

      {/* Combined KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<Wallet className="h-4 w-4" />} label="Tesouro" value={usd(totalTreasury)} />
        <Kpi icon={<TrendingDown className="h-4 w-4" />} label="Queima / mês" value={usd(totalBurn, 0)} />
        <RunwayKpi months={totalMonths} />
      </div>

      <div className={multi ? "grid gap-4 lg:grid-cols-2" : ""}>
        {groups.map((g) => (
          <ProjectCosts
            key={g.slug}
            meta={g}
            costs={bySlug[g.slug] ?? []}
            burnUsd={burnOf(g.slug)}
            usdBrl={usdBrl}
            canEdit={canEdit}
            onUpsert={upsert}
            onRemove={remove}
            confirm={confirm}
          />
        ))}
      </div>
      {confirmUI}
    </section>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-foreground-subtle">
        <span className="text-foreground-faint">{icon}</span>
        <p className="text-[11px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function RunwayKpi({ months: m }: { months: number | null }) {
  const tone = runwayTone(m);
  const pct = m === null ? 100 : Math.max(4, Math.min(100, (m / 24) * 100));
  return (
    <div className={`rounded-2xl border p-4 ${tone.ring}`}>
      <div className="flex items-center gap-1.5 text-foreground-subtle">
        <span className="text-foreground-faint">
          <CalendarClock className="h-4 w-4" />
        </span>
        <p className="text-[11px] uppercase tracking-wider">Runway</p>
      </div>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${tone.text}`}>
        {fmtMonths(m)} <span className="text-sm font-medium text-foreground-muted">{m === null ? "" : "meses"}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-project block
// ---------------------------------------------------------------------------

function ProjectCosts({
  meta,
  costs,
  burnUsd,
  usdBrl,
  canEdit,
  onUpsert,
  onRemove,
  confirm,
}: {
  meta: CostGroupMeta;
  costs: FixedCostDTO[];
  burnUsd: number;
  usdBrl: number;
  canEdit: boolean;
  onUpsert: (c: FixedCostDTO) => void;
  onRemove: (id: string) => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string }) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const m = months(meta.treasuryUsd, burnUsd);
  const tone = runwayTone(m);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{meta.name}</h3>
          <p className="mt-0.5 text-[11px] text-foreground-faint">
            {usd(meta.treasuryUsd)} no tesouro · {usd(burnUsd, 0)}/mês
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${tone.ring} ${tone.text}`}>
          {fmtMonths(m)} {m === null ? "sem queima" : "meses"}
        </span>
      </div>

      {costs.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-faint">
          Nenhum custo fixo cadastrado.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {costs.map((c) =>
            editingId === c.id ? (
              <li key={c.id} className="py-2">
                <CostForm
                  projectSlug={meta.slug}
                  initial={c}
                  usdBrl={usdBrl}
                  onCancel={() => setEditingId(null)}
                  onSaved={(saved) => {
                    onUpsert(saved);
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <CostRow
                key={c.id}
                cost={c}
                canEdit={canEdit}
                onEdit={() => setEditingId(c.id)}
                onToggleActive={onUpsert}
                onDelete={async () => {
                  const ok = await confirm({
                    title: "Remover custo?",
                    message: `"${c.label}" sairá do cálculo de runway.`,
                    confirmLabel: "Remover",
                  });
                  if (!ok) return;
                  const res = await deleteFixedCost(c.id);
                  if (res.ok) onRemove(c.id);
                }}
              />
            ),
          )}
        </ul>
      )}

      {canEdit &&
        (adding ? (
          <div className="mt-3">
            <CostForm
              projectSlug={meta.slug}
              usdBrl={usdBrl}
              onCancel={() => setAdding(false)}
              onSaved={(saved) => {
                onUpsert(saved);
                setAdding(false);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-medium text-foreground-muted transition-colors hover:border-accent-border hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar custo
          </button>
        ))}
    </div>
  );
}

function CostRow({
  cost,
  canEdit,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  cost: FixedCostDTO;
  canEdit: boolean;
  onEdit: () => void;
  onToggleActive: (c: FixedCostDTO) => void;
  onDelete: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <li className={`flex items-center gap-3 py-2.5 ${cost.active ? "" : "opacity-50"}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-foreground">{cost.label}</span>
          {cost.category && (
            <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">
              {CATEGORY_LABEL[cost.category] ?? cost.category}
            </span>
          )}
        </div>
        {cost.notes && <p className="mt-0.5 truncate text-[11px] text-foreground-faint">{cost.notes}</p>}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-foreground">{usd(cost.monthlyUsd)}/mês</p>
        <p className="text-[11px] text-foreground-faint">
          {fmtAmount(cost.amount, cost.currency)}
          {cost.cadence === "yearly" ? "/ano" : "/mês"}
        </p>
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              const res = await updateFixedCost(cost.id, { active: !cost.active });
              if (res.ok) onToggleActive(res.cost);
            })}
            title={cost.active ? "Pausar (excluir do runway)" : "Reativar"}
            className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            {cost.active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Editar"
            className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Remover"
            className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent-border placeholder:text-foreground-faint";

function CostForm({
  projectSlug,
  initial,
  usdBrl,
  onCancel,
  onSaved,
}: {
  projectSlug: string;
  initial?: FixedCostDTO;
  usdBrl: number;
  onCancel: () => void;
  onSaved: (c: FixedCostDTO) => void;
}) {
  const [draft, setDraft] = useState<DraftState>(
    initial
      ? {
          label: initial.label,
          amount: String(initial.amount),
          currency: initial.currency,
          cadence: initial.cadence,
          category: initial.category ?? "",
          notes: initial.notes ?? "",
        }
      : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amountNum = Number(draft.amount);
  const previewUsd =
    Number.isFinite(amountNum) && amountNum > 0
      ? normalizeMonthlyUsd(amountNum, draft.currency, draft.cadence, usdBrl)
      : 0;

  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () =>
    start(async () => {
      setError(null);
      const payload = {
        label: draft.label,
        amount: amountNum,
        currency: draft.currency,
        cadence: draft.cadence,
        category: draft.category || null,
        notes: draft.notes || null,
      };
      const res = initial
        ? await updateFixedCost(initial.id, payload)
        : await createFixedCost({ projectSlug, ...payload });
      if (res.ok) onSaved(res.cost);
      else setError(res.error);
    });

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-elevated/40 p-3">
      <input
        autoFocus
        value={draft.label}
        onChange={(e) => set("label", e.target.value)}
        placeholder="Ex: Vercel Pro, salário designer…"
        className={inputCls}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="Valor"
          className={`${inputCls} tabular-nums`}
        />
        <select value={draft.currency} onChange={(e) => set("currency", e.target.value as Currency)} className={inputCls}>
          <option value="USD">USD $</option>
          <option value="BRL">BRL R$</option>
        </select>
        <select value={draft.cadence} onChange={(e) => set("cadence", e.target.value as Cadence)} className={inputCls}>
          <option value="monthly">Mensal</option>
          <option value="yearly">Anual</option>
        </select>
        <select
          value={draft.category}
          onChange={(e) => set("category", e.target.value as CostCategory | "")}
          className={inputCls}
        >
          <option value="">Categoria</option>
          {COST_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <input
        value={draft.notes}
        onChange={(e) => set("notes", e.target.value)}
        placeholder="Notas (opcional)"
        className={inputCls}
      />

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-foreground-faint">
          {previewUsd > 0 ? (
            <>
              ≈ <span className="font-semibold tabular-nums text-foreground-muted">{usd(previewUsd)}/mês</span>
              {draft.currency === "BRL" && <span> · câmbio {usdBrl.toFixed(2)}</span>}
            </>
          ) : (
            "informe um valor"
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !draft.label.trim() || !(amountNum > 0)}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            {pending ? "Salvando…" : initial ? "Salvar" : "Adicionar"}
          </button>
        </div>
      </div>
    </div>
  );
}
