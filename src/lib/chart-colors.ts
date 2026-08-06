// The categorical series palette, deduped from 5 identical copies (members-tab,
// treasury-views, payroll-panel, stream-flow-view, vault-flow-view). Hex values
// are kept as-is for now; migrating these onto the validated --viz-* CSS tokens
// (already contrast/CVD-checked in globals.css, used by treasury-allocation) is a
// later stretch goal — this file just stops the copy-paste drift.

export const SERIES_PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#84cc16", // lime
  "#f97316", // orange
  "#14b8a6", // teal
  "#e11d48", // rose
] as const;

export const chartColorAt = (i: number): string =>
  SERIES_PALETTE[((i % SERIES_PALETTE.length) + SERIES_PALETTE.length) % SERIES_PALETTE.length];
