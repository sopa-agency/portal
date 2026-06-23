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

export type FixedCostDTO = {
  id: string;
  projectSlug: string;
  label: string;
  amount: number; // raw, in `currency`
  currency: Currency;
  cadence: Cadence;
  category: CostCategory | null;
  notes: string | null;
  active: boolean;
  /** Amount normalized to a monthly USD burn (cadence + currency applied). */
  monthlyUsd: number;
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
  },
  usdBrl: number,
): FixedCostDTO {
  const currency: Currency = CURRENCIES.includes(row.currency as Currency)
    ? (row.currency as Currency)
    : "USD";
  const cadence: Cadence = CADENCES.includes(row.cadence as Cadence)
    ? (row.cadence as Cadence)
    : "monthly";
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
    monthlyUsd: normalizeMonthlyUsd(row.amount, currency, cadence, usdBrl),
  };
}
