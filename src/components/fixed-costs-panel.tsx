"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Check, X, TrendingDown, Wallet, CalendarClock, Zap, RotateCcw } from "lucide-react";
import {
  COST_CATEGORIES,
  normalizeMonthlyUsd,
  type Cadence,
  type CostCategory,
  type Currency,
  type FixedCostDTO,
  type MonthActual,
} from "@/lib/fixed-costs";
import { createFixedCost, updateFixedCost, deleteFixedCost, setMonthlyActual, clearMonthlyActual } from "@/app/actions/fixed-costs";
import { useConfirm } from "@/components/confirm-dialog";
import { useLocale } from "@/components/locale-provider";
import type { Dictionary, Locale } from "@/lib/i18n/dictionary";

type CostsT = Dictionary["treasury"]["costs"];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const usd = (n: number, d = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : d });
const cellUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k` : usd(n, 0);
const fmtAmount = (n: number, c: Currency) =>
  n.toLocaleString(c === "BRL" ? "pt-BR" : "en-US", {
    style: "currency",
    currency: c,
    maximumFractionDigits: n < 100 ? 2 : 0,
  });

const intlLocale = (locale: Locale) => (locale === "pt" ? "pt-BR" : "en-US");

/** "2026-06" → "jun/26" (short month name in the reader's language). */
function monthLabel(month: string, locale: Locale): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(intlLocale(locale), { month: "short", timeZone: "UTC" });
  return `${name.replace(".", "")}/${String(y).slice(2)}`;
}

/** Current month ("YYYY-MM") in São Paulo time — client fallback when no costs. */
function clientMonthKey(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const y = p.find((x) => x.type === "year")?.value ?? "1970";
  const mo = p.find((x) => x.type === "month")?.value ?? "01";
  return `${y}-${mo}`;
}

/** The n-month window ending at `current` (oldest first). */
function monthWindow(current: string, n = 6): string[] {
  const [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The value a cost contributes in a given month (actual if logged, else estimate). */
function monthValue(cost: FixedCostDTO, month: string): { usd: number; actual: MonthActual | null } {
  if (cost.variable) {
    const a = cost.actuals.find((x) => x.month === month) ?? null;
    return { usd: a ? a.monthlyUsd : cost.estimateUsd, actual: a };
  }
  return { usd: cost.estimateUsd, actual: null };
}

function months(treasuryUsd: number, burnUsd: number): number | null {
  return burnUsd > 0 ? treasuryUsd / burnUsd : null;
}
const fmtMonths = (m: number | null) => (m === null ? "∞" : m >= 10 ? Math.round(m).toString() : m.toFixed(1));

/** Runway → semantic color band: <3mo danger, <12 warning, else success
    (reconciled with the treasury hero's band so one metric never uses two). */
function runwayTone(m: number | null): { text: string; bar: string; ring: string } {
  if (m === null) return { text: "text-success", bar: "bg-success", ring: "border-success/30 bg-success/10" };
  if (m < 3) return { text: "text-danger", bar: "bg-danger", ring: "border-danger/30 bg-danger/10" };
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
  variable: boolean;
};

const EMPTY_DRAFT: DraftState = { label: "", amount: "", currency: "USD", cadence: "monthly", category: "", notes: "", variable: false };

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
  const { locale, t: dict } = useLocale();
  const t = dict.treasury.costs;

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

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-bg text-accent">
          <TrendingDown className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-none text-foreground">{t.title}</h2>
          <p className="mt-1 text-[11px] leading-none text-foreground-faint">{t.hint}</p>
        </div>
      </div>

      {/* Combined KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi icon={<Wallet className="h-4 w-4" />} label={t.kpiTreasury} value={usd(totalTreasury)} />
        <Kpi icon={<TrendingDown className="h-4 w-4" />} label={t.kpiBurn} value={usd(totalBurn, 0)} />
        <RunwayKpi months={totalMonths} t={t} />
      </div>

      <div className="space-y-4">
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
            t={t}
            locale={locale}
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

function RunwayKpi({ months: m, t }: { months: number | null; t: CostsT }) {
  const tone = runwayTone(m);
  const pct = m === null ? 100 : Math.max(4, Math.min(100, (m / 24) * 100));
  return (
    <div className={`rounded-2xl border p-4 ${tone.ring}`}>
      <div className="flex items-center gap-1.5 text-foreground-subtle">
        <span className="text-foreground-faint">
          <CalendarClock className="h-4 w-4" />
        </span>
        <p className="text-[11px] uppercase tracking-wider">{t.runway}</p>
      </div>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${tone.text}`}>
        {fmtMonths(m)} <span className="text-sm font-medium text-foreground-muted">{m === null ? "" : t.months}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-project table
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
  t,
  locale,
}: {
  meta: CostGroupMeta;
  costs: FixedCostDTO[];
  burnUsd: number;
  usdBrl: number;
  canEdit: boolean;
  onUpsert: (c: FixedCostDTO) => void;
  onRemove: (id: string) => void;
  confirm: (o: { title: string; message?: string; confirmLabel?: string }) => Promise<boolean>;
  t: CostsT;
  locale: Locale;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cell, setCell] = useState<{ costId: string; month: string } | null>(null);
  const m = months(meta.treasuryUsd, burnUsd);
  const tone = runwayTone(m);

  const currentMonth = costs[0]?.currentMonth ?? clientMonthKey();
  const cols = monthWindow(currentMonth, 6);
  const colCount = 2 + cols.length + (canEdit ? 1 : 0);
  const monthTotal = (mo: string) => costs.filter((c) => c.active).reduce((s, c) => s + monthValue(c, mo).usd, 0);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{meta.name}</h3>
          <p className="mt-0.5 text-[11px] text-foreground-faint">
            {t.inTreasury(usd(meta.treasuryUsd))} · {usd(burnUsd, 0)}
            {t.monthSuffix}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${tone.ring} ${tone.text}`}>
          {fmtMonths(m)} {m === null ? t.noBurn : t.months}
        </span>
      </div>

      {costs.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-faint">
          {t.empty}
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-foreground-subtle">
                <th className="px-2 py-1.5 text-left font-semibold">{t.colCost}</th>
                {cols.map((mo) => (
                  <th key={mo} className={`px-2 py-1.5 text-right font-semibold ${mo === currentMonth ? "text-accent" : ""}`}>
                    {monthLabel(mo, locale)}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right font-semibold text-foreground-muted">{t.colAverage}</th>
                {canEdit && <th className="w-px px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <Fragment key={c.id}>
                  <tr className={`border-t border-border ${c.active ? "" : "opacity-50"}`}>
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground">{c.label}</span>
                        {c.variable && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent-bg px-1.5 py-0.5 text-[10px] font-semibold text-accent"
                            title={t.variableTitle}
                          >
                            <Zap className="h-2.5 w-2.5" /> {t.variable}
                          </span>
                        )}
                        {c.category && (
                          <span className="shrink-0 rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-subtle">
                            {t.categories[c.category] ?? c.category}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] text-foreground-faint">
                        {c.variable
                          ? t.planPerMonth(fmtAmount(c.amount, c.currency))
                          : `${fmtAmount(c.amount, c.currency)}${c.cadence === "yearly" ? t.yearSuffix : t.monthSuffix}`}
                        {c.notes ? ` · ${c.notes}` : ""}
                      </p>
                    </td>
                    {cols.map((mo) => (
                      <MonthCell
                        key={mo}
                        cost={c}
                        month={mo}
                        isCurrent={mo === currentMonth}
                        editable={c.variable && canEdit}
                        onClick={() => setCell({ costId: c.id, month: mo })}
                        t={t}
                        locale={locale}
                      />
                    ))}
                    <td className="px-2 py-2 text-right align-top">
                      <span className="text-sm font-semibold tabular-nums text-foreground">{cellUsd(c.monthlyUsd)}</span>
                      {c.variable && (
                        <span className="block text-[10px] text-foreground-faint">
                          {c.avgCount > 0 ? t.avgMonths(c.avgCount) : t.estimate}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-1 py-2 align-top">
                        <div className="flex items-center justify-end gap-0.5">
                          <CostActions
                            cost={c}
                            t={t}
                            onChange={onUpsert}
                            onEdit={() => setEditingId(editingId === c.id ? null : c.id)}
                            onDelete={async () => {
                              const ok = await confirm({
                                title: t.removeTitle,
                                message: t.removeMessage(c.label),
                                confirmLabel: t.remove,
                              });
                              if (!ok) return;
                              const res = await deleteFixedCost(c.id);
                              if (res.ok) onRemove(c.id);
                            }}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                  {editingId === c.id && (
                    <tr>
                      <td colSpan={colCount} className="px-2 pb-3">
                        <CostForm
                          projectSlug={meta.slug}
                          initial={c}
                          usdBrl={usdBrl}
                          t={t}
                          onCancel={() => setEditingId(null)}
                          onSaved={(saved) => {
                            onUpsert(saved);
                            setEditingId(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  {cell?.costId === c.id && (
                    <tr>
                      <td colSpan={colCount} className="px-2 pb-3">
                        <MonthActualEditor
                          cost={c}
                          month={cell.month}
                          usdBrl={usdBrl}
                          t={t}
                          locale={locale}
                          onClose={() => setCell(null)}
                          onChange={(u) => {
                            onUpsert(u);
                            setCell(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">{t.burn}</td>
                {cols.map((mo) => (
                  <td
                    key={mo}
                    className={`px-2 py-2 text-right text-xs font-semibold tabular-nums ${mo === currentMonth ? "text-foreground" : "text-foreground-muted"}`}
                  >
                    {cellUsd(monthTotal(mo))}
                  </td>
                ))}
                <td className="px-2 py-2 text-right text-sm font-bold tabular-nums text-accent">{cellUsd(burnUsd)}</td>
                {canEdit && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canEdit &&
        (adding ? (
          <div className="mt-3">
            <CostForm
              projectSlug={meta.slug}
              usdBrl={usdBrl}
              t={t}
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
            <Plus className="h-3.5 w-3.5" /> {t.add}
          </button>
        ))}
    </div>
  );
}

function MonthCell({
  cost,
  month,
  isCurrent,
  editable,
  onClick,
  t,
  locale,
}: {
  cost: FixedCostDTO;
  month: string;
  isCurrent: boolean;
  editable: boolean;
  onClick: () => void;
  t: CostsT;
  locale: Locale;
}) {
  const { usd: v, actual } = monthValue(cost, month);
  const isReal = cost.variable && actual !== null;
  const isCredit = isReal && v < 0;
  const unpaid = isReal && actual!.paid === false;
  const label = monthLabel(month, locale);
  const title = editable
    ? [
        isReal ? t.cellEdit(label) : t.cellLog(label),
        unpaid ? t.cellUnpaid : null,
        actual?.note || null,
      ].filter(Boolean).join(" · ")
    : undefined;
  return (
    <td className={`px-1 py-1 text-right align-top ${isCurrent ? "bg-accent-bg/30" : ""}`}>
      <button
        type="button"
        disabled={!editable}
        onClick={editable ? onClick : undefined}
        title={title}
        className={`flex w-full items-center justify-end gap-1 rounded px-1.5 py-1 text-right text-xs tabular-nums transition-colors ${
          editable ? "cursor-pointer hover:bg-surface-elevated hover:ring-1 hover:ring-accent-border" : "cursor-default"
        } ${isCredit ? "font-semibold text-success" : isReal ? "font-semibold text-foreground" : "text-foreground-faint"}`}
      >
        {unpaid && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label={t.pending} />}
        {isReal ? cellUsd(v) : v > 0 ? cellUsd(v) : "—"}
      </button>
    </td>
  );
}

function CostActions({
  cost,
  onChange,
  onEdit,
  onDelete,
  t,
}: {
  cost: FixedCostDTO;
  onChange: (c: FixedCostDTO) => void;
  onEdit: () => void;
  onDelete: () => void;
  t: CostsT;
}) {
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await updateFixedCost(cost.id, { active: !cost.active });
            if (res.ok) onChange(res.cost);
          })
        }
        title={cost.active ? t.pause : t.reactivate}
        className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
      >
        {cost.active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onEdit}
        title={t.edit}
        className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={t.remove}
        className="rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-month actual editor (variable costs)
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent-border placeholder:text-foreground-faint";

function MonthActualEditor({
  cost,
  month,
  usdBrl,
  onClose,
  onChange,
  t,
  locale,
}: {
  cost: FixedCostDTO;
  month: string;
  usdBrl: number;
  onClose: () => void;
  onChange: (c: FixedCostDTO) => void;
  t: CostsT;
  locale: Locale;
}) {
  const monthActual = cost.actuals.find((a) => a.month === month) ?? null;
  // Pre-fill: this month's actual → most recent actual → plan base estimate.
  const seed = monthActual ?? cost.actuals[0] ?? null;
  const [amount, setAmount] = useState(String(seed?.amount ?? cost.amount));
  const [currency, setCurrency] = useState<Currency>(seed?.currency ?? cost.currency);
  const [note, setNote] = useState(monthActual?.note ?? "");
  const [paid, setPaid] = useState(monthActual?.paid ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amountNum = Number(amount);
  const valid = amount.trim() !== "" && amount.trim() !== "-" && Number.isFinite(amountNum);
  const previewUsd = valid ? normalizeMonthlyUsd(amountNum, currency, "monthly", usdBrl) : 0;
  const deltaUsd = previewUsd - cost.estimateUsd;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await setMonthlyActual(cost.id, { month, amount: amountNum, currency, note: note || null, paid });
      if (res.ok) onChange(res.cost);
      else setError(res.error);
    });

  const revert = () =>
    start(async () => {
      const res = await clearMonthlyActual(cost.id, month);
      if (res.ok) onChange(res.cost);
      else setError(res.error);
    });

  return (
    <div className="space-y-2 rounded-xl border border-accent-border bg-accent-bg/40 p-3">
      <p className="text-[11px] font-semibold text-foreground">{t.actualTitle(monthLabel(month, locale), cost.label)}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.\-]/g, "").replace(/(?!^)-/g, ""))}
          inputMode="text"
          placeholder={t.amountPlaceholder}
          className={`${inputCls} tabular-nums`}
        />
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputCls}>
          <option value="USD">USD $</option>
          <option value="BRL">BRL R$</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.notePlaceholder}
          className={`${inputCls} col-span-2 sm:col-span-1`}
        />
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
        {t.paid} {paid ? "" : t.unpaidSuffix}
      </label>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <p className="text-[11px] text-foreground-faint">
          {valid ? (
            <>
              ≈ <span className="font-semibold tabular-nums text-foreground-muted">{usd(previewUsd)}{t.monthSuffix}</span>
              {Math.abs(deltaUsd) >= 0.5 && (
                <span className={deltaUsd > 0 ? "text-danger" : "text-success"}>
                  {" "}
                  ({deltaUsd > 0 ? "+" : "−"}
                  {usd(Math.abs(deltaUsd))} {t.vsPlan})
                </span>
              )}
            </>
          ) : (
            t.needInvoice
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {monthActual && (
            <button
              type="button"
              onClick={revert}
              disabled={pending}
              title={t.revertTitle}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-3 w-3" /> {t.revert}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !valid}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            {pending ? t.saving : t.saveMonth}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit cost form
// ---------------------------------------------------------------------------

function CostForm({
  projectSlug,
  initial,
  usdBrl,
  onCancel,
  onSaved,
  t,
}: {
  projectSlug: string;
  initial?: FixedCostDTO;
  usdBrl: number;
  onCancel: () => void;
  onSaved: (c: FixedCostDTO) => void;
  t: CostsT;
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
          variable: initial.variable,
        }
      : EMPTY_DRAFT,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const amountNum = Number(draft.amount);
  const effCadence: Cadence = draft.variable ? "monthly" : draft.cadence;
  const previewUsd =
    Number.isFinite(amountNum) && amountNum > 0 ? normalizeMonthlyUsd(amountNum, draft.currency, effCadence, usdBrl) : 0;

  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = () =>
    start(async () => {
      setError(null);
      const payload = {
        label: draft.label,
        amount: amountNum,
        currency: draft.currency,
        cadence: effCadence,
        category: draft.category || null,
        notes: draft.notes || null,
        variable: draft.variable,
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
        placeholder={t.labelPlaceholder}
        className={inputCls}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder={draft.variable ? t.planAmountPlaceholder : t.amountPlaceholderPlain}
          className={`${inputCls} tabular-nums`}
        />
        <select value={draft.currency} onChange={(e) => set("currency", e.target.value as Currency)} className={inputCls}>
          <option value="USD">USD $</option>
          <option value="BRL">BRL R$</option>
        </select>
        {draft.variable ? (
          <div className={`${inputCls} flex items-center text-foreground-faint`}>{t.monthly}</div>
        ) : (
          <select value={draft.cadence} onChange={(e) => set("cadence", e.target.value as Cadence)} className={inputCls}>
            <option value="monthly">{t.monthly}</option>
            <option value="yearly">{t.yearly}</option>
          </select>
        )}
        <select
          value={draft.category}
          onChange={(e) => set("category", e.target.value as CostCategory | "")}
          className={inputCls}
        >
          <option value="">{t.category}</option>
          {COST_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {t.categories[c.value]}
            </option>
          ))}
        </select>
      </div>
      <input
        value={draft.notes}
        onChange={(e) => set("notes", e.target.value)}
        placeholder={t.notesPlaceholder}
        className={inputCls}
      />
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
        <input
          type="checkbox"
          checked={draft.variable}
          onChange={(e) => set("variable", e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        <Zap className="h-3 w-3 text-accent" />
        {t.variesLabel}
      </label>

      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[11px] text-foreground-faint">
          {previewUsd > 0 ? (
            <>
              ≈ <span className="font-semibold tabular-nums text-foreground-muted">{usd(previewUsd)}{t.monthSuffix}</span>
              {draft.currency === "BRL" && <span> {t.fx(usdBrl.toFixed(2))}</span>}
            </>
          ) : (
            t.needAmount
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !draft.label.trim() || !(amountNum > 0)}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            {pending ? t.saving : initial ? t.save : t.addAction}
          </button>
        </div>
      </div>
    </div>
  );
}
