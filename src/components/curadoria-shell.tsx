"use client";

import { useUrlTab } from "@/lib/use-url-tab";
import { FarcasterTrailShell } from "@/components/farcaster-trail-shell";
import { InstagramInbox } from "@/components/instagram-inbox";
import { SnapsInbox } from "@/components/snaps-inbox";
import { BlogInbox } from "@/components/blog-inbox";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import type { TrailItem } from "@/app/actions/farcaster-trail";

type Tab = "trail" | "snaps" | "blog" | "instagram";

const TAB_INFO: Record<Tab, string> = {
  trail:
    "Trail de curadoria entre nossas contas: like (Farcaster) / upvote (Hive) automático nos posts parceiros + resposta gerada para você aprovar e postar (HITL).",
  snaps:
    "Snaps recentes da comunidade SkateHive. Comente como a conta do portal ou dê um boost — upvotes da userbase liberados aos poucos, no ritmo do engajamento real.",
  blog:
    "Blog posts (magazine) recentes da comunidade Hive do projeto. Comente como a conta do portal ou impulsione os melhores com hiveboost.",
  instagram:
    "Comentários nos nossos posts do Instagram. Responda direto daqui; o comentário sai da fila quando você responde e só volta se a pessoa responder de novo.",
};

export function CuradoriaShell({ trail, trailProject }: { trail: TrailItem[]; trailProject: string }) {
  // Shareable: the active tab lives in ?tab= so a copied URL opens the same one.
  const [rawTab, setTab] = useUrlTab("tab", "trail");
  const tab = (["trail", "snaps", "blog", "instagram"].includes(rawTab) ? rawTab : "trail") as Tab;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        <TabButton active={tab === "trail"} onClick={() => setTab("trail")} platform="farcaster" label="Trail" />
        <TabButton active={tab === "snaps"} onClick={() => setTab("snaps")} platform="hive" label="Snaps" />
        <TabButton active={tab === "blog"} onClick={() => setTab("blog")} platform="hive" label="Blog" />
        <TabButton active={tab === "instagram"} onClick={() => setTab("instagram")} platform="instagram" label="Instagram" />
      </div>
      <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-muted">
        {TAB_INFO[tab]}
      </p>
      {tab === "trail" && <FarcasterTrailShell initial={trail} projectName={trailProject} />}
      {tab === "snaps" && <SnapsInbox />}
      {tab === "blog" && <BlogInbox />}
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
