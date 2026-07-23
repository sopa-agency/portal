"use client";

import type { VaultDepositor } from "@/lib/vault-depositors";

// Animated flow of the vault's yield: one source (the yield the pot earns in
// Moonwell) splitting to the SOPA treasury (the performance fee) and back to
// each depositor (the rest, by their share). Same SVG+CSS particle technique as
// the payroll stream — no deps. The interest is always accruing, so it always
// animates unless the viewer asked to reduce motion.

const PALETTE = ["#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48", "#6366f1"];
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : n < 1 ? 4 : 2 })}`;
// Accumulated amounts are tiny early on — show enough digits that a sub-cent
// number isn't rounded to "$0.00".
const acc = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(6)}` : usd(n));
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-3)}`;
const initials = (s: string) => s.replace(/^@|^0x/i, "").slice(0, 2).toUpperCase();

type Recipient = { key: string; label: string; yieldShare: number; earned: number; color: string; isSopa: boolean };

export function VaultFlowView({
  depositors,
  apy,
  feeToSopa,
  sopaEarned,
}: {
  depositors: VaultDepositor[];
  /** Net APY of the vault, fraction. Null until Morpho indexes it. */
  apy: number | null;
  /** Share of the yield taken as the SOPA fee, 0–1. */
  feeToSopa: number;
  /** SOPA's accumulated performance fee so far, USDC. */
  sopaEarned: number;
}) {
  const backers = depositors.filter((d) => !d.isDeadDeposit && d.assets > 0);
  if (backers.length === 0) return null;

  const totalDeposited = backers.reduce((s, d) => s + d.assets, 0);
  const yieldMonthly = apy != null ? (totalDeposited * apy) / 12 : null;
  // Everything the vault has thrown off so far. Summing EVERY share holder's
  // gain (all depositors, incl. the dead deposit) + SOPA's fee shares equals
  // totalAssets − principal exactly — the fee minted so far and the fee still
  // riding in depositors' share price are counted once between them.
  const earnedTotal = sopaEarned + depositors.reduce((s, d) => s + d.earned, 0);
  // The performance fee is minted lazily (on each interaction), so SOPA's
  // realized cut can trail the depositors' gain until the next accrual.
  const feeLags = sopaEarned < earnedTotal * feeToSopa * 0.5;

  // Recipients of the yield: SOPA takes feeToSopa of it; each backer takes the
  // rest in proportion to their deposit. Shares sum to 1. `earned` is the real
  // amount realized so far (SOPA = its fee shares; each backer = position − principal).
  const recipients: Recipient[] = [
    { key: "sopa", label: "Tesouro SOPA", yieldShare: feeToSopa, earned: sopaEarned, color: "var(--accent)", isSopa: true },
    ...backers.map((d, i) => ({
      key: d.address,
      label: d.label ?? short(d.address),
      yieldShare: (1 - feeToSopa) * (d.assets / totalDeposited),
      earned: d.earned,
      color: PALETTE[i % PALETTE.length],
      isSopa: false,
    })),
  ];

  const W = 640;
  const rowH = 66;
  const H = Math.max(recipients.length * rowH + 24, 150);
  const srcX = 128;
  const srcY = H / 2;
  const dstX = W - 168;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Fluxo do rendimento</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          rendendo ao vivo
        </span>
      </div>
      <p className="mb-2 text-xs text-foreground-subtle">
        O que o cofre rende na Moonwell se divide: {pct(feeToSopa * 100)} pro tesouro da SOPA e o resto volta pra quem depositou.
      </p>

      {/* Realized so far — the accumulated total, said out loud above the flow. */}
      <div className="mb-3 inline-flex items-baseline gap-2 rounded-xl bg-surface-elevated px-3.5 py-2">
        <span className="text-[10px] uppercase tracking-wider text-foreground-faint">Rendido até agora</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{acc(earnedTotal)}</span>
        <span className="text-[11px] text-foreground-faint">· {acc(sopaEarned)} pra SOPA</span>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480, height: H }} role="img" aria-label="Fluxo do rendimento do cofre">
          {/* Connectors + flowing particles, one per recipient */}
          {recipients.map((r, i) => {
            const y = 24 + i * rowH + (rowH - 24) / 2;
            const width = 1.5 + r.yieldShare * 11;
            const cx = (srcX + dstX) / 2;
            const d = `M ${srcX} ${srcY} C ${cx} ${srcY}, ${cx} ${y}, ${dstX} ${y}`;
            const stroke = r.isSopa ? "var(--accent)" : r.color;
            return (
              <g key={r.key}>
                <path d={d} fill="none" stroke={stroke} strokeOpacity={0.26} strokeWidth={width} strokeLinecap="round" />
                <path
                  className="vfv-flow"
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeDasharray="2 26"
                  style={{ animationDelay: `${(i % 5) * -0.4}s` }}
                />
              </g>
            );
          })}

          {/* Source: the vault / yield engine */}
          <g>
            <circle cx={srcX} cy={srcY} r={38} className="fill-[var(--accent-bg)]" stroke="var(--accent)" strokeWidth={2} />
            <text x={srcX} y={srcY - 8} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 10, fontWeight: 700 }}>COFRE</text>
            <text x={srcX} y={srcY + 6} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 12, fontWeight: 700 }}>
              {usd(totalDeposited)}
            </text>
            <text x={srcX} y={srcY + 19} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 9 }}>
              {yieldMonthly != null ? `${usd(yieldMonthly)}/mês` : "rende…"}
            </text>
          </g>

          {/* Recipients */}
          {recipients.map((r, i) => {
            const y = 24 + i * rowH + (rowH - 24) / 2;
            const amt = yieldMonthly != null ? yieldMonthly * r.yieldShare : null;
            return (
              <g key={`n${r.key}`}>
                <circle cx={dstX} cy={y} r={16} fill={r.color} fillOpacity={r.isSopa ? 0.2 : 0.15} stroke={r.color} strokeWidth={r.isSopa ? 2 : 1.5} />
                <text x={dstX} y={y + 4} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: r.color }}>
                  {r.isSopa ? "◆" : initials(r.label)}
                </text>
                <text x={dstX + 24} y={y - 8} className="fill-[var(--foreground)]" style={{ fontSize: 12, fontWeight: r.isSopa ? 700 : 600 }}>
                  {r.label}
                </text>
                <text x={dstX + 24} y={y + 5} className="fill-[var(--foreground-faint)]" style={{ fontSize: 11 }}>
                  {pct(r.yieldShare * 100)} do rendimento{amt != null ? ` · ${usd(amt)}/mês` : ""}
                </text>
                <text x={dstX + 24} y={y + 18} style={{ fontSize: 11, fontWeight: 600, fill: r.color }}>
                  acumulado {acc(r.earned)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {feeLags && earnedTotal > 0 && (
        <p className="mt-1 text-[11px] text-foreground-faint">
          A taxa da SOPA é cobrada aos poucos (a cada movimentação do cofre), então o acumulado dela aparece atrás do ganho dos
          depositantes até a próxima cobrança — no fim, a divisão fecha em {pct(feeToSopa * 100)}.
        </p>
      )}
      {yieldMonthly == null && (
        <p className="mt-1 text-[11px] text-foreground-faint">
          Os valores em $/mês aparecem quando a Morpho indexar o APY do cofre. As fatias já estão corretas.
        </p>
      )}

      <style>{`
        .vfv-flow { animation: vfv-dash 1.4s linear infinite; }
        @keyframes vfv-dash { to { stroke-dashoffset: -28; } }
        @media (prefers-reduced-motion: reduce) { .vfv-flow { animation: none; opacity: 0.6; } }
      `}</style>
    </section>
  );
}
