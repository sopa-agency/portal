"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Layers, Wallet } from "lucide-react";
import type { TreasuryGroup, EvmWalletReport, HiveAccountReport } from "@/lib/treasury";
import { TokenLogo } from "@/components/token-logo";
import { useT } from "@/components/locale-provider";
import type { Dictionary } from "@/lib/i18n/dictionary";

const usd = (n: number, max = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 1 ? 4 : max });
const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const pct = (n: number) => `${n >= 9.95 ? Math.round(n) : n.toFixed(1)}%`;
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Asset allocation palette — distinct hues tuned to read on BOTH light and dark
// surfaces (per the theme rules, chart colors live outside the token system).
const PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899",
  "#8b5cf6", "#84cc16", "#f97316", "#14b8a6", "#e11d48",
];
const REST_COLOR = "#94a3b8"; // slate-400 — the "Outros" bucket
const colorAt = (i: number) => PALETTE[i % PALETTE.length];

// ---------------------------------------------------------------------------
// Aggregation — collapse every wallet/account into a unified holdings list so
// the reader gets the portfolio at a glance, Zerion-style.
// ---------------------------------------------------------------------------

type Asset = { symbol: string; chains: string[]; balance: number; valueUsd: number };

function aggregateAssets(groups: TreasuryGroup[]): Asset[] {
  const map = new Map<string, Asset>();
  const add = (symbol: string, chain: string, balance: number, valueUsd: number) => {
    const k = symbol.toUpperCase();
    const a = map.get(k) ?? { symbol, chains: [], balance: 0, valueUsd: 0 };
    a.balance += balance;
    a.valueUsd += valueUsd;
    if (!a.chains.includes(chain)) a.chains.push(chain);
    map.set(k, a);
  };
  for (const g of groups) {
    const prices = g.report.prices;
    for (const w of g.report.evm) for (const t of w.tokens) add(t.symbol, t.chain, t.balance, t.valueUsd);
    for (const h of g.report.hive) {
      add("HIVE", "Hive", h.hive + h.hp, (h.hive + h.hp) * prices.hive);
      add("HBD", "Hive", h.hbd + h.hbdSavings, (h.hbd + h.hbdSavings) * prices.hbd);
    }
  }
  return [...map.values()].filter((a) => a.valueUsd > 0.5).sort((a, b) => b.valueUsd - a.valueUsd);
}

type Segment = { label: string; valueUsd: number; color: string };

