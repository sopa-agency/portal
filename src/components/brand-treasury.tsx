import { Wallet, Activity, Coins, PiggyBank } from "lucide-react";
import type { ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";

// Brand treasury (Gnars, SkateHive…) in the same design language as the SOPA
// cockpit — but these portals have NO stake/stream payroll setup, so there's no
// Membros tab, no sustainability gauge and no agency jobs. What they do have:
// how much they hold, whether that's healthy, where the money sits, where the
// revenue comes from (on-chain auctions/splits), and what they spend.

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function health(runwayMonths: number | null): { label: string; phrase: string; cls: string } {
  if (runwayMonths == null) return { label: "Sem custos", phrase: "Nada saindo por aqui — o tesouro só acumula.", cls: "bg-success/15 text-success" };
  if (runwayMonths >= 12) return { label: "Saudável", phrase: "O caixa cobre bem mais de um ano no ritmo atual.", cls: "bg-success/15 text-success" };
  if (runwayMonths >= 3) return { label: "Atenção", phrase: "Menos de um ano de caixa — vale acompanhar de perto.", cls: "bg-warning/15 text-warning" };
  return { label: "Crítico", phrase: "Menos de 3 meses de caixa no ritmo atual.", cls: "bg-danger/15 text-danger" };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function BrandTreasury({
  group,
  monthlyBurnUsd,
  balances,
  revenue,
  dashboard,
  costs,
}: {
  group: TreasuryGroup | undefined;
  monthlyBurnUsd: number;
  /** Wallet/asset breakdown (TreasuryViews). */
  balances: ReactNode;
  /** On-chain revenue streams (TreasuryRevenue), or null when none tracked. */
  revenue: ReactNode;
  /** Incoming-vs-outgoing chart (FinancialDashboard). */
  dashboard: ReactNode;
  /** Fixed costs panel. */
  costs: ReactNode;
}) {
  const total = group?.report.grandTotalUsd ?? 0;
  const walletCount = (group?.report.evm.length ?? 0) + (group?.report.hive.length ?? 0);
  const runwayMonths = monthlyBurnUsd > 0 ? total / monthlyBurnUsd : null;
  const h = health(runwayMonths);

  return (
    <div className="space-y-10">
      {/* Hero: how much, is it healthy, how long it lasts */}
      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="rounded-2xl border border-border bg-gradient-to-br from-accent-bg to-transparent p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            <Wallet className="h-3.5 w-3.5" /> Tesouro · {group?.name ?? "—"}
          </div>
          <div className="mt-1.5 text-3xl font-bold tabular-nums tracking-tight text-foreground">{usd(total)}</div>
          <p className="mt-1 text-xs text-foreground-faint">
            {walletCount > 0 ? `em ${walletCount} carteira${walletCount === 1 ? "" : "s"}` : "sem carteiras configuradas"}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint">
            <Activity className="h-3.5 w-3.5" /> Saúde
          </div>
          <div className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${h.cls}`}>{h.label}</div>
          <p className="mt-1.5 text-xs text-foreground-muted">{h.phrase}</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-foreground-faint"
            title="Quanto tempo o caixa dura se o gasto continuar no ritmo atual."
          >
            <PiggyBank className="h-3.5 w-3.5" /> Runway
          </div>
          <div className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">
            {runwayMonths == null ? "∞" : `${runwayMonths >= 10 ? Math.round(runwayMonths) : runwayMonths.toFixed(1)}`}
            {runwayMonths != null && <span className="ml-1 text-sm font-medium text-foreground-faint">meses</span>}
          </div>
          <p className="mt-1 text-xs text-foreground-faint">no ritmo de gasto atual</p>
        </div>
      </section>

      {dashboard && <Section title="Entrada vs saída" hint="O que entrou e o que saiu, mês a mês.">{dashboard}</Section>}

      {revenue && (
        <Section title="De onde vem a receita" hint="As fontes on-chain deste projeto — leilões e splits, lidos direto da blockchain.">
          {revenue}
        </Section>
      )}

      <Section title="Onde o dinheiro está" hint="Cada carteira e ativo que compõe o tesouro.">
        {balances}
      </Section>

      <Section title="Custos fixos" hint="O que sai todo mês — é isso que define o runway acima.">
        <div className="flex items-center gap-1.5 text-xs text-foreground-faint">
          <Coins className="h-3.5 w-3.5" />
          {monthlyBurnUsd > 0 ? `${usd(monthlyBurnUsd)}/mês em custos ativos` : "nenhum custo cadastrado"}
        </div>
        {costs}
      </Section>
    </div>
  );
}
