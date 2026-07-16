// Pure SVG revenue visualisations shared by the org-chart card dialog and the
// treasury Receita section. No hooks → works as a server or client component.

/** Tiny inline sparkline of a revenue address's balance over time. */
export function Sparkline({ points }: { points: { usd: number }[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.usd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 64;
  const H = 16;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p.usd - min) / span) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={W} height={H} className="shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={up ? "#10b981" : "#f43f5e"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Cumulative-received area chart (on-chain revenue/profit curve) for one address. */
export function RevenueChart({ series }: { series: { t: string; usd: number }[] }) {
  if (series.length < 2) return null;
  const W = 260;
  const H = 44;
  const t0 = Date.parse(series[0].t);
  const t1 = Date.parse(series[series.length - 1].t) || t0 + 1;
  const span = t1 - t0 || 1;
  const max = series[series.length - 1].usd || 1; // cumulative → last is max
  const pt = (p: { t: string; usd: number }) => {
    const x = ((Date.parse(p.t) - t0) / span) * W;
    const y = H - (p.usd / max) * (H - 4) - 2;
    return [x, y] as const;
  };
  const line = series.map((p, i) => { const [x, y] = pt(p); return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");
  const [lastX] = pt(series[series.length - 1]);
  const area = `${line} L${lastX.toFixed(1)},${H} L0,${H} Z`;
  const fmtT = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return (
    <div className="w-full">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block" style={{ height: H }} aria-hidden>
        <path d={area} fill="#10b98122" />
        <path d={line} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[9px] text-foreground-faint">
        <span>{fmtT(series[0].t)}</span>
        <span>recebido acumulado</span>
        <span>{fmtT(series[series.length - 1].t)}</span>
      </div>
    </div>
  );
}
