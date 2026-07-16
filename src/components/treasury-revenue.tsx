import { DollarSign } from "lucide-react";
import type { OrgRevenue, OrgRevenueStream } from "@/lib/org-revenue";
import { Sparkline, RevenueChart } from "@/components/revenue-charts";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;

const KIND_LABEL: Record<OrgRevenueStream["kind"], string> = {
  manual: "Manual",
  wallet: "Wallet",
  contract: "Contrato",
  split: "Split",
};

const EXPLORER: Record<string, string> = {
  base: "https://basescan.org/address/",
  ethereum: "https://etherscan.io/address/",
  optimism: "https://optimistic.etherscan.io/address/",
  arbitrum: "https://arbiscan.io/address/",
};
const explorerUrl = (chain: string | null, address: string) =>
  `${EXPLORER[chain ?? "base"] ?? EXPLORER.base}${address}`;
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function TrendChips({ stream }: { stream: OrgRevenueStream }) {
  const tr = stream.trend;
  if (!tr || tr.points.length < 2) return null;
  const chip = (label: string, v: number | null) =>
    v == null ? null : (
      <span className={v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}>
        {label} {signedUsd(v)}
      </span>
    );
  return (
    <div className="flex items-center gap-2 text-[10px] text-foreground-faint">
      <Sparkline points={tr.points} />
      {chip("7d", tr.delta7d)}
      {chip("30d", tr.delta30d)}
    </div>
  );
}

function StreamRow({ stream }: { stream: OrgRevenueStream }) {
  const { realized, flow } = stream;
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
          {KIND_LABEL[stream.kind]}
        </span>
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{stream.label}</span>
        <a
          href={explorerUrl(stream.chain, stream.address)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 font-mono text-[10px] text-foreground-faint hover:text-accent"
          title={stream.address}
        >
          {shortAddr(stream.address)}
          {stream.chain ? `@${stream.chain}` : ""}
        </a>
      </div>

      {stream.error ? (
        <p className="text-[10px] text-warning">{stream.error}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
          <span className="text-foreground-muted">
            saldo <span className="font-semibold text-foreground">{usd(stream.balanceUsd)}</span>
          </span>
          {stream.tokens.length > 0 && (
            <span className="truncate text-foreground-faint">
              {stream.tokens
                .map((t) => `${t.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${t.symbol}@${t.chain}`)
                .join(" · ")}
            </span>
          )}
        </div>
      )}

      {/* Accurate event-based revenue (auction/split). */}
      {realized && (
        <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
            <span className="text-foreground-muted">
              {realized.method === "auction" ? "🔨 Receita de leilões" : "💧 Distribuído (split)"}{" "}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(realized.revenueUsd)}</span>
            </span>
            <span className="text-foreground-faint">
              {realized.count} {realized.method === "auction" ? "leilões" : "distribuições"}
            </span>
            <span className="text-foreground-muted">
              · dentro agora <span className="font-semibold text-foreground">{usd(stream.balanceUsd)}</span>
            </span>
            {realized.truncated && <span className="text-warning">parcial</span>}
          </div>
          <RevenueChart series={realized.series} />
        </div>
      )}

      {/* Wallet / other → gross in/out flow proxy. */}
      {!realized && flow && !flow.error && (
        <div className="mt-2 rounded-md border border-border bg-surface-elevated p-2">
          <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
            <span className="text-foreground-muted">
              Recebido <span className="font-semibold text-emerald-600 dark:text-emerald-400">{usd(flow.receivedUsd)}</span>
            </span>
            <span className="text-foreground-muted">
              Pago/saiu <span className="font-semibold text-foreground">{usd(flow.paidUsd)}</span>
            </span>
            {flow.truncated && <span className="text-warning" title="histórico longo — mostrando parte">parcial</span>}
          </div>
          <RevenueChart series={flow.series} />
        </div>
      )}

      <div className="mt-1.5">
        <TrendChips stream={stream} />
      </div>
    </div>
  );
}

// Organization revenue section for the treasury page: per-project on-chain
// revenue streams (balances + realized gross + trend), mirroring the org-chart
// Receita tab but read-only. Rendered only when tracked streams exist.
export function TreasuryRevenue({ data }: { data: OrgRevenue }) {
  if (!data.projects.length) return null;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Receita on-chain
          </h2>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Fontes de receita rastreadas por projeto — leituras ao vivo das mesmas carteiras/contratos do org-chart.
          </p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Receita realizada</div>
            <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">{usd(data.realizedTotalUsd)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Saldo atual</div>
            <div className="text-base font-semibold text-foreground">{usd(data.balanceTotalUsd)}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.projects.map((p) => (
          <div key={p.cardId} className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2.5">
              {p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-lg object-contain" />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-[10px] font-bold text-foreground-muted">
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{p.name}</h3>
              <div className="shrink-0 text-right">
                {p.realizedTotalUsd > 0 && (
                  <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{usd(p.realizedTotalUsd)}</div>
                )}
                <div className="text-[10px] text-foreground-faint">saldo {usd(p.balanceTotalUsd)}</div>
              </div>
            </div>
            <div className="space-y-2">
              {p.streams.map((s, i) => (
                <StreamRow key={i} stream={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
