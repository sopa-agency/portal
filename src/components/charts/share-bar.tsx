"use client";

// Part-to-whole: devices, new vs returning.
//
// One stacked bar, not N separate tracks. The old version drew each slice as
// its own full-width bar, which shows the shares but hides the whole — you
// could not see at a glance that mobile is most of the traffic, only that its
// own bar was longer than the next one's.
//
// A 2px gap in the surface colour separates the segments. That gap is the
// separator; a stroke around each slice would add ink that isn't data.

import { useState } from "react";

export type ShareSlice = { name: string; value: number };

/** Validated categorical slots, in fixed order — never cycled, never generated. */
const SLOTS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];

export function ShareBar({
  slices,
  formatValue,
  emptyLabel,
  otherLabel,
}: {
  slices: ShareSlice[];
  formatValue: (n: number) => string;
  emptyLabel: string;
  /** Anything past the third slot folds in here rather than inventing a hue. */
  otherLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return <p className="py-6 text-center text-xs text-foreground-faint">{emptyLabel}</p>;
  }

  // Past three categories the palette has no fourth safe slot, so the tail
  // folds into "Other" instead of a generated colour that CVD can't separate.
  const head = slices.slice(0, SLOTS.length);
  const tail = slices.slice(SLOTS.length);
  const shown =
    tail.length > 0
      ? [...head.slice(0, SLOTS.length - 1), {
          name: otherLabel,
          value: tail.reduce((s, x) => s + x.value, 0) + (head[SLOTS.length - 1]?.value ?? 0),
        }]
      : head;

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden">
        {shown.map((slice, i) => (
          <span
            key={slice.name}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            title={`${slice.name}: ${formatValue(slice.value)}`}
            className={`h-3 ${i === 0 ? "rounded-l-full" : ""} ${i === shown.length - 1 ? "rounded-r-full" : ""}`}
            style={{
              width: `${(slice.value / total) * 100}%`,
              backgroundColor: SLOTS[i],
              opacity: hover === null || hover === i ? 1 : 0.55,
              transition: "opacity 160ms ease, width 420ms cubic-bezier(0.22, 0.9, 0.3, 1)",
            }}
          />
        ))}
      </div>

      {/* Legend — always present for two or more series, so identity never
          rests on colour alone. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {shown.map((slice, i) => (
          <li
            key={slice.name}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            className="flex items-center gap-1.5 text-[11px]"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: SLOTS[i] }}
            />
            <span className="capitalize text-foreground-muted">{slice.name}</span>
            {/* Both numbers stay on screen. Hiding the absolute count in a
                hover title would gate a value behind the pointer — and the
                list this replaced showed "1.2K (68%)" without one. */}
            <span className="tabular-nums text-foreground">{formatValue(slice.value)}</span>
            <span className="tabular-nums text-foreground-subtle">
              {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
