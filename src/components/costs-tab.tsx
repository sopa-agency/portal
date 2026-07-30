"use client";

import { useState } from "react";
import { FixedCostsPanel, type CostGroupMeta } from "@/components/fixed-costs-panel";
import type { FixedCostDTO } from "@/lib/fixed-costs";

// The dedicated "Custos" tab: the fixed-costs panel with a per-project sub-selector
// on top. "Tudo" shows every project (and the combined runway); picking a project
// narrows the panel + runway to that project alone. FixedCostsPanel already renders
// one section per group (each with its own project-scoped add-cost form), so
// filtering the groups + remounting via `key` is all it takes — no changes to it.
export function CostsTab({
  groups,
  initialCosts,
  usdBrl,
  canEdit,
}: {
  groups: CostGroupMeta[];
  initialCosts: FixedCostDTO[];
  usdBrl: number;
  canEdit: boolean;
}) {
  const [sel, setSel] = useState("all");
  const isAll = sel === "all";
  const selGroup = groups.find((g) => g.slug === sel);
  const shownGroups = isAll ? groups : selGroup ? [selGroup] : groups;
  const shownCosts = isAll ? initialCosts : initialCosts.filter((c) => c.projectSlug === sel);
  const tabs = [{ slug: "all", name: "Tudo" }, ...groups.map((g) => ({ slug: g.slug, name: g.name }))];

  return (
    <div className="space-y-5">
      {groups.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setSel(t.slug)}
              aria-pressed={sel === t.slug}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                sel === t.slug
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {t.name}
            </button>
          ))}
          <span className="ml-1 text-[11px] text-foreground-faint">custos e runway do projeto selecionado</span>
        </div>
      )}
      {/* key remounts the panel so its internal cost state re-seeds with the filter */}
      <FixedCostsPanel key={sel} groups={shownGroups} initialCosts={shownCosts} usdBrl={usdBrl} canEdit={canEdit} />
    </div>
  );
}
