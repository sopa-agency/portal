"use client";

import { Network, TrendingUp, BookText } from "lucide-react";
import { useUrlTab } from "@/lib/use-url-tab";
import { SopaOrgChart, type Person } from "@/components/sopa-org-chart";
import { OrgRevenueOrbit } from "@/components/org-revenue-orbit";
import { AddressBook } from "@/components/address-book";
import type { BoardCard } from "@/app/actions/sopa-boards";
import type { SopaRevenueOrbit, SopaSupport } from "@/lib/sopa-revenue-orbit";
import type { AddressBookEntry } from "@/lib/address-book";

// Three views of the org-chart, toggled (and URL-persisted): the org STRUCTURE
// (who's who, tiers, teams — SopaOrgChart), the money view (revenue flowing INTO
// the SOPA treasury + community backers — OrgRevenueOrbit), and the ADDRESS BOOK
// (every tracked on-chain address, with ENS resolution + suggestions).
export function OrgChartViews({
  cards,
  roster,
  orbit,
  support,
  addressBook,
}: {
  cards: BoardCard[];
  roster: Person[];
  orbit: SopaRevenueOrbit;
  support: SopaSupport;
  addressBook: AddressBookEntry[];
}) {
  const [view, setView] = useUrlTab("view", "structure");
  const active = view === "revenue" || view === "addresses" ? view : "structure";

  return (
    <div className="space-y-6">
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-surface p-1">
        {([["structure", "Structure", Network], ["revenue", "Revenue", TrendingUp], ["addresses", "Address Book", BookText]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={active === id}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active === id ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {active === "structure" ? (
        <SopaOrgChart initial={cards} roster={roster} />
      ) : active === "revenue" ? (
        <OrgRevenueOrbit orbit={orbit} support={support} />
      ) : (
        <AddressBook entries={addressBook} />
      )}
    </div>
  );
}
