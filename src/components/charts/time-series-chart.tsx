"use client";

// Trend over time. A line per series, an area wash under a lone series, and a
// crosshair that snaps to the nearest date — readers aim at a day, never at a
// 2px stroke.
//
// Replaces a 48px strip of bare bars: at 90 days those were ~1px wide, carried
// no axis, no dates, and no way to read a value except a native title
// attribute. The shape of a month was guesswork.
//
// Mark specs (dataviz): 2px line, round joins; area at 10%; end dot r=4 with a
// 2px surface ring; hairline solid gridlines one step off the surface; text in
// text tokens, never in the series colour.

import { useId, useState } from "react";
import { useChartWidth } from "@/components/charts/use-chart-width";

export type Series = {
  /** Slot colour, e.g. "var(--viz-1)". Marks only — never applied to text. */
  color: string;
  label: string;
  points: number[];
};

const PAD = { top: 12, right: 12, bottom: 22, left: 44 };
const HEIGHT = 200;

/** Rounded, human tick values covering 0..max — never raw maxima. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function TimeSeriesChart({
  labels,
  series,
  formatValue = compact,
  emptyLabel,
  tableLabel,
  dateLabel,
}: {
  /** One per point — already formatted for display (e.g. "7 ago"). */
  labels: string[];
  series: Series[];
  formatValue?: (n: number) => string;
  emptyLabel: string;
  /** Disclosure that opens the table view — values must never be hover-gated. */
  tableLabel: string;
  dateLabel: string;
}) {
  const [ref, width] = useChartWidth();
  const [active, setActive] = useState<number | null>(null);
  const clipId = useId();

  const count = labels.length;
  const hasData = count > 0 && series.some((s) => s.points.some((p) => p > 0));

  const plotW = Math.max(width - PAD.left - PAD.right, 10);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(...series.flatMap((s) => s.points), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const x = (i: number) => (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => plotH - (v / top) * plotH;

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!hasData || count === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const rel = event.clientX - box.left - PAD.left;
    const i = Math.round((rel / plotW) * (count - 1));
    setActive(Math.max(0, Math.min(count - 1, i)));
  };

  const onKey = (event: React.KeyboardEvent) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    setActive((prev) => {
      const next = (prev ?? (delta > 0 ? -1 : count)) + delta;
      return Math.max(0, Math.min(count - 1, next));
    });
  };

  // The readout lives ABOVE the plot, not floating over it: a tooltip anchored
  // to the crosshair sat on top of the line exactly where the reader was
  // looking. It always occupies its row, so nothing shifts when it fills in,
  // and it falls back to the last point when nothing is hovered.
  const read = active ?? (hasData ? count - 1 : null);

  return (
    <div ref={ref} className="w-full">
      <div className="mb-1 flex h-5 flex-wrap items-baseline justify-end gap-x-3 text-xs">
        {read !== null && (
          <>
            <span className="text-foreground-subtle">{labels[read]}</span>
            {series.map((s) => (
              <span key={s.label} className="flex items-baseline gap-1.5">
                <span
                  aria-hidden
                  className="h-0.5 w-3 shrink-0 self-center rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-semibold tabular-nums text-foreground">
                  {formatValue(s.points[read] ?? 0)}
                </span>
                <span className="text-[10px] text-foreground-subtle">{s.label}</span>
              </span>
            ))}
          </>
        )}
      </div>

      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={series.map((s) => s.label).join(", ")}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((p) => p ?? count - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          className="touch-none outline-none focus-visible:ring-1 focus-visible:ring-accent-border"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Gridlines + y ticks. Hairline, solid, one step off the surface. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={0}
                  x2={plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={-8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-foreground-faint text-[10px] tabular-nums"
                >
                  {formatValue(t)}
                </text>
              </g>
            ))}

            {hasData && (
              <g clipPath={`url(#${clipId})`}>
                {series.map((s) => {
                  const line = s.points
                    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`)
                    .join(" ");
                  return (
                    <g key={s.label}>
                      {/* Area only for a lone series: two washes overlapping
                          would read as a third colour. */}
                      {series.length === 1 && (
                        <path
                          d={`${line} L${x(count - 1)},${plotH} L${x(0)},${plotH} Z`}
                          fill={s.color}
                          opacity={0.1}
                        />
                      )}
                      <path
                        d={line}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  );
                })}
              </g>
            )}

            {/* Crosshair + the dots it reads. */}
            {hasData && active !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1={0}
                  y2={plotH}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s) => (
                  <circle
                    key={s.label}
                    cx={x(active)}
                    cy={y(s.points[active] ?? 0)}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}

            {/* X labels: first, middle and last only — a tick per day is noise. */}
            {[0, Math.floor((count - 1) / 2), count - 1]
              .filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx)
              .map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={plotH + 16}
                  textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"}
                  className="fill-foreground-faint text-[10px]"
                >
                  {labels[i]}
                </text>
              ))}
          </g>
        </svg>
      )}

      {!hasData && width > 0 && (
        <p className="py-12 text-center text-xs text-foreground-faint">{emptyLabel}</p>
      )}

      {/* Table view: the same numbers without a pointer. A tooltip may enhance,
          it may never be the only way to read a value. */}
      {hasData && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[10px] text-foreground-faint transition-colors hover:text-foreground-muted [&::-webkit-details-marker]:hidden">
            {tableLabel}
          </summary>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-surface-elevated">
                <tr className="text-foreground-subtle">
                  <th scope="col" className="px-2 py-1 font-medium">{dateLabel}</th>
                  {series.map((s) => (
                    <th key={s.label} scope="col" className="px-2 py-1 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((label, i) => (
                  <tr key={label + i} className="border-t border-border">
                    <th scope="row" className="px-2 py-1 font-normal text-foreground-muted">
                      {label}
                    </th>
                    {series.map((s) => (
                      <td
                        key={s.label}
                        className="px-2 py-1 text-right tabular-nums text-foreground"
                      >
                        {formatValue(s.points[i] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
