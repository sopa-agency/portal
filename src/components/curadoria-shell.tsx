"use client";

import { useUrlTab } from "@/lib/use-url-tab";
import { useT } from "@/components/locale-provider";
import { Info } from "lucide-react";
import { FarcasterTrailShell } from "@/components/farcaster-trail-shell";
import { InstagramInbox } from "@/components/instagram-inbox";
import { SnapsInbox } from "@/components/snaps-inbox";
import { BlogInbox } from "@/components/blog-inbox";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import type { TrailItem } from "@/app/actions/farcaster-trail";

type Tab = "trail" | "snaps" | "blog" | "instagram";

const TABS: { id: Tab; platform: string }[] = [
  { id: "trail", platform: "farcaster" },
  { id: "snaps", platform: "hive" },
  { id: "blog", platform: "hive" },
  { id: "instagram", platform: "instagram" },
];

export function CuradoriaShell({ trail, trailProject }: { trail: TrailItem[]; trailProject: string }) {
  const t = useT().engagement;
  // Shareable: the active tab lives in ?tab= so a copied URL opens the same one.
  const [rawTab, setTab] = useUrlTab("tab", "trail");
  const tab = (TABS.some((x) => x.id === rawTab) ? rawTab : "trail") as Tab;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((x) => (
          <TabButton
            key={x.id}
            active={tab === x.id}
            onClick={() => setTab(x.id)}
            platform={x.platform}
            label={t.tabs[x.id]}
          />
        ))}
      </div>
      {/* The explainer used to be a bordered card, which made the page open with
          three stacked blocks of prose before any content. A quiet line with an
          icon says the same thing without competing with the inbox below. */}
      <p className="flex items-start gap-1.5 px-0.5 text-xs leading-relaxed text-foreground-subtle">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-hidden="true" />
        {t.info[tab]}
      </p>
      {/* Keyed by tab so switching plays the enter animation. */}
      <div key={tab} className="tab-panel">
        {tab === "trail" && <FarcasterTrailShell initial={trail} projectName={trailProject} />}
        {tab === "snaps" && <SnapsInbox />}
        {tab === "blog" && <BlogInbox />}
        {tab === "instagram" && <InstagramInbox />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, platform, label }: { active: boolean; onClick: () => void; platform: string; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active ? "border-accent text-foreground" : "border-transparent text-foreground-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      <SocialBrandIcon platform={platform} className="h-4 w-4" /> {label}
    </button>
  );
}
