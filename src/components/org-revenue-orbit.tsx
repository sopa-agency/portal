"use client";

import type { SopaRevenueOrbit } from "@/lib/sopa-revenue-orbit";

// "Revenue" view of the org-chart: every project's swap-split / auction revenue
// flowing INTO the SOPA treasury (the sun). Same animated SVG+CSS particle
// technique as the payroll/vault flow views — no deps. Each ribbon is one split
// where SOPA is a recipient; its width ∝ what lands in the SOPA Safe, its color
// identifies the project, and the $ is direct-labelled (never magnitude-by-width
// alone). Native <title> gives the gross + address on hover.

// Categorical-by-project — validated (dataviz validate_palette): lightness band,
// chroma, CVD separation all pass; identity is never color-alone (direct labels).
const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 })}`;
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const initials = (s: string) => s.replace(/^@|^0x/i, "").slice(0, 2).toUpperCase();

export function OrgRevenueOrbit({ orbit }: { orbit: SopaRevenueOrbit }) {
  // Flatten to one row per flow, colored by its project (a project's splits
  // share one hue). Ordered by projects (already sorted by $ to SOPA desc).
  const rows = orbit.projects.flatMap((p, pi) =>
    p.flows.map((f) => ({ ...f, projectName: p.name, logoUrl: p.logoUrl, color: PALETTE[pi % PALETTE.length] })),
  );

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Revenue to SOPA</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-foreground-muted">
          No split/swap with realized revenue points to the SOPA treasury yet. As soon as a project generates some (e.g. a swap
          split&apos;s fee lands in the Safe), the flow shows up here.
        </p>
      </section>
    );
  }

  const maxToSopa = Math.max(...rows.map((r) => r.toSopaUsd));

  // Fan-IN geometry: project nodes on the LEFT converge into the SOPA sun (right).
  const W = 960;
  const nodeX = 150;        // left project-node center
  const nodeR = 24;
  const srcEdgeX = nodeX + nodeR + 2;
  const sopaX = 800;        // sun center (right)
  const sopaR = 60;
  const sopaEdgeX = sopaX - sopaR + 2;
  const rowGap = 100;
  const H = Math.max(rows.length * rowGap + 48, 260);
  const sopaY = H / 2;
  const yAt = (i: number) => sopaY - ((rows.length - 1) / 2) * rowGap + i * rowGap;
  // Curve from each project's row (left) into the sun's center (right).
  const ribbonPath = (y: number) => {
    const cp1 = srcEdgeX + 0.44 * (sopaEdgeX - srcEdgeX);
    const cp2 = srcEdgeX + 0.56 * (sopaEdgeX - srcEdgeX);
    return `M${srcEdgeX},${y} C${cp1},${y} ${cp2},${sopaY} ${sopaEdgeX},${sopaY}`;
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Revenue flowing to SOPA</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground-muted">
            Each project and its swap splits generating for the SOPA treasury. The thickness is the share that <b>lands in the
            Safe</b> (gross × SOPA&apos;s cut, read from the split itself); the full amount is on the label.
          </p>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
          <span className="oro-pulse h-[7px] w-[7px] rounded-full bg-accent" />
          on-chain
        </span>
      </div>

      {/* Total realized into SOPA — said out loud above the flow. */}
      <div className="mt-4 inline-flex flex-wrap items-center gap-3 rounded-xl border border-accent-border bg-accent-bg/60 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Into SOPA</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-accent">{usd(orbit.totalToSopaUsd)}</span>
        <span className="h-4 w-px bg-border" />
        <span className="font-mono text-xs text-foreground-muted">
          of {usd(orbit.grossTotalUsd)} <span className="text-foreground-faint">distributed</span>
        </span>
      </div>

      <div className="mt-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640 }} role="img" aria-label="Project revenue flowing into the SOPA treasury">
          {/* Ribbons: width ∝ $ into SOPA; color = project. */}
          {rows.map((r, i) => {
            const y = yAt(i);
            const d = ribbonPath(y);
            const width = Math.max(4, (r.toSopaUsd / maxToSopa) * 40);
            const dim = r.toSopaUsd / maxToSopa < 0.08;
            return (
              <g key={r.key}>
                <title>{`${r.projectName} · ${r.label}\n${usd(r.grossUsd)} distributed → ${usd(r.toSopaUsd)} to SOPA (${pct(r.sopaShare * 100)}) · ${r.method === "auction" ? "auction" : "swap"}\n${r.address}`}</title>
                <path d={d} fill="none" stroke={r.color} strokeOpacity={dim ? 0.28 : 0.45} strokeWidth={width} strokeLinecap="round" />
                <path
                  className="oro-flow"
                  d={d}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={Math.min(width, 5)}
                  strokeLinecap="round"
                  strokeDasharray="0.5 15"
                  strokeOpacity={dim ? 0.55 : 0.95}
                  style={{ animationDelay: `${(i % 4) * -0.5}s` }}
                />
              </g>
            );
          })}

          {/* $ chip mid-ribbon — magnitude direct-labelled, never width-alone. */}
          {rows.map((r, i) => {
            const y = yAt(i);
            const cx = srcEdgeX + 0.5 * (sopaEdgeX - srcEdgeX);
            const cy = y + (sopaY - y) * 0.5;
            const label = usd(r.toSopaUsd);
            const w = label.length * 8 + 16;
            return (
              <g key={`c${r.key}`}>
                <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} className="fill-[var(--surface)]" stroke={r.color} strokeOpacity={0.45} />
                <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: "var(--foreground)", fontFamily: "var(--font-mono)" }}>
                  {label}
                </text>
              </g>
            );
          })}

          {/* Project source nodes (left) with logo/initials + name + split + share. */}
          {rows.map((r, i) => {
            const y = yAt(i);
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
                  {r.method === "auction" ? "🔨 auction" : "💧 swap"} · {short(r.address)}
                </text>
              </g>
            );
          })}

          {/* SOPA sun (right) */}
          <circle cx={sopaX} cy={sopaY} r={sopaR} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
          <circle cx={sopaX} cy={sopaY} r={sopaR} fill="none" stroke="var(--accent)" strokeWidth={10} strokeOpacity={0.12} />
          <text x={sopaX} y={sopaY - 22} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>TREASURY</text>
          <text x={sopaX} y={sopaY + 4} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {usd(orbit.totalToSopaUsd)}
          </text>
          <text x={sopaX} y={sopaY + 24} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
            SOPA
          </text>
        </svg>
      </div>

      <p className="mt-1 text-[11px] text-foreground-faint">
        Only splits/swaps where SOPA is a real recipient show up (the share is read from the contract). Hover a ribbon to see the
        gross, the method and the address.
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
