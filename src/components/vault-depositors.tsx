import { Users2, Flame } from "lucide-react";
import type { VaultDepositor } from "@/lib/vault-depositors";

// Who is backing the vault. Server component — the numbers come from the
// contract, so there is nothing to hydrate.

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n > 0 && n < 100 ? 2 : 0 });

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function VaultDepositors({
  depositors,
  apy,
  feeToSopa,
}: {
  depositors: VaultDepositor[];
  /** Net APY of the vault, as a fraction. */
  apy: number | null;
  /** Share of the yield taken by SOPA, 0–1. */
  feeToSopa: number;
}) {
  if (depositors.length === 0) return null;

  const backers = depositors.filter((d) => !d.isDeadDeposit);
  const total = backers.reduce((s, d) => s + d.assets, 0);
  // What the pot throws off per month, and the half of it that funds payroll.
  const monthly = apy != null ? (total * apy) / 12 : null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Users2 className="h-4 w-4 text-accent" /> Quem está apoiando
          </h3>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            Cada um pode sacar o que é seu quando quiser — o que é compartilhado é só o rendimento.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-foreground-faint">Depositado</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{usd(total)}</div>
        </div>
      </div>

      {monthly != null && monthly > 0 && (
        <p className="mt-3 rounded-xl bg-surface-elevated px-3.5 py-2.5 text-xs text-foreground-muted">
          Nesse ritmo isso rende <b className="tabular-nums text-foreground">{usd(monthly)}/mês</b> —{" "}
          <b className="tabular-nums text-accent">{usd(monthly * feeToSopa)}/mês</b> vai pro tesouro da SOPA e o resto fica
          com quem depositou.
        </p>
      )}

      <ul className="mt-3 divide-y divide-border">
        {backers.map((d) => (
          <li key={d.address} className="flex items-center gap-3 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg font-mono text-[10px] font-bold uppercase text-accent">
              {(d.label ?? d.address.slice(2, 4)).slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{d.label ?? short(d.address)}</span>
              {d.label && <span className="block truncate font-mono text-[10px] text-foreground-faint">{short(d.address)}</span>}
            </span>
            <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border sm:w-24">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(d.share * 100, 2)}%` }} />
            </span>
            <span className="w-20 shrink-0 text-right">
              <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">{usd(d.assets)}</span>
              <span className="block text-[10px] tabular-nums text-foreground-faint">{(d.share * 100).toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>

      {depositors.some((d) => d.isDeadDeposit) && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground-faint">
          <Flame className="h-3 w-3" />
          O depósito inicial queimado (proteção do cofre) não aparece na lista — ele não é de ninguém.
        </p>
      )}
    </section>
  );
}
