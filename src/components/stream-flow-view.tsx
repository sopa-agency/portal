"use client";

// Animated flow view of the payroll stream: a source (the pool) with money
// "flowing" along connectors to each member, thickness + label by their share.
// Pure SVG + CSS (no deps); animates only when the stream is live and the
// viewer hasn't asked to reduce motion.

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const initials = (s: string) => s.replace(/^@/, "").slice(0, 2).toUpperCase();

export function StreamFlowView({
  members,
  streaming,
  monthlyUsd,
}: {
  members: { label: string; units: number }[];
  streaming: boolean;
  monthlyUsd: number | null;
}) {
  const active = members.filter((m) => m.units > 0);
  if (active.length === 0) return null;

  const total = active.reduce((s, m) => s + m.units, 0);
  const W = 640;
  const rowH = 62;
  const H = Math.max(active.length * rowH + 24, 140);
  const srcX = 120;
  const srcY = H / 2;
  const dstX = W - 150;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Fluxo do pagamento</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${streaming ? "bg-success/15 text-success" : "bg-foreground/10 text-foreground-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${streaming ? "bg-success" : "bg-foreground-faint"}`} />
          {streaming ? "streaming ao vivo" : "parado"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 460, height: H }} role="img" aria-label="Fluxo de pagamento por membro">
          {/* Connectors + flowing particles */}
          {active.map((m, i) => {
            const y = 24 + i * rowH + (rowH - 24) / 2;
            const share = m.units / total;
            const color = PALETTE[i % PALETTE.length];
            const width = 1.5 + share * 9;
            const cx = (srcX + dstX) / 2;
            const d = `M ${srcX} ${srcY} C ${cx} ${srcY}, ${cx} ${y}, ${dstX} ${y}`;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={width} strokeLinecap="round" />
                {streaming && (
                  <path
                    className="sfv-flow"
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={width}
                    strokeLinecap="round"
                    strokeDasharray="2 26"
                    style={{ animationDelay: `${(i % 5) * -0.4}s` }}
                  />
                )}
              </g>
            );
          })}

          {/* Source node */}
          <g>
            <circle cx={srcX} cy={srcY} r={34} className="fill-[var(--accent-bg)]" stroke="var(--accent)" strokeWidth={2} />
            <text x={srcX} y={srcY - 3} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 11, fontWeight: 700 }}>POOL</text>
            <text x={srcX} y={srcY + 12} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 11, fontWeight: 700 }}>
              {monthlyUsd != null ? `${usd(monthlyUsd)}/mês` : "—"}
            </text>
          </g>

          {/* Member nodes */}
          {active.map((m, i) => {
            const y = 24 + i * rowH + (rowH - 24) / 2;
            const share = m.units / total;
            const color = PALETTE[i % PALETTE.length];
            return (
              <g key={`n${i}`}>
                <circle cx={dstX} cy={y} r={15} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1.5} />
                <text x={dstX} y={y + 4} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: color }}>{initials(m.label)}</text>
                <text x={dstX + 22} y={y - 2} className="fill-[var(--foreground)]" style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</text>
                <text x={dstX + 22} y={y + 12} className="fill-[var(--foreground-faint)]" style={{ fontSize: 11 }}>
                  {pct(share * 100)}{monthlyUsd != null ? ` · ${usd(monthlyUsd * share)}/mês` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <style>{`
        .sfv-flow { animation: sfv-dash 1.4s linear infinite; }
        @keyframes sfv-dash { to { stroke-dashoffset: -28; } }
        @media (prefers-reduced-motion: reduce) { .sfv-flow { animation: none; opacity: 0.6; } }
      `}</style>
    </section>
  );
}
