"use client";

import { useState, type ReactNode } from "react";
import { FileText, Megaphone } from "lucide-react";

// Direction B ("Split Desk") home layout, from the Claude Design handoff:
// the brief and the socials live SIDE BY SIDE instead of behind top-level
// tabs — each pane keeps its own segmented switcher in the pane header.

export type SplitTab = {
  slug: string;
  label: string;
  content: ReactNode;
};

function Seg({
  tabs,
  active,
  onChange,
}: {
  tabs: SplitTab[];
  active: string;
  onChange: (slug: string) => void;
}) {
  if (tabs.length <= 1) return null;
  return (
    <div className="flex gap-0.5 rounded-lg bg-surface-elevated p-0.5">
      {tabs.map((t) => (
        <button
          key={t.slug}
          type="button"
          role="tab"
          aria-selected={t.slug === active}
          onClick={() => onChange(t.slug)}
          className={`rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ${
            t.slug === active
              ? "bg-surface text-accent shadow-sm"
              : "text-foreground-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Pane({
  icon,
  title,
  tabs,
}: {
  icon: ReactNode;
  title: string;
  tabs: SplitTab[];
}) {
  const [active, setActive] = useState(tabs[0]?.slug ?? "");
  const current = tabs.find((t) => t.slug === active) ?? tabs[0];

  return (
    <section className="min-w-0">
      <div className="mb-5 flex items-center gap-2.5 border-b border-border pb-3">
        <span className="flex text-accent">{icon}</span>
        <h2 className="shrink-0 text-[15px] font-bold text-foreground">{title}</h2>
        <div className="min-w-0 flex-1" />
        <div className="overflow-x-auto">
          <Seg tabs={tabs} active={current?.slug ?? ""} onChange={setActive} />
        </div>
      </div>
      <div role="tabpanel">{current?.content}</div>
    </section>
  );
}

export function HomeSplit({
  briefTabs,
  channelTabs,
}: {
  briefTabs: SplitTab[];
  channelTabs: SplitTab[];
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-2 lg:gap-0">
      <div className="min-w-0 lg:border-r lg:border-border lg:pr-7">
        <Pane icon={<FileText className="h-[17px] w-[17px]" />} title="Morning brief" tabs={briefTabs} />
      </div>
      <div className="min-w-0 lg:pl-7">
        <Pane icon={<Megaphone className="h-[17px] w-[17px]" />} title="Socials" tabs={channelTabs} />
      </div>
    </div>
  );
}
