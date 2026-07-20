"use client";

import { type ReactNode } from "react";
import { Wallet, ScrollText, Users2, PiggyBank, type LucideIcon } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";

// Top-level tabs on the SOPA treasury page: the live treasury (balances,
// revenue, costs), the payroll stream members, community staking, and the plan.
export function TreasuryTabs({ treasury, members, apoiar, plan }: { treasury: ReactNode; members?: ReactNode; apoiar?: ReactNode; plan: ReactNode }) {
  const tabs: { id: string; label: string; icon: LucideIcon; node: ReactNode }[] = [
    { id: "tesouro", label: "Tesouro", icon: Wallet, node: treasury },
    ...(members ? [{ id: "membros", label: "Membros", icon: Users2, node: members }] : []),
    ...(apoiar ? [{ id: "apoiar", label: "Apoiar", icon: PiggyBank, node: apoiar }] : []),
    { id: "plano", label: "Plano financeiro", icon: ScrollText, node: plan },
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
