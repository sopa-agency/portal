"use client";

import type { SopaRevenueOrbit, SopaSupport } from "@/lib/sopa-revenue-orbit";

// Two-sided "orbit" of the org-chart: the SOPA treasury (the sun) sits in the
// CENTER, fed from both sides.
//   • LEFT  — REVENUE: every registered split/swap where SOPA is a recipient.
//     realized = distributed × share, pending = sitting in the split × share,
//     ◇ declared = off-chain agreement shown at its agreed share.
//   • RIGHT — SUPPORT: people who stake the "Apoiar" community vault; their
//     deposits earn yield and a share flows to SOPA, so each backer is a support
//     inflow. Width ∝ amount; the $ is direct-labelled (never width-alone).
// Same animated SVG+CSS particle technique as the payroll/vault flow views.

// Revenue projects — validated categorical palette (dataviz validate_palette).
const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48"];
// Supporters share a cool teal/green family so the two sides read as distinct
// categories even before you notice they're on opposite sides.
const SUPPORT_PALETTE = ["#2dd4bf", "#22d3ee", "#34d399", "#38bdf8", "#4ade80", "#5eead4"];

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : n >= 1 ? 2 : 4 })}`;
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const initials = (s: string) => s.replace(/^@|^0x/i, "").slice(0, 2).toUpperCase();

const MAX_SUPPORTERS = 9; // beyond this, the tail collapses into one "+N more" row

export function OrgRevenueOrbit({ orbit, support }: { orbit: SopaRevenueOrbit; support?: SopaSupport }) {
  // LEFT rows — revenue flows, colored by project. `active` drives width/label:
  // realized, else pending, else the declared estimate; 0 only when wired empty.
  const revRows = orbit.projects.flatMap((p, pi) =>
    p.flows.map((f) => {
      const state = f.realizedToSopaUsd > 0 ? "realized" : f.pendingToSopaUsd > 0 ? "pending" : "wired";
      const active = f.realizedToSopaUsd > 0 ? f.realizedToSopaUsd : f.pendingToSopaUsd > 0 ? f.pendingToSopaUsd : f.estimatedToSopaUsd ?? 0;
      return { ...f, projectName: p.name, logoUrl: p.logoUrl, color: PALETTE[pi % PALETTE.length], state, active };
    }),
  );

  // RIGHT rows — support-vault backers, largest first, tail collapsed.
  const allSup = support?.supporters ?? [];
  const supRows =
    allSup.length > MAX_SUPPORTERS
      ? [
          ...allSup.slice(0, MAX_SUPPORTERS - 1),
          {
            key: "others",
            label: `+${allSup.length - (MAX_SUPPORTERS - 1)} backers`,
            address: "",
            avatarUrl: null,
            amountUsd: allSup.slice(MAX_SUPPORTERS - 1).reduce((s, d) => s + d.amountUsd, 0),
            earnedUsd: allSup.slice(MAX_SUPPORTERS - 1).reduce((s, d) => s + d.earnedUsd, 0),
          },
        ]
      : allSup;

  if (revRows.length === 0 && supRows.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">The SOPA treasury</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-foreground-muted">
          Nothing is wired to the treasury yet. Register a revenue split on an org-chart card, or back the community support
          vault, and it shows up here — revenue on the left, backers on the right.
        </p>
      </section>
    );
  }

  const maxRev = Math.max(0, ...revRows.map((r) => r.active));
  const maxSup = Math.max(0, ...supRows.map((r) => r.amountUsd));

  // Geometry — sun centered, two fan-ins.
  const W = 980;
  const nodeR = 22;
  const leftNodeX = 116;
  const rightNodeX = W - 116;
  const sunX = W / 2;
  const sunR = 56;
  const leftEdge = leftNodeX + nodeR + 2;
  const rightEdge = rightNodeX - nodeR - 2;
  const sunLeftEdge = sunX - sunR + 2;
  const sunRightEdge = sunX + sunR - 2;
  const rowGap = 92;
  const rowsMax = Math.max(revRows.length, supRows.length, 1);
  const H = Math.max(rowsMax * rowGap + 56, 260);
  const sunY = H / 2;
  // Each side centers its own rows around the sun's vertical middle.
  const yAt = (i: number, n: number) => sunY - ((n - 1) / 2) * rowGap + i * rowGap;
  const ribbonPath = (fromX: number, y: number, toX: number) => {
    const dx = toX - fromX;
    const cp1 = fromX + 0.44 * dx;
    const cp2 = fromX + 0.56 * dx;
    return `M${fromX},${y} C${cp1},${y} ${cp2},${sunY} ${toX},${sunY}`;
  };
  const revWidth = (active: number) => (maxRev > 0 ? Math.max(5, (active / maxRev) * 38) : 6);
  const supWidth = (amount: number) => (maxSup > 0 ? Math.max(5, (amount / maxSup) * 38) : 6);

  const backersTotal = support?.totalDepositedUsd ?? 0;
  const backersCount = allSup.length;
  const totalEarned = support?.totalEarnedUsd ?? 0;
  const sopaEarned = support?.sopaEarnedUsd ?? 0;
  // Total accruing to SOPA across every source: revenue splits already
  // distributed + the declared/estimated share (MOR builder) + the vault-yield
  // fee accrued to the Safe. Pending (still in the splits) stays a sub-line.
  const sunTotal = orbit.totalRealizedToSopaUsd + orbit.totalEstimatedToSopaUsd + sopaEarned;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">How the SOPA treasury is funded</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted">
            The treasury (center) is fed from two sides. <b className="text-foreground">Revenue</b> flows in on the left —
            registered splits where SOPA is a recipient (<b>realized</b>, <b>pending</b>, and <b>◇ declared</b> off-chain
            agreements). <b className="text-foreground">Community backers</b> flow in on the right — everyone staking the Apoiar
            support vault, whose yield shares route to SOPA. Thickness ∝ the amount; the $ is on the label.
          </p>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-accent-border bg-accent-bg px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
          <span className="oro-pulse h-[7px] w-[7px] rounded-full bg-accent" />
          on-chain
        </span>
      </div>

      <div className="mt-4 inline-flex flex-wrap items-center gap-3 rounded-xl border border-accent-border bg-accent-bg/60 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Realized revenue</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-accent">{usd(orbit.totalRealizedToSopaUsd)}</span>
        <span className="h-4 w-px bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Pending</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-warning">{usd(orbit.totalPendingToSopaUsd)}</span>
        {orbit.totalEstimatedToSopaUsd > 0 && (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Est. (declared)</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground-muted">~{usd(orbit.totalEstimatedToSopaUsd)}</span>
          </>
        )}
        {backersCount > 0 && (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Community backing</span>
            <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: SUPPORT_PALETTE[0] }}>
              {usd(backersTotal)} · {backersCount}
            </span>
          </>
        )}
        {totalEarned > 0 && (
          <>
            <span className="h-4 w-px bg-border" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-faint">Vault yield</span>
            <span className="font-mono text-sm font-semibold tabular-nums" style={{ color: SUPPORT_PALETTE[2] }}>
              {usd(totalEarned)} · {usd(sopaEarned)} → SOPA
            </span>
          </>
        )}
      </div>

      <div className="mt-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 720 }} role="img" aria-label="Revenue and community support flowing into the SOPA treasury">
          {/* ================= LEFT: revenue ribbons ================= */}
          {revRows.map((r, i) => {
            const y = yAt(i, revRows.length);
            const d = ribbonPath(leftEdge, y, sunLeftEdge);
            const width = revWidth(r.active);
            const wired = r.state === "wired";
            const baseOp = r.state === "realized" ? 0.5 : r.state === "pending" ? 0.34 : 0.18;
            return (
              <g key={`rev-${r.key}`}>
                <title>{[
                  `${r.projectName} · ${r.label}  (${pct(r.sopaShare * 100)} to SOPA)`,
                  `realized: ${usd(r.grossUsd)} distributed → ${usd(r.realizedToSopaUsd)} to SOPA`,
                  `pending:  ${usd(r.splitBalanceUsd)} in split → ${usd(r.pendingToSopaUsd)} to SOPA`,
                  `${r.declared ? `declared off-chain${(r.estimatedToSopaUsd ?? 0) > 0 ? ` — ~${usd(r.estimatedToSopaUsd ?? 0)} est. to SOPA` : " — share not read from a contract"}` : r.method ? (r.method === "auction" ? "auction" : "swap") : "no revenue event yet"} · ${r.address}`,
                ].join("\n")}</title>
                <path d={d} fill="none" stroke={r.color} strokeOpacity={baseOp} strokeWidth={width} strokeLinecap="round" strokeDasharray={wired ? "6 8" : undefined} />
                {!wired && (
                  <path className="oro-flow" d={d} fill="none" stroke={r.color} strokeWidth={Math.min(width, 5)} strokeLinecap="round" strokeDasharray="0.5 15" strokeOpacity={r.state === "pending" ? 0.7 : 0.95} style={{ animationDelay: `${(i % 4) * -0.5}s` }} />
                )}
              </g>
            );
          })}

          {/* ================= RIGHT: support ribbons ================= */}
          {supRows.map((r, i) => {
            const y = yAt(i, supRows.length);
            const d = ribbonPath(rightEdge, y, sunRightEdge);
            const color = SUPPORT_PALETTE[i % SUPPORT_PALETTE.length];
            return (
              <g key={`sup-${r.key}`}>
                <title>{`${r.label} · staking the Apoiar vault\n${usd(r.amountUsd)} deposited · ${usd(r.earnedUsd)} yield earned${r.address ? `\n${r.address}` : ""}`}</title>
                <path d={d} fill="none" stroke={color} strokeOpacity={0.42} strokeWidth={supWidth(r.amountUsd)} strokeLinecap="round" />
                <path className="oro-flow oro-flow-rev" d={d} fill="none" stroke={color} strokeWidth={Math.min(supWidth(r.amountUsd), 5)} strokeLinecap="round" strokeDasharray="0.5 15" strokeOpacity={0.9} style={{ animationDelay: `${(i % 4) * -0.5}s` }} />
              </g>
            );
          })}

          {/* ================= chips ================= */}
          {revRows.map((r, i) => {
            const y = yAt(i, revRows.length);
            const cx = leftEdge + 0.5 * (sunLeftEdge - leftEdge);
            const cy = y + (sunY - y) * 0.5;
            const est = r.estimatedToSopaUsd ?? 0;
            const label = r.declared && est > 0 ? `~${usd(est)}` : r.state === "wired" ? pct(r.sopaShare * 100) : usd(r.active);
            const ink = r.state === "realized" ? "var(--foreground)" : r.state === "pending" ? "var(--warning)" : "var(--foreground-faint)";
            const w = label.length * 8 + 16;
            return (
              <g key={`revc-${r.key}`}>
                <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} className="fill-[var(--surface)]" stroke={r.color} strokeOpacity={0.45} />
                <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: ink, fontFamily: "var(--font-mono)" }}>{label}</text>
              </g>
            );
          })}
          {supRows.map((r, i) => {
            const y = yAt(i, supRows.length);
            const cx = rightEdge + 0.5 * (sunRightEdge - rightEdge);
            const cy = y + (sunY - y) * 0.5;
            const color = SUPPORT_PALETTE[i % SUPPORT_PALETTE.length];
            const label = usd(r.amountUsd);
            const w = label.length * 8 + 16;
            return (
              <g key={`supc-${r.key}`}>
                <rect x={cx - w / 2} y={cy - 12} width={w} height={24} rx={12} className="fill-[var(--surface)]" stroke={color} strokeOpacity={0.5} />
                <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{label}</text>
              </g>
            );
          })}

          {/* ================= LEFT: revenue nodes ================= */}
          {revRows.map((r, i) => {
            const y = yAt(i, revRows.length);
            const tag = r.declared ? "◇ declared" : r.method ? (r.method === "auction" ? "🔨 auction" : "💧 swap") : r.state === "pending" ? "⏳ pending" : "○ wired";
            const so = r.splitOut;
            const outX = 44;
            const outR = 13;
            return (
              <g key={`revn-${r.key}`}>
                <defs>
                  <clipPath id={`oro-clip-rev-${i}`}>
                    <circle cx={leftNodeX} cy={y} r={nodeR - 2} />
                  </clipPath>
                </defs>
                {so && (
                  <g>
                    <title>{`↘ ${pct(so.share * 100)} of the pipeline routes out to ${so.label}${so.estimatedUsd ? ` — ~${usd(so.estimatedUsd)}` : ""}\n${so.toAddress}`}</title>
                    <path d={`M${leftNodeX - nodeR},${y} L${outX + outR},${y}`} fill="none" stroke="#f59e0b" strokeWidth={4} strokeOpacity={0.45} strokeLinecap="round" />
                    <path className="oro-flow" d={`M${leftNodeX - nodeR},${y} L${outX + outR},${y}`} fill="none" stroke="#f59e0b" strokeWidth={3} strokeLinecap="round" strokeDasharray="0.5 15" strokeOpacity={0.85} />
                    <circle cx={outX} cy={y} r={outR} className="fill-[var(--surface-elevated)]" stroke="#f59e0b" strokeWidth={2} />
                    <text x={outX} y={y + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: "#f59e0b" }}>◇</text>
                    <text x={outX} y={y + outR + 13} textAnchor="middle" className="fill-[var(--foreground-muted)]" style={{ fontSize: 10, fontWeight: 700 }}>{so.label}</text>
                    <text x={outX} y={y + outR + 25} textAnchor="middle" style={{ fontSize: 9.5, fill: "#f59e0b", fontFamily: "var(--font-mono)" }}>↘{pct(so.share * 100)}{so.estimatedUsd ? ` ~${usd(so.estimatedUsd)}` : ""}</text>
                  </g>
                )}
                <circle cx={leftNodeX} cy={y} r={nodeR} className="fill-[var(--surface-elevated)]" stroke={r.color} strokeWidth={2} />
                {r.logoUrl ? (
                  <image href={r.logoUrl} x={leftNodeX - (nodeR - 2)} y={y - (nodeR - 2)} height={(nodeR - 2) * 2} width={(nodeR - 2) * 2} clipPath={`url(#oro-clip-rev-${i})`} preserveAspectRatio="xMidYMid slice" />
                ) : (
                  <text x={leftNodeX} y={y + 5} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: r.color }}>{initials(r.projectName)}</text>
                )}
                <circle cx={leftNodeX} cy={y} r={nodeR} fill="none" stroke={r.color} strokeWidth={2} />
                <text x={leftNodeX + nodeR + 12} y={y - 8} className="fill-[var(--foreground)]" style={{ fontSize: 15, fontWeight: 700 }}>{r.projectName}</text>
                <text x={leftNodeX + nodeR + 12} y={y + 11} className="fill-[var(--foreground-muted)]" style={{ fontSize: 12 }}>{r.label} · {pct(r.sopaShare * 100)} to SOPA</text>
                <text x={leftNodeX + nodeR + 12} y={y + 28} style={{ fontSize: 11, fill: "var(--foreground-faint)", fontFamily: "var(--font-mono)" }}>{tag} · {short(r.address)}</text>
              </g>
            );
          })}

          {/* ================= RIGHT: support nodes (right-aligned text) ================= */}
          {supRows.map((r, i) => {
            const y = yAt(i, supRows.length);
            const color = SUPPORT_PALETTE[i % SUPPORT_PALETTE.length];
            const tx = rightNodeX - nodeR - 12;
            return (
              <g key={`supn-${r.key}`}>
                <defs>
                  <clipPath id={`oro-clip-sup-${i}`}>
                    <circle cx={rightNodeX} cy={y} r={nodeR - 2} />
                  </clipPath>
                </defs>
                <circle cx={rightNodeX} cy={y} r={nodeR} className="fill-[var(--surface-elevated)]" stroke={color} strokeWidth={2} />
                {r.avatarUrl ? (
                  <image href={r.avatarUrl} x={rightNodeX - (nodeR - 2)} y={y - (nodeR - 2)} height={(nodeR - 2) * 2} width={(nodeR - 2) * 2} clipPath={`url(#oro-clip-sup-${i})`} preserveAspectRatio="xMidYMid slice" />
                ) : (
                  <text x={rightNodeX} y={y + 5} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: color }}>{r.key === "others" ? "＋" : initials(r.label)}</text>
                )}
                <circle cx={rightNodeX} cy={y} r={nodeR} fill="none" stroke={color} strokeWidth={2} />
                <text x={tx} y={y - 8} textAnchor="end" className="fill-[var(--foreground)]" style={{ fontSize: 15, fontWeight: 700 }}>{r.label}</text>
                <text x={tx} y={y + 11} textAnchor="end" className="fill-[var(--foreground-muted)]" style={{ fontSize: 12 }}>{usd(r.amountUsd)} staked</text>
                <text x={tx} y={y + 28} textAnchor="end" style={{ fontSize: 11, fill: "var(--foreground-faint)", fontFamily: "var(--font-mono)" }}>
                  {r.earnedUsd > 0 ? `+${usd(r.earnedUsd)} yield` : "backer"}{r.address ? ` · ${short(r.address)}` : ""}
                </text>
              </g>
            );
          })}

          {/* ================= SOPA sun (center) ================= */}
          <circle cx={sunX} cy={sunY} r={sunR} className="fill-[var(--surface-elevated)]" stroke="var(--accent)" strokeWidth={2} />
          <circle cx={sunX} cy={sunY} r={sunR} fill="none" stroke="var(--accent)" strokeWidth={10} strokeOpacity={0.12} />
          <text x={sunX} y={sunY - 22} textAnchor="middle" className="fill-[var(--accent)]" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>SOPA REVENUE</text>
          <text x={sunX} y={sunY + 3} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontSize: 21, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{usd(sunTotal)}</text>
          <text x={sunX} y={sunY + 22} textAnchor="middle" className="fill-[var(--foreground-faint)]" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
            {backersTotal > 0 ? `+ ${usd(backersTotal)} backing` : orbit.totalPendingToSopaUsd > 0 ? `+ ${usd(orbit.totalPendingToSopaUsd)} pending` : "SOPA"}
          </text>
        </svg>
      </div>

      <p className="mt-1 text-[11px] text-foreground-faint">
        <b>Left</b> = revenue: solid = realized, dashed = pending, faint = wired, <b>◇ declared</b> = off-chain agreement.{" "}
        <b className="text-warning">Amber</b> = a portion routing back out (the Gnars DAO&apos;s 18% of the MOR → USDC pipeline).{" "}
        <b>Right</b> = community backers staking the Apoiar vault (width ∝ amount deposited). Hover any ribbon for the breakdown.
      </p>

      <style>{`
        .oro-flow { animation: oro-dash 3s linear infinite; }
        .oro-flow-rev { animation-direction: reverse; }
        @keyframes oro-dash { to { stroke-dashoffset: -160; } }
        .oro-pulse { animation: oro-pulse 1.6s ease-in-out infinite; }
        @keyframes oro-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.82); } }
        @media (prefers-reduced-motion: reduce) { .oro-flow, .oro-pulse { animation: none; } }
      `}</style>
    </section>
  );
}
