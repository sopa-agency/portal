"use client";

import { useState } from "react";
import { FarcasterTrailShell } from "@/components/farcaster-trail-shell";
import { InstagramInbox } from "@/components/instagram-inbox";
import { SnapsInbox } from "@/components/snaps-inbox";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import type { TrailItem } from "@/app/actions/farcaster-trail";

type Tab = "trail" | "snaps" | "instagram";

export function CuradoriaShell({ trail, trailProject }: { trail: TrailItem[]; trailProject: string }) {
  const [tab, setTab] = useState<Tab>("trail");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === "trail"} onClick={() => setTab("trail")} platform="farcaster" label="Trail FC / Hive" />
        <TabButton active={tab === "snaps"} onClick={() => setTab("snaps")} platform="hive" label="Snaps" />
        <TabButton active={tab === "instagram"} onClick={() => setTab("instagram")} platform="instagram" label="Comentários IG" />
      </div>
      {tab === "trail" && <FarcasterTrailShell initial={trail} projectName={trailProject} />}
      {tab === "snaps" && <SnapsInbox />}
      {tab === "instagram" && <InstagramInbox />}
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
        active ? "border-accent text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"
      }`}
    >
      <SocialBrandIcon platform={platform} className="h-4 w-4" /> {label}
    </button>
  );
}
