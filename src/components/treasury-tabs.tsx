"use client";

import { type ReactNode } from "react";
import { Wallet, ScrollText, Users2, PiggyBank, Receipt, TrendingUp, type LucideIcon } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";

// Top-level tabs on the SOPA treasury page: the live treasury (balances +
// revenue), fixed costs, the payroll stream members, community staking, the plan.
export function TreasuryTabs({ treasury, revenue, costs, members, apoiar, plan }: { treasury: ReactNode; revenue?: ReactNode; costs?: ReactNode; members?: ReactNode; apoiar?: ReactNode; plan: ReactNode }) {
  // Ids stay Portuguese: they are the ?tab= value, so translating them would
  // break every link anyone has already shared.
  const t = useT().treasury.tabs;
  const tabs: { id: string; label: string; icon: LucideIcon; node: ReactNode }[] = [
    { id: "tesouro", label: t.treasury, icon: Wallet, node: treasury },
    // Money in, then money out — the two halves of the same question, each on
    // its own tab so neither has to be scrolled past to reach the other.
    ...(revenue ? [{ id: "receita", label: t.revenue, icon: TrendingUp, node: revenue }] : []),
    ...(costs ? [{ id: "custos", label: t.costs, icon: Receipt, node: costs }] : []),
    ...(members ? [{ id: "membros", label: t.members, icon: Users2, node: members }] : []),
    ...(apoiar ? [{ id: "apoiar", label: t.support, icon: PiggyBank, node: apoiar }] : []),
    { id: "plano", label: t.plan, icon: ScrollText, node: plan },
  ];
  const [tab, setTab] = useUrlTab("tab", "tesouro");
  const active = tabs.some((t) => t.id === tab) ? tab : "tesouro";

  return (
    <div>
      <div className="mb-7 flex gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-semibold transition-colors ${
                on ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{tabs.find((t) => t.id === active)?.node}</div>
    </div>
  );
}
