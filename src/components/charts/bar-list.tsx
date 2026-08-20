"use client";

// Ranked magnitude — top pages, sources, countries.
//
// These are NOMINAL categories (page paths, referrers): swapping their order
// changes nothing, so identity isn't the job and every bar wears the same hue.
// Colouring them by value would spend the identity channel re-encoding what the
// bar length already says.
//
// The value rides the tip of each bar (a direct label), so nothing is gated
// behind hover; the hover state only lifts the row.

import { useState } from "react";

export type BarRow = { name: string; value: number; hint?: string };

export function BarList({
  rows,
  color = "var(--viz-1)",
  formatValue,
  emptyLabel,
}: {
  rows: BarRow[];
  color?: string;
  formatValue: (n: number) => string;
  emptyLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-foreground-faint">{emptyLabel}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-1.5">
      {rows.map((row, i) => (
        <li
          key={`${row.name}-${i}`}
          onPointerEnter={() => setHover(i)}
          onPointerLeave={() => setHover(null)}
          className="flex items-center gap-3 rounded-md px-1 py-1 transition-colors"
          style={hover === i ? { backgroundColor: "var(--segment-track)" } : undefined}
        >
          <span
            className="w-36 shrink-0 truncate text-xs text-foreground-muted"
            title={row.hint ?? row.name}
          >
            {row.name}
          </span>
          <span className="flex h-2.5 flex-1 items-center">
            <span
              // 4px rounded data-end, square at the baseline: the bar grows
              // from the left edge, so only its right end is rounded.
              className="h-2.5 rounded-r"
              style={{
                width: `${Math.max((row.value / max) * 100, 1.5)}%`,
                backgroundColor: color,
                opacity: hover === null || hover === i ? 1 : 0.55,
                transition: "opacity 160ms ease, width 420ms cubic-bezier(0.22, 0.9, 0.3, 1)",
              }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground">
            {formatValue(row.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
