export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { fetchTreasury } from "@/lib/treasury";
import { getActiveProject } from "@/projects";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const num = (n: number, d = 2) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function TotalCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-accent-border bg-accent-bg" : "border-border bg-surface"}`}>
      <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-accent" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

export default async function TreasuryPage() {
  const project = await getActiveProject();
  if (!project.treasury) notFound();

  const report = await fetchTreasury(project);
  if (!report) notFound();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Treasury"
        title={`${project.name} treasury`}
        description="The same wallets and data sources the native app shows — live balances across chains."
        status={usd(report.grandTotalUsd)}
      />

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TotalCard label="Total treasury" value={usd(report.grandTotalUsd)} accent />
        <TotalCard label="EVM wallets" value={usd(report.evmTotalUsd)} />
        {report.hive.length > 0 && <TotalCard label="Hive accounts" value={usd(report.hiveTotalUsd)} />}
      </div>

      {/* EVM wallets */}
      <section className="space-y-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
          EVM wallets
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {report.evm.map((w) => (
            <div key={w.address} className="rounded-2xl border border-border bg-surface p-5">
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
          ))}
        </div>
      </section>

      {/* Hive accounts */}
      {report.hive.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Hive accounts
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {report.hive.map((a) => (
              <div key={a.account} className="rounded-2xl border border-border bg-surface p-5">
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
                    {[
                      ["HIVE", a.hive],
                      ["HP", a.hp],
                      ["HBD", a.hbd],
                      ["HBD Savings", a.hbdSavings],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <p className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</p>
                        <p className="tabular-nums text-foreground-muted">{num(value as number)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-foreground-faint">
            HIVE {usd(report.prices.hive)} · HBD {usd(report.prices.hbd)} via CoinGecko. HP = owned vesting shares
            (incl. delegated out), same math as skatehive.app/dao.
          </p>
        </section>
      )}
    </div>
  );
}
