"use client";

import { type ReactNode } from "react";
import { Wallet, ScrollText } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";

// Top-level tabs on the SOPA treasury page: the live treasury (balances,
// revenue, costs) and the financial plan (the endowment/3-bucket study).
export function TreasuryTabs({ treasury, plan }: { treasury: ReactNode; plan: ReactNode }) {
  const [tab, setTab] = useUrlTab("tab", "tesouro");
  const tabs = [
    { id: "tesouro", label: "Tesouro", icon: Wallet },
    { id: "plano", label: "Plano financeiro", icon: ScrollText },
  ];
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
      <div role="tabpanel">{active === "plano" ? plan : treasury}</div>
    </div>
  );
}