/** Top-N segments + an aggregated "rest" tail, for a stacked allocation bar. */
function toSegments(items: { label: string; valueUsd: number }[], restLabel: string, topN = 6): Segment[] {
  const sorted = [...items].sort((a, b) => b.valueUsd - a.valueUsd).filter((i) => i.valueUsd > 0);
  const head = sorted.slice(0, topN).map((i, idx) => ({ ...i, color: colorAt(idx) }));
  const tail = sorted.slice(topN);
  if (tail.length) head.push({ label: restLabel, valueUsd: tail.reduce((s, i) => s + i.valueUsd, 0), color: REST_COLOR });
  return head;
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function Monogram({ symbol, color }: { symbol: string; color: string }) {
  return <TokenLogo symbol={symbol} color={color} size={28} />;
}

function AllocationBar({ segments, total }: { segments: Segment[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-border">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${Math.max((s.valueUsd / total) * 100, 0.6)}%`, backgroundColor: s.color }}
            title={`${s.label} · ${usd(s.valueUsd)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="tabular-nums text-foreground-faint">{pct((s.valueUsd / total) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** The hero + composition + holdings overview for the current view. */
function Overview({ groups, title, hideTotal = false }: { groups: TreasuryGroup[]; title: string; hideTotal?: boolean }) {
  const t = useT().treasury.views;
  const grand = groups.reduce((s, g) => s + g.report.grandTotalUsd, 0);
  const evmTotal = groups.reduce((s, g) => s + g.report.evmTotalUsd, 0);
  const hiveTotal = groups.reduce((s, g) => s + g.report.hiveTotalUsd, 0);
  const assets = useMemo(() => aggregateAssets(groups), [groups]);
  const walletCount = groups.reduce((s, g) => s + g.report.evm.length + g.report.hive.length, 0);
  const chainCount = new Set(assets.flatMap((a) => a.chains)).size;

  const assetColor = useMemo(() => {
    const m = new Map<string, string>();
    assets.slice(0, 6).forEach((a, i) => m.set(a.symbol.toUpperCase(), colorAt(i)));
    return (sym: string) => m.get(sym.toUpperCase()) ?? REST_COLOR;
  }, [assets]);

  const assetSegments = useMemo(
    () => toSegments(assets.map((a) => ({ label: a.symbol, valueUsd: a.valueUsd })), t.others),
    [assets, t.others],
  );
  const projectSegments = useMemo(
    () => toSegments(groups.map((g) => ({ label: g.name, valueUsd: g.report.grandTotalUsd })), t.others),
    [groups, t.others],
  );
  const multi = groups.length > 1;

  // Live Hive yields (first treasury that carries them). HP APR is an estimate
  // (inflation→vesting); HBD savings APR is authoritative (chain rate).
  const hiveApr = groups.find((g) => g.report.hiveApr)?.report.hiveApr ?? null;
  const aprFor = (symbol: string): { text: string; est: boolean } | null => {
    if (!hiveApr) return null;
    const s = symbol.toUpperCase();
    if (s === "HIVE" && hiveApr.hp > 0) return { text: `HP ~${hiveApr.hp.toFixed(1)}% APR`, est: true };
    if (s === "HBD" && hiveApr.hbdSavings > 0) return { text: `savings ${hiveApr.hbdSavings.toFixed(0)}% APR`, est: false };
    return null;
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface">
      {/* Hero */}
      <div className={`border-b border-border p-6 ${hideTotal ? "" : "bg-gradient-to-br from-accent-bg to-transparent"}`}>
        {!hideTotal && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{title}</p>
            <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums text-foreground">{usd(grand)}</p>
          </>
        )}
        <div className={`grid grid-cols-2 gap-4 sm:grid-cols-4 ${hideTotal ? "" : "mt-5"}`}>
          <Stat label="EVM" value={usd(evmTotal)} />
          <Stat label="Hive" value={usd(hiveTotal)} />
          <Stat label={t.assets} value={String(assets.length)} />
          <Stat label={multi ? t.wallets : t.networks} value={String(multi ? walletCount : chainCount)} />
        </div>
      </div>

      {/* Composition */}
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        {multi && (
          <div className="space-y-3">
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              <Layers className="h-3.5 w-3.5" /> {t.byProject}
            </h4>
            <AllocationBar segments={projectSegments} total={grand} />
          </div>
        )}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            <Wallet className="h-3.5 w-3.5" /> {t.byAsset}
          </h4>
          <AllocationBar segments={assetSegments} total={grand} />
        </div>
      </div>

      {/* Holdings list */}
      {assets.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {assets.map((a) => {
            const share = grand > 0 ? (a.valueUsd / grand) * 100 : 0;
            const color = assetColor(a.symbol);
            return (
              <li key={a.symbol} className="flex items-center gap-3 px-6 py-3">
                <Monogram symbol={a.symbol} color={color} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{a.symbol}</span>
                    {a.chains.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint"
                      >
                        {c}
                      </span>
                    ))}
                    {(() => {
                      const apr = aprFor(a.symbol);
                      return apr ? (
                        <span
                          className="rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success"
                          title={apr.est ? t.aprEstimate : t.aprSavings}
                        >
                          {apr.text}{apr.est ? "*" : ""}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <p className="mt-0.5 text-[11px] tabular-nums text-foreground-faint">{num(a.balance, 4)} {a.symbol}</p>
                </div>
                <div className="w-28 shrink-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(share, 1.5)}%`, backgroundColor: color }} />
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-foreground">{usd(a.valueUsd)}</p>
                  <p className="text-[11px] tabular-nums text-foreground-faint">{pct(share)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-wallet detail (kept for drill-down, collapsed by default)
// ---------------------------------------------------------------------------

function EvmCard({ w, t }: { w: EvmWalletReport; t: Dictionary["treasury"]["views"] }) {
  const segs =
    w.totalUsd > 0
      ? toSegments(w.tokens.map((tk) => ({ label: `${tk.symbol}·${tk.chain}`, valueUsd: tk.valueUsd })), t.others)
      : [];
  return (
    <div className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{w.label}</p>
          <a
            href={`https://debank.com/profile/${w.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
            title={w.address}
          >
            {shortAddr(w.address)}
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
          </a>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums text-foreground">{usd(w.totalUsd)}</p>
          {w.tokens.length > 0 && (
            <p className="text-[10px] tabular-nums text-foreground-faint">{t.assetCount(w.tokens.length)}</p>
          )}
        </div>
      </div>
      {segs.length > 0 && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-border">
          {segs.map((s) => (
            <div key={s.label} className="h-full" style={{ width: `${Math.max((s.valueUsd / w.totalUsd) * 100, 0.6)}%`, backgroundColor: s.color }} />
          ))}
        </div>
      )}
      {w.error ? (
        <p className="mt-3 text-xs text-danger">{t.loadFailed} {w.error}</p>
      ) : w.tokens.length > 0 ? (
        <div className="mt-4 space-y-2">
          {w.tokens.map((t, i) => (
            <div key={`${t.symbol}-${t.chain}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <TokenLogo symbol={t.symbol} color={colorAt(i)} size={20} />
                <span className="font-medium text-foreground">{t.symbol}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                  {t.chain}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="text-foreground-faint">{num(t.balance, 4)}</span>
                <span className="w-20 text-right font-medium text-foreground">{usd(t.valueUsd)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground-faint">{t.noBalances}</p>
      )}
    </div>
  );
}

function HiveCard({ a, t }: { a: HiveAccountReport; t: Dictionary["treasury"]["views"] }) {
  return (
    <div className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://images.hive.blog/u/${a.account}/avatar`}
            alt={a.account}
            className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{a.label}</p>
            <a
              href={`https://skatehive.app/@${a.account}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
            >
              @{a.account}
              <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          </div>
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums text-foreground">{usd(a.usd)}</p>
      </div>
      {a.error ? (
        <p className="mt-3 text-xs text-danger">{t.loadFailed} {a.error}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["HIVE", a.hive],
              ["HP", a.hp],
              ["HBD", a.hbd],
              ["HBD Savings", a.hbdSavings],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-surface-elevated px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{num(value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WalletDetail({ groups, withHeadings, t }: { groups: TreasuryGroup[]; withHeadings: boolean; t: Dictionary["treasury"]["views"] }) {
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <div key={g.slug} className="space-y-4">
          {withHeadings && (
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{g.name}</h3>
              <span className="text-sm font-semibold tabular-nums text-foreground-muted">{usd(g.report.grandTotalUsd)}</span>
            </div>
          )}
          {g.report.evm.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {g.report.evm.map((w) => (
                <EvmCard key={w.address} w={w} t={t} />
              ))}
            </div>
          )}
          {g.report.hive.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {g.report.hive.map((a) => (
                <HiveCard key={a.account} a={a} t={t} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Treasury dashboard. A Zerion-style overview (hero total + composition +
 * holdings) sits up top for a fast read; per-wallet detail is tucked into a
 * collapsible section below. Multiple groups (admin overview) add a tab bar and
 * a "by project" allocation.
 */
export function TreasuryViews({ groups, hideSelector = false, hideTotal = false }: { groups: TreasuryGroup[]; hideSelector?: boolean; hideTotal?: boolean }) {
  const tr = useT().treasury;
  const t = tr.views;
  const [view, setView] = useState<string>("all");
  const [showDetail, setShowDetail] = useState(false);
  const multi = groups.length > 1;
  // When a parent owns the project filter (SOPA dashboard), it passes already
  // filtered `groups` and hides this local selector — so balances and revenue
  // switch together instead of drifting apart.
  const effectiveView = hideSelector ? "all" : view;
  const visible = effectiveView === "all" ? groups : groups.filter((g) => g.slug === effectiveView);
  const prices = groups[0]?.report.prices;
  const title =
    effectiveView === "all" ? (multi ? t.combined : visible[0]?.name ?? t.fallback) : visible[0]?.name ?? t.fallback;

  return (
    <div className="space-y-6">
      {multi && !hideSelector && (
        <div className="flex flex-wrap gap-1.5">
          {[{ slug: "all", name: tr.all }, ...groups].map((g) => (
            <button
              key={g.slug}
              type="button"
              onClick={() => setView(g.slug)}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                view === g.slug
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <Overview groups={visible} title={title} hideTotal={hideTotal} />

      <div>
        <button
          type="button"
          onClick={() => setShowDetail((s) => !s)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-subtle transition-colors hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showDetail ? "rotate-180" : ""}`} />
          {t.walletDetail}
        </button>
        {showDetail && (
          <div className="mt-4">
            <WalletDetail groups={visible} withHeadings={multi && view === "all"} t={t} />
          </div>
        )}
      </div>

      {prices && (
        <p className="text-[11px] text-foreground-faint">
          {t.pricesNote(usd(prices.hive, 2), usd(prices.hbd, 2))}{" "}
          <span className="text-foreground-faint">{t.aprFootnote}</span>
        </p>
      )}
    </div>
  );
}
