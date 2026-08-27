import { Coins } from "lucide-react";
import type { ReactNode } from "react";
import type { TreasuryGroup } from "@/lib/treasury";
import { Section } from "@/components/section-heading";
import { TreasuryHealthHero } from "@/components/treasury-health-hero";
import { getDictionary } from "@/lib/i18n/server";
import { isOk, unread, type Reading } from "@/lib/reading";

// Brand treasury (Gnars, SkateHive…) in the same design language as the SOPA
// cockpit — but these portals have NO stake/stream payroll setup, so there's no
// Membros tab, no sustainability gauge and no agency jobs. What they do have:
// how much they hold, whether that's healthy, where the money sits, where the
// revenue comes from (on-chain auctions/splits), and what they spend.

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function BrandTreasury({
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
  const { treasury: t } = await getDictionary();
  // No group configured is a different thing from a group that wouldn't read —
  // both stop the number, and both say which.
  const total: Reading<number> = group?.report.total ?? unread("nenhum tesouro configurado");
  const walletCount = (group?.report.evm.length ?? 0) + (group?.report.hive.length ?? 0);
  const runwayMonths = monthlyBurnUsd > 0 && isOk(total) ? total.value / monthlyBurnUsd : null;

  return (
    <div className="space-y-10">
      {/* Hero: how much, is it healthy, how long it lasts */}
      <TreasuryHealthHero
        label={group?.name ?? "—"}
        total={total}
        unreadLabels={group?.report.unreadLabels ?? []}
        sourceCount={walletCount}
        walletCount={walletCount}
        runwayMonths={runwayMonths}
        runwayFooter={t.hero.currentPace}
      />

      {dashboard && (
        <Section title={t.sections.inOut} hint={t.sections.inOutHint}>
          {dashboard}
        </Section>
      )}

      {revenue && (
        <Section title={t.sections.revenue} hint={t.sections.revenueHint}>
          {revenue}
        </Section>
      )}

      <Section title={t.sections.where} hint={t.sections.whereHint}>
        {balances}
      </Section>

      <Section title={t.sections.costs} hint={t.sections.costsHint}>
        <div className="flex items-center gap-1.5 text-xs text-foreground-faint">
          <Coins className="h-3.5 w-3.5" />
          {monthlyBurnUsd > 0 ? t.sections.costsMonthly(usd(monthlyBurnUsd)) : t.sections.costsNone}
        </div>
        {costs}
      </Section>
    </div>
  );
}
