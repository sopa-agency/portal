// Pure, client-safe helpers (types, normalization, FX, runway). DB access lives
// in fixed-costs-data.ts so this module can be imported from client components
// without pulling Prisma into the browser bundle.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Currency = "USD" | "BRL";
export type Cadence = "monthly" | "yearly";
export type CostCategory = "infra" | "salary" | "tooling" | "service" | "other";

export const COST_CATEGORIES: { value: CostCategory; label: string }[] = [
  { value: "infra", label: "Infra" },
  { value: "salary", label: "Salário" },
  { value: "tooling", label: "Ferramentas" },
  { value: "service", label: "Serviço" },
  { value: "other", label: "Outro" },
];

/** A manually-logged actual billed amount for a variable cost in one month. */
export type MonthActual = {
  month: string; // "YYYY-MM"
  amount: number; // raw, in `currency` — may be negative (refund/credit)
  currency: Currency;
  note: string | null;
  /** Whether this month's invoice was actually paid. */
  paid: boolean;
  /** This actual normalized to monthly USD (signed). */
  monthlyUsd: number;
};

export type FixedCostDTO = {
  id: string;
  projectSlug: string;
  label: string;
  amount: number; // raw, in `currency` — for variable costs, the plan base / estimate
  currency: Currency;
  cadence: Cadence;
  category: CostCategory | null;
  notes: string | null;
  active: boolean;
  /** Variable cost (flat plan + quota overage) — real value edited per month. */
  variable: boolean;
  /** Server's notion of the current month ("YYYY-MM"). */
  currentMonth: string;
  /** This month's logged actual, if any (for highlighting the current column). */
  actual: MonthActual | null;
  /** All logged actuals, most recent month first (history). */
  actuals: MonthActual[];
  /** The plan base estimate normalized to monthly USD. */
  estimateUsd: number;
  /** Number of recent months averaged into monthlyUsd (0 for fixed/un-logged). */
  avgCount: number;
  /**
   * The figure shown in the display and summed into the runway burn: for a
   * variable cost it's the AVERAGE of recent logged actuals (or the plan
   * estimate when none logged yet); for a fixed cost it's the estimate.
   */
  monthlyUsd: number;
  /** True when monthlyUsd falls back to the plan estimate (no actuals logged). */
  isEstimate: boolean;
};

/** Per-project costs + the USD/BRL rate used to normalize them. */
export type CostScope = {
  usdBrl: number; // BRL per 1 USD
  bySlug: Record<string, FixedCostDTO[]>;
};

export type RunwayStat = {
  /** Total monthly burn in USD (sum of active costs, normalized). */
  burnUsd: number;
  /** Live treasury balance in USD. */
  treasuryUsd: number;
  /** Months of runway (treasury ÷ burn). null = no burn → effectively infinite. */
  months: number | null;
};

// ---------------------------------------------------------------------------
// FX — USD → BRL (fiat). CoinGecko only covers crypto, so use a free, keyless
// FX endpoint with a sane fallback when it's unreachable.
// ---------------------------------------------------------------------------

const USD_BRL_FALLBACK = 5.4;

export async function fetchUsdBrl(): Promise<number> {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=BRL", {
      next: { revalidate: 3600 },
    });
    const data = (await res.json()) as { rates?: { BRL?: number } };
    const rate = data.rates?.BRL;
    return rate && rate > 0 ? rate : USD_BRL_FALLBACK;
  } catch {
    return USD_BRL_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Normalization + runway
// ---------------------------------------------------------------------------

/** Collapse a cost (cadence + currency) into a single monthly USD figure. */
export function normalizeMonthlyUsd(
  amount: number,
  currency: Currency,
  cadence: Cadence,
  usdBrl: number,
): number {
  const monthly = cadence === "yearly" ? amount / 12 : amount;
  const usd = currency === "BRL" ? monthly / (usdBrl || USD_BRL_FALLBACK) : monthly;
  return Number.isFinite(usd) ? usd : 0;
}

/** Sum of the active costs' monthly USD burn. */
export function monthlyBurn(costs: FixedCostDTO[]): number {
  return costs.filter((c) => c.active).reduce((s, c) => s + c.monthlyUsd, 0);
}

export function runway(treasuryUsd: number, costs: FixedCostDTO[]): RunwayStat {
  const burnUsd = monthlyBurn(costs);
  return {
    burnUsd,
    treasuryUsd,
    months: burnUsd > 0 ? treasuryUsd / burnUsd : null,
  };
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

const CURRENCIES: Currency[] = ["USD", "BRL"];
const CADENCES: Cadence[] = ["monthly", "yearly"];

const asCurrency = (c: string): Currency => (CURRENCIES.includes(c as Currency) ? (c as Currency) : "USD");

/** Current month key ("YYYY-MM") in São Paulo time, where the org operates. */
export function currentMonthKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

type ActualRow = { month: string; amount: number; currency: string; note: string | null; paid?: boolean };

export function toCostDTO(
  row: {
    id: string;
    projectSlug: string;
    label: string;
    amount: number;
    currency: string;
    cadence: string;
    category: string | null;
    notes: string | null;
    active: boolean;
    variable: boolean;
    actuals?: ActualRow[];
  },
  usdBrl: number,
  currentMonth: string = currentMonthKey(),
): FixedCostDTO {
  const currency = asCurrency(row.currency);
  const cadence: Cadence = CADENCES.includes(row.cadence as Cadence) ? (row.cadence as Cadence) : "monthly";
  // Variable costs are inherently monthly (you get billed every month, overage
  // and all), so the estimate ignores yearly cadence for them.
  const estCadence: Cadence = row.variable ? "monthly" : cadence;
  const estimateUsd = normalizeMonthlyUsd(row.amount, currency, estCadence, usdBrl);

  const actuals: MonthActual[] = (row.actuals ?? [])
    .map((a) => {
      const ac = asCurrency(a.currency);
      return {
        month: a.month,
        amount: a.amount,
        currency: ac,
        note: a.note,
        paid: a.paid ?? true,
        monthlyUsd: normalizeMonthlyUsd(a.amount, ac, "monthly", usdBrl),
      };
    })
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const actual = row.variable ? actuals.find((a) => a.month === currentMonth) ?? null : null;
  // The display / burn figure for a variable cost is the average of its recent
  // (up to 6) logged actuals — Vercel/Pinata fluctuate, so the mean of real
  // invoices is a steadier monthly number than any single month.
  const recent = actuals.slice(0, 6);
  const averageUsd = recent.length ? recent.reduce((s, a) => s + a.monthlyUsd, 0) / recent.length : null;
  const monthlyUsd = row.variable ? averageUsd ?? estimateUsd : estimateUsd;

  return {
    id: row.id,
    projectSlug: row.projectSlug,
    label: row.label,
    amount: row.amount,
    currency,
    cadence,
    category: (row.category as CostCategory | null) ?? null,
    notes: row.notes,
    active: row.active,
    variable: row.variable,
    currentMonth,
    actual,
    actuals,
    estimateUsd,
    avgCount: row.variable && averageUsd !== null ? recent.length : 0,
    monthlyUsd,
    isEstimate: row.variable ? averageUsd === null : false,
  };
}
