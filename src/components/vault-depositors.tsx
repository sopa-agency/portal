import { Users2, Flame } from "lucide-react";
import type { VaultDepositor } from "@/lib/vault-depositors";

// Who is backing the vault. Server component — numbers come from the contract,
// so there's nothing to hydrate; avatars are Hive PFPs (that endpoint always
// returns an image), with an initials chip for unknown wallets.

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : 0 });
const perMo = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 2 })}/mês`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Avatar({ handle, address, ring }: { handle: string | null; address: string; ring: string }) {
  if (handle) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://images.hive.blog/u/${handle.replace(/^@/, "")}/avatar`}
        alt=""
        className="h-[42px] w-[42px] shrink-0 rounded-full object-cover"
        style={{ border: `2px solid ${ring}` }}
      />
    );
  }
  return (
    <span
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-accent-bg font-mono text-xs font-bold uppercase text-accent"
      style={{ border: `2px solid ${ring}` }}
    >
      {address.slice(2, 4)}
    </span>
  );
}

export function VaultDepositors({
  depositors,
  apy,
  feeToSopa,
}: {
  depositors: VaultDepositor[];
  /** Net APY a depositor keeps, as a fraction. */
  apy: number | null;
  /** Share of the yield taken by SOPA, 0–1. */
  feeToSopa: number;
}) {
  if (depositors.length === 0) return null;

  const backers = depositors.filter((d) => !d.isDeadDeposit);
  const total = backers.reduce((s, d) => s + d.assets, 0);
  const monthly = apy != null ? (total * apy) / 12 : null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-foreground">
            <Users2 className="h-[19px] w-[19px] text-accent" /> Quem está apoiando
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
            Cada um pode sacar o que é seu quando quiser — o que é compartilhado é só o rendimento.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-faint">Depositado</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">{usd(total)}</div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {backers.map((d) => {
          const keptMonthly = apy != null ? (d.assets * apy) / 12 : null;
          const ring = d.share >= 0.5 ? "var(--success)" : "var(--accent-border)";
          return (
            <div
              key={d.address}
              className="grid grid-cols-[42px_1fr_auto] items-center gap-4 rounded-2xl border border-border bg-surface-elevated px-4 py-3.5 lg:grid-cols-[42px_1fr_190px_200px_90px]"
            >
              <Avatar handle={d.label} address={d.address} ring={ring} />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground">{d.label ?? short(d.address)}</div>
                <div className="truncate font-mono text-xs text-foreground-faint">{short(d.address)}</div>
              </div>
              {/* recebe de volta — desktop only */}
              <div className="hidden text-xs text-foreground-muted lg:block">
                recebe de volta{" "}
                <span className="font-mono font-semibold text-success">{keptMonthly != null ? perMo(keptMonthly) : "—"}</span>
              </div>
              {/* share bar — desktop only */}
              <div className="hidden items-center gap-2.5 lg:flex">
                <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-border">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(d.share * 100, 2)}%` }} />
                </div>
                <span className="min-w-[30px] text-xs font-semibold text-foreground-muted">{Math.round(d.share * 100)}%</span>
              </div>
              <div className="text-right font-mono text-base font-semibold tabular-nums text-foreground">{usd(d.assets)}</div>
            </div>
          );
        })}
      </div>

      {monthly != null && monthly > 0 && (
        <p className="mt-4 text-xs text-foreground-muted">
          Nesse ritmo o cofre rende <b className="tabular-nums text-foreground">{perMo(monthly)}</b> —{" "}
          <b className="tabular-nums text-accent">{perMo(monthly * feeToSopa)}</b> pro tesouro da SOPA, o resto pra quem depositou.
        </p>
      )}

      {depositors.some((d) => d.isDeadDeposit) && (
        <p className="mt-3 flex items-center gap-2 text-xs text-foreground-faint">
          <Flame className="h-3.5 w-3.5" />
          O depósito inicial queimado (proteção do cofre) não aparece na lista — ele não é de ninguém.
        </p>
      )}
    </section>
  );
}
