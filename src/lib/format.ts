// Canonical money / percentage formatting for the treasury page (and beyond).
// Replaces ~20 divergent local `usd`/`pct`/`fmt` helpers that rendered the SAME
// value differently across panels (e.g. "$150" in the header vs "$150.00" two
// cards below). Pick the variant by INTENT, not by eyeballing digits:
//
//   usd       — general amounts: ≥$1k no cents, $1–$1k 2dp, 0 → "$0", <$1 up to 4dp
//   usdWhole  — hero / total figures that want a clean integer (no cents, ever)
//   usdTiny   — stream / yield accrual that can be sub-cent (up to 6dp), else usd()
//   pct       — percentages: ≥9.95 rounded, else 1dp
//
// The two runway formatters live here too so the DAYS metric (stream buffer) and
// the MONTHS metric (treasury ÷ fixed costs) can never accidentally share a band:
// they are separate named functions with their own tone helpers.

const money = (n: number, min: number, max: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max })}`;

export function usd(n: number): string {
  if (n === 0) return "$0";
  const a = Math.abs(n);
  if (a >= 1000) return money(n, 0, 0);
  if (a >= 1) return money(n, 2, 2);
  return money(n, 2, 4);
}

/** Clean integer dollars — for hero totals and big headline numbers. */
export function usdWhole(n: number): string {
  return money(n, 0, 0);
}

/** Sub-cent aware — for streamed/accrued amounts that start life tiny. */
export function usdTiny(n: number): string {
  if (n === 0) return "$0";
  return Math.abs(n) < 0.01 ? money(n, 0, 6) : usd(n);
}

export function pct(n: number): string {
  return `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
}

// ── Runway ──────────────────────────────────────────────────────────────────
// null = not applicable / not observed (no stream, no costs). NEVER rendered as
// a full "healthy" bar — callers show a neutral empty state (see data-state.tsx).

export type Tone = "muted" | "danger" | "warning" | "success";

/** Stream buffer runway, in DAYS. Bands: <14 danger · <45 warning · else ok. */
export function formatRunwayDays(d: number | null): string {
  return d == null ? "—" : `${Math.floor(d)}d`;
}
export function daysTone(d: number | null): Tone {
  if (d == null) return "muted";
  return d < 14 ? "danger" : d < 45 ? "warning" : "success";
}

/** Treasury runway, in MONTHS. One reconciled band: <3 danger · <12 warning · else ok. */
export function formatRunwayMonths(m: number | null): string {
  if (m == null) return "∞";
  return m >= 10 ? String(Math.round(m)) : m.toFixed(1);
}
export function monthsTone(m: number | null): Tone {
  if (m == null) return "success"; // genuinely no costs booked = infinite runway
  return m < 3 ? "danger" : m < 12 ? "warning" : "success";
}

/** Map a Tone to the text token used across the page. */
export const toneText: Record<Tone, string> = {
  muted: "text-foreground-muted",
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
};
