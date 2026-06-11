"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { TreasuryGroup, EvmWalletReport, HiveAccountReport } from "@/lib/treasury";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function TotalCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-accent-border bg-accent-bg" : "border-border bg-surface"}`}>
      <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-accent" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function EvmCard({ w }: { w: EvmWalletReport }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
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
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums text-foreground">{usd(w.totalUsd)}</p>
      </div>
      {w.error ? (
        <p className="mt-3 text-xs text-danger">Couldn&apos;t load balances: {w.error}</p>
      ) : w.tokens.length > 0 ? (
        <div className="mt-4 space-y-1.5">
          {w.tokens.map((t, i) => (
            <div key={`${t.symbol}-${t.chain}-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-foreground">{t.symbol}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-foreground-faint">
                  {t.chain}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="text-foreground-subtle">{num(t.balance, 4)}</span>
                <span className="w-20 text-right text-foreground-muted">{usd(t.valueUsd)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground-faint">No balances above dust.</p>
      )}
    </div>
  );
}

function HiveCard({ a }: { a: HiveAccountReport }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{a.label}</p>
          <a
            href={`https://skatehive.app/@${a.account}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-foreground-subtle transition-colors hover:text-accent"
          >
            @{a.account}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums text-foreground">{usd(a.usd)}</p>
      </div>
      {a.error ? (
        <p className="mt-3 text-xs text-danger">Couldn&apos;t load balances: {a.error}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
          {(
            [
              ["HIVE", a.hive],
              ["HP", a.hp],
              ["HBD", a.hbd],
              ["HBD Savings", a.hbdSavings],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</p>
              <p className="tabular-nums text-foreground-muted">{num(value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupSections({ group, heading }: { group: TreasuryGroup; heading?: boolean }) {
  const { report, name } = group;
  return (
    <div className="space-y-6">
      {heading && (
        <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">{name}</h2>
          <span className="text-sm font-semibold tabular-nums text-foreground-muted">
            {usd(report.grandTotalUsd)}
          </span>
        </div>
      )}
      {report.evm.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
            EVM wallets
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {report.evm.map((w) => (
              <EvmCard key={w.address} w={w} />
            ))}
          </div>
        </section>
      )}
      {report.hive.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Hive accounts
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {report.hive.map((a) => (
              <HiveCard key={a.account} a={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Treasury dashboard with per-project views. Single group → plain dashboard;
 * multiple groups (admin overview) → "All" tab with combined total plus one
 * tab per project.
 */
export function TreasuryViews({ groups }: { groups: TreasuryGroup[] }) {
  const [view, setView] = useState<string>("all");
  const multi = groups.length > 1;
  const visible = view === "all" ? groups : groups.filter((g) => g.slug === view);

  const grand = visible.reduce((s, g) => s + g.report.grandTotalUsd, 0);
  const evmTotal = visible.reduce((s, g) => s + g.report.evmTotalUsd, 0);
  const hiveTotal = visible.reduce((s, g) => s + g.report.hiveTotalUsd, 0);
  const prices = groups[0]?.report.prices;

  return (
    <div className="space-y-8">
      {/* View switcher */}
      {multi && (
        <div className="flex flex-wrap gap-1.5">
          {[{ slug: "all", name: "All treasuries" }, ...groups].map((g) => (
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

      {/* Totals for the current view */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TotalCard label={view === "all" && multi ? "Combined total" : "Total treasury"} value={usd(grand)} accent />
        <TotalCard label="EVM wallets" value={usd(evmTotal)} />
        <TotalCard label="Hive accounts" value={usd(hiveTotal)} />
      </div>

      {/* Sections — grouped with headings on "All", plain on a single view */}
      <div className="space-y-10">
        {visible.map((g) => (
          <GroupSections key={g.slug} group={g} heading={multi && view === "all"} />
        ))}
      </div>

      {prices && (
        <p className="text-[11px] text-foreground-faint">
          HIVE {usd(prices.hive)} · HBD {usd(prices.hbd)} via CoinGecko. HP = owned vesting shares
          (incl. delegated out), same math as skatehive.app/dao. Sources cached 5 min.
        </p>
      )}
    </div>
  );
}
