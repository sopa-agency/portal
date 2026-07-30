"use client";

import type { SopaRevenueOrbit } from "@/lib/sopa-revenue-orbit";

// "Revenue" view of the org-chart: every project's REGISTERED split/swap that
// pays the SOPA treasury (the sun), flowing IN. A split shows up as soon as it's
// wired (SOPA as a recipient), even at $0 — then it fills with money. Per flow:
//   realized = gross already distributed × SOPA's share
//   pending  = what's sitting in the split now × SOPA's share (awaiting distribute)
// Width ∝ the active amount (realized, else pending); color = project; the $ is
// direct-labelled (never magnitude-by-width alone). Same animated SVG+CSS particle
// technique as the payroll/vault flow views — no deps.

// Categorical-by-project — validated (dataviz validate_palette): lightness band,
// chroma, CVD separation all pass; identity is never color-alone (direct labels).
const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 })}`;
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const initials = (s: string) => s.replace(/^@|^0x/i, "").slice(0, 2).toUpperCase();

export function OrgRevenueOrbit({ orbit }: { orbit: SopaRevenueOrbit }) {
  // One row per flow, colored by its project (a project's splits share one hue).
  // `active` = the number that drives width/label: realized if any has landed,
  // otherwise what's pending in the split; 0 only when it's wired but empty.
  const rows = orbit.projects.flatMap((p, pi) =>
    p.flows.map((f) => {
      const state = f.realizedToSopaUsd > 0 ? "realized" : f.pendingToSopaUsd > 0 ? "pending" : "wired";
      const active = f.realizedToSopaUsd > 0 ? f.realizedToSopaUsd : f.pendingToSopaUsd > 0 ? f.pendingToSopaUsd : f.estimatedToSopaUsd ?? 0;
      return { ...f, projectName: p.name, logoUrl: p.logoUrl, color: PALETTE[pi % PALETTE.length], state, active };
    }),
  );

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Revenue to SOPA</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-foreground-muted">
          No split is wired to the SOPA treasury yet. Add a split revenue stream on an org-chart card (with the SOPA Safe as a
          recipient) and it shows up here — the share is read straight from the split contract.
        </p>
      </section>
    );
  }

  const maxActive = Math.max(0, ...rows.map((r) => r.active));

  // Fan-IN geometry: project nodes on the LEFT converge into the SOPA sun (right).
  const W = 960;
  const nodeX = 150;        // left project-node center
  const nodeR = 24;
  const srcEdgeX = nodeX + nodeR + 2;
  const sopaX = 800;        // sun center (right)
  const sopaR = 62;
  const sopaEdgeX = sopaX - sopaR + 2;
  const rowGap = 100;
  const H = Math.max(rows.length * rowGap + 48, 260);
  const sopaY = H / 2;
  const yAt = (i: number) => sopaY - ((rows.length - 1) / 2) * rowGap + i * rowGap;
  const ribbonPath = (y: number) => {
    const cp1 = srcEdgeX + 0.44 * (sopaEdgeX - srcEdgeX);
    const cp2 = srcEdgeX + 0.56 * (sopaEdgeX - srcEdgeX);
    return `M${srcEdgeX},${y} C${cp1},${y} ${cp2},${sopaY} ${sopaEdgeX},${sopaY}`;
  };
  // Width by the active amount; wired-but-empty splits get a thin base so the
  // wiring is still visible.
  const widthOf = (active: number) => (maxActive > 0 ? Math.max(5, (active / maxActive) * 40) : 6);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Revenue flowing to SOPA</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-muted">
            Every project&apos;s revenue wired to the SOPA treasury, flowing in. On-chain splits show <b>realized</b> (already
            reached the Safe) and <b>pending</b> (sitting in the split awaiting distribute), with the share read from the
            contract. <b>◇ declared</b> flows are off-chain agreements — a THORChain affiliate, a builder subnet — shown at their
            agreed share to complete the map. Thickness ∝ the amount; the $ is on the label.
          </p>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
          <span className="oro-pulse h-[7px] w-[7px] rounded-full bg-accent" />
          on-chain
        </span>
      </div>

      {/* Realized + pending into SOPA — said out loud above the flow. */}
      <div className="mt-4 inline-flex flex-wrap items-center gap-3 rounded-xl border border-accent-border bg-accent-bg/60 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Realized into SOPA</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-accent">{usd(orbit.totalRealizedToSopaUsd)}</span>
        <span className="h-4 w-px bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Pending in splits</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-warning">{usd(orbit.totalPendingToSopaUsd)}</span>
        {orbit.totalEstimatedToSopaUsd > 0 && (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Estimated (declared)</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground-muted">~{usd(orbit.totalEstimatedToSopaUsd)}</span>
          </>
        )}
      </div>

      <div className="mt-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="Project revenue flowing into the SOPA treasury">
          {/* Ribbons: width ∝ active $; color = project; wired splits stay faint/static. */}
          {rows.map((r, i) => {
            const y = yAt(i);
            const d = ribbonPath(y);
            const width = widthOf(r.active);
            const wired = r.state === "wired";
            const baseOp = r.state === "realized" ? 0.5 : r.state === "pending" ? 0.34 : 0.18;
            return (
              <g key={r.key}>
                <title>{[
                  `${r.projectName} · ${r.label}  (${pct(r.sopaShare * 100)} to SOPA)`,
                  `realized: ${usd(r.grossUsd)} distributed → ${usd(r.realizedToSopaUsd)} to SOPA`,
                  `pending:  ${usd(r.splitBalanceUsd)} in split → ${usd(r.pendingToSopaUsd)} to SOPA`,
                  `${r.declared ? `declared off-chain${(r.estimatedToSopaUsd ?? 0) > 0 ? ` — ~${usd(r.estimatedToSopaUsd ?? 0)} est. to SOPA` : " — share not read from a contract"}` : r.method ? (r.method === "auction" ? "auction" : "swap") : "no revenue event yet"} · ${r.address}`,
                ].join("\n")}</title>
                <path d={d} fill="none" stroke={r.color} strokeOpacity={baseOp} strokeWidth={width} strokeLinecap="round" strokeDasharray={wired ? "6 8" : undefined} />
                {!wired && (
                  <path
                    className="oro-flow"
                    d={d}
                    fill="none"
                    stroke={r.color}
                    strokeWidth={Math.min(width, 5)}
                    strokeLinecap="round"
                    strokeDasharray="0.5 15"
                    strokeOpacity={r.state === "pending" ? 0.7 : 0.95}
                    style={{ animationDelay: `${(i % 4) * -0.5}s` }}
                  />
                )}
              </g>
            );
          })}

          {/* $ chip mid-ribbon — magnitude direct-labelled, never width-alone. */}
          {rows.map((r, i) => {
            const y = yAt(i);
            const cx = srcEdgeX + 0.5 * (sopaEdgeX - srcEdgeX);
            const cy = y + (sopaY - y) * 0.5;
            const est = r.estimatedToSopaUsd ?? 0;
            const label = r.declared && est > 0 ? `~${usd(est)}` : r.state === "wired" ? pct(r.sopaShare * 100) : usd(r.active);
            const ink = r.state === "realized" ? "var(--foreground)" : r.state === "pending" ? "var(--warning)" : "var(--foreground-faint)";
            const w = label.length * 8 + 16;
            return (
              <g key={`c${r.key}`}>
                <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} className="fill-[var(--surface)]" stroke={r.color} strokeOpacity={0.45} />
                <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: ink, fontFamily: "var(--font-mono)" }}>
                  {label}
                </text>
              </g>
            );
          })}

          {/* Project source nodes (left) with logo/initials + name + split + share. */}
          {rows.map((r, i) => {
            const y = yAt(i);
            const tag = r.declared ? "◇ declared" : r.method ? (r.method === "auction" ? "🔨 auction" : "💧 swap") : r.state === "pending" ? "⏳ pending" : "○ wired";
            return (
              <g key={`n${r.key}`}>
                <defs>
                  <clipPath id={`oro-clip-${i}`}>
                    <circle cx={nodeX} cy={y} r={nodeR - 2} />
                  </clipPath>
                </defs>
                <circle cx={nodeX} cy={y} r={nodeR} className="fill-[var(--surface-elevated)]" stroke={r.color} strokeWidth={2} />
                <text x={nodeX} y={y + 5} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: r.color }}>
                  {r.logoUrl ? "" : initials(r.projectName)}
                </text>
                {r.logoUrl && (
                  <image href={r.logoUrl} x={nodeX - (nodeR - 2)} y={y - (nodeR - 2)} height={(nodeR - 2) * 2} width={(nodeR - 2) * 2} clipPath={`url(#oro-clip-${i})`} preserveAspectRatio="xMidYMid slice" />
                )}
                <circle cx={nodeX} cy={y} r={nodeR} fill="none" stroke={r.color} strokeWidth={2} />
                <text x={nodeX + nodeR + 12} y={y - 8} className="fill-[var(--foreground)]" style={{ fontSize: 15, fontWeight: 700 }}>
                  {r.projectName}
                </text>
                <text x={nodeX + nodeR + 12} y={y + 11} className="fill-[var(--foreground-muted)]" style={{ fontSize: 12 }}>
                  {r.label} · {pct(r.sopaShare * 100)} to SOPA
                </text>
                <text x={nodeX + nodeR + 12} y={y + 28} style={{ fontSize: 11, fill: "var(--foreground-faint)", fontFamily: "var(--font-mono)" }}>
                  {tag} · {short(r.address)}
                </text>
              </g>
            );
          })}

          {/* SOPA sun (right) */}
          <circle cx={sopaX} cy={sopaY} r={sopaR} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
          <circle cx={sopaX} cy={sopaY} r={sopaR} fill="none" stroke="var(--accent)" strokeWidth={10} strokeOpacity={0.12} />
          <text x={sopaX} y={sopaY - 24} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>TREASURY</text>
          <text x={sopaX} y={sopaY + 2} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {usd(orbit.totalRealizedToSopaUsd)}
          </text>
          <text x={sopaX} y={sopaY + 22} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
            {orbit.totalPendingToSopaUsd > 0 ? `+ ${usd(orbit.totalPendingToSopaUsd)} pending` : "SOPA"}
          </text>
        </svg>
      </div>

      <p className="mt-1 text-[11px] text-foreground-faint">
        Splits appear as soon as they&apos;re wired to SOPA (share read from the contract). Solid = realized (distributed);
        dashed = pending in the split; faint = wired/declared, $0 measured so far. <b>◇ declared</b> = off-chain agreement, not
        yet on-chain. Hover a ribbon for the full breakdown.
      </p>

      <style>{`
        .oro-flow { animation: oro-dash 3s linear infinite; }
        @keyframes oro-dash { to { stroke-dashoffset: -160; } }
        .oro-pulse { animation: oro-pulse 1.6s ease-in-out infinite; }
        @keyframes oro-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.82); } }
        @media (prefers-reduced-motion: reduce) { .oro-flow, .oro-pulse { animation: none; } }
      `}</style>
    </section>
  );
}
