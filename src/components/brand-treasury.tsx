import { Coins } from "lucide-react";
import type { ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";
import { Section } from "@/components/section-heading";
import { TreasuryHealthHero } from "@/components/treasury-health-hero";

// Brand treasury (Gnars, SkateHive…) in the same design language as the SOPA
// cockpit — but these portals have NO stake/stream payroll setup, so there's no
// Membros tab, no sustainability gauge and no agency jobs. What they do have:
// how much they hold, whether that's healthy, where the money sits, where the
// revenue comes from (on-chain auctions/splits), and what they spend.

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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

  return (
    <div className="space-y-10">
      {/* Hero: how much, is it healthy, how long it lasts */}
      <TreasuryHealthHero
        label={group?.name ?? "—"}
        totalUsd={total}
        walletCount={walletCount}
        runwayMonths={runwayMonths}
        runwayFooter="no ritmo de gasto atual"
      />

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
