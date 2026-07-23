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

type Recipient = { key: string; label: string; handle: string | null; yieldShare: number; earned: number; color: string; isSopa: boolean };

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
    { key: "sopa", label: "Tesouro SOPA", handle: null, yieldShare: feeToSopa, earned: sopaEarned, color: "var(--accent)", isSopa: true },
    ...backers.map((d, i) => ({
      key: d.address,
      label: d.label ?? short(d.address),
      // A member (label present) has a Hive PFP; an unknown wallet keeps initials.
      handle: d.label,
      yieldShare: (1 - feeToSopa) * (d.assets / totalDeposited),
      earned: d.earned,
      color: PALETTE[i % PALETTE.length],
      isSopa: false,
    })),
  ];

  // Ribbon geometry — thick gradient bands fanning out from the vault node.
  const W = 960;
  const srcX = 150;
  const srcR = 56;
  const srcEdgeX = srcX + srcR - 2;
  const dstX = 690; // ribbon end
  const nodeX = 712; // endpoint node center
  const rowGap = 108;
  const H = Math.max(recipients.length * rowGap + 44, 260);
  const srcY = H / 2;
  const yAt = (i: number) => srcY - ((recipients.length - 1) / 2) * rowGap + i * rowGap;
  const ribbonPath = (y: number) => {
    const cp1 = srcEdgeX + 0.44 * (dstX - srcEdgeX);
    const cp2 = srcEdgeX + 0.56 * (dstX - srcEdgeX);
    return `M${srcEdgeX},${srcY} C${cp1},${srcY} ${cp2},${y} ${dstX},${y}`;
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Fluxo do rendimento</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-muted">
            O que o cofre rende na Moonwell se divide: {pct(feeToSopa * 100)} pro tesouro da SOPA e o resto volta pra quem depositou.
          </p>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-success">
          <span className="vfv-pulse h-[7px] w-[7px] rounded-full bg-success" />
          rendendo ao vivo
        </span>
      </div>

      {/* Realized so far — the accumulated total, said out loud above the flow. */}
      <div className="mt-4 inline-flex items-center gap-3 rounded-xl border border-success/20 bg-success/[0.06] px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Rendido até agora</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-success">{acc(earnedTotal)}</span>
        <span className="h-4 w-px bg-border" />
        <span className="font-mono text-xs text-foreground-muted">{acc(sopaEarned)} <span className="text-foreground-faint">pra SOPA</span></span>
      </div>

      <div className="mt-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 600 }} role="img" aria-label="Fluxo do rendimento do cofre">
          <defs>
            <linearGradient id="vfv-gold" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="vfv-green" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--success)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--success)" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Ribbons: width ∝ yield share; SOPA gold, depositors green. */}
          {recipients.map((r, i) => {
            const y = yAt(i);
            const d = ribbonPath(y);
            const width = Math.max(5, r.yieldShare * 46);
            const grad = r.isSopa ? "url(#vfv-gold)" : "url(#vfv-green)";
            const stroke = r.isSopa ? "var(--accent)" : "var(--success)";
            const dim = r.yieldShare < 0.06;
            return (
              <g key={r.key}>
                <path d={d} fill="none" stroke={grad} strokeWidth={width} strokeLinecap="round" opacity={dim ? 0.55 : 1} />
                <path
                  className="vfv-flow"
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={Math.min(width, 6)}
                  strokeLinecap="round"
                  strokeDasharray="0.5 15"
                  strokeOpacity={dim ? 0.5 : 0.9}
                  style={{ animationDelay: `${(i % 4) * -0.5}s` }}
                />
              </g>
            );
          })}

          {/* % chip on each ribbon */}
          {recipients.map((r, i) => {
            const y = yAt(i);
            const cx = srcEdgeX + 0.5 * (dstX - srcEdgeX);
            const cy = srcY + (y - srcY) * 0.56;
            const stroke = r.isSopa ? "var(--accent)" : "var(--success)";
            const label = pct(r.yieldShare * 100);
            const w = label.length * 8 + 16;
            return (
              <g key={`c${r.key}`}>
                <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} className="fill-[var(--surface)]" stroke={stroke} strokeOpacity={0.4} />
                <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: stroke, fontFamily: "var(--font-mono)" }}>
                  {label}
                </text>
              </g>
            );
          })}

          {/* Source node — the vault */}
          <circle cx={srcX} cy={srcY} r={srcR} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
          <circle cx={srcX} cy={srcY} r={srcR} fill="none" stroke="var(--accent)" strokeWidth={8} strokeOpacity={0.12} />
          <text x={srcX} y={srcY - 20} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>COFRE</text>
          <text x={srcX} y={srcY + 6} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {usd(totalDeposited)}
          </text>
          <text x={srcX} y={srcY + 26} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {yieldMonthly != null ? `${usd(yieldMonthly)}/mês` : "rende…"}
          </text>

          {/* Endpoint nodes with avatars + labels */}
          {recipients.map((r, i) => {
            const y = yAt(i);
            const amt = yieldMonthly != null ? yieldMonthly * r.yieldShare : null;
            const stroke = r.isSopa ? "var(--accent)" : "var(--success)";
            const acColor = r.isSopa ? "var(--accent)" : "var(--success)";
            return (
              <g key={`n${r.key}`}>
                <defs>
                  <clipPath id={`vfv-clip-${i}`}>
                    <circle cx={nodeX} cy={y} r={22} />
                  </clipPath>
                </defs>
                <circle cx={nodeX} cy={y} r={24} className="fill-[var(--surface-elevated)]" stroke={stroke} strokeWidth={2} />
                <text x={nodeX} y={y + 5} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: stroke }}>
                  {r.isSopa ? "" : initials(r.label)}
                </text>
                {(r.isSopa || r.handle) && (
                  <image
                    href={r.isSopa ? "/projects/sopa/logo.png" : `https://images.hive.blog/u/${r.handle!.replace(/^@/, "")}/avatar`}
                    x={nodeX - 22}
                    y={y - 22}
                    height={44}
                    width={44}
                    clipPath={`url(#vfv-clip-${i})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                )}
                <circle cx={nodeX} cy={y} r={24} fill="none" stroke={stroke} strokeWidth={2} />
                <text x={nodeX + 34} y={y - 8} className="fill-[var(--foreground)]" style={{ fontSize: 16, fontWeight: 700 }}>
                  {r.label}
                </text>
                <text x={nodeX + 34} y={y + 11} className="fill-[var(--foreground-muted)]" style={{ fontSize: 13 }}>
                  {pct(r.yieldShare * 100)} do rendimento{amt != null ? ` · ${usd(amt)}/mês` : ""}
                </text>
                <text x={nodeX + 34} y={y + 29} style={{ fontSize: 13, fontWeight: 600, fill: acColor, fontFamily: "var(--font-mono)" }}>
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
        .vfv-flow { animation: vfv-dash 3s linear infinite; }
        @keyframes vfv-dash { to { stroke-dashoffset: -160; } }
        .vfv-pulse { animation: vfv-pulse 1.6s ease-in-out infinite; }
        @keyframes vfv-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.82); } }
        @media (prefers-reduced-motion: reduce) { .vfv-flow, .vfv-pulse { animation: none; } }
      `}</style>
    </section>
  );
}
