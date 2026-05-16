"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid, List, MoreVertical, Folder } from "lucide-react";
import { deleteCampaign, renameCampaign } from "@/app/actions/campaigns";

type Campaign = {
  id: string;
  name: string;
  updatedAt: string;
  docCount: number;
};

export function CampaignGrid({ campaigns }: { campaigns: Campaign[] }) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menuId, setMenuId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.2em] text-foreground-subtle">
          {campaigns.length === 0
            ? "No campaigns yet"
            : `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}
        </p>
        <div className="inline-flex rounded-lg border border-border bg-surface/70 p-0.5">
          <ViewToggle
            label="Grid view"
            active={view === "grid"}
            onClick={() => setView("grid")}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
          />
          <ViewToggle
            label="List view"
            active={view === "list"}
            onClick={() => setView("list")}
            icon={<List className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
          <Folder className="mx-auto h-8 w-8 text-foreground-subtle" />
          <p className="mt-3 text-sm text-foreground-muted">
            No campaigns yet — click{" "}
            <span className="font-medium text-foreground">New campaign</span> to start.
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              menuOpen={menuId === c.id}
              onMenuToggle={() => setMenuId(menuId === c.id ? null : c.id)}
            />
          ))}
        </div>
      ) : (
        <CampaignList
          campaigns={campaigns}
          menuId={menuId}
          onMenuToggle={(id) => setMenuId(menuId === id ? null : id)}
        />
      )}
    </div>
  );
}

function ViewToggle({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
        active ? "bg-white/[0.08] text-foreground" : "text-foreground-subtle hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function CampaignCard({
  campaign,
  menuOpen,
  onMenuToggle,
}: {
  campaign: Campaign;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  return (
    <div className="group relative rounded-2xl border border-border bg-surface/70 p-4 transition hover:border-accent-border hover:bg-white/[0.04]">
      <Link href={`/campaign-creator/${campaign.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <Folder className="h-8 w-8 text-accent/70" />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onMenuToggle();
            }}
            aria-label="More actions"
            className="opacity-0 transition group-hover:opacity-100 hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4 text-foreground-muted" />
          </button>
        </div>
        <div className="mt-4 truncate text-sm font-medium text-foreground">{campaign.name}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
          <span>
            {campaign.docCount} {campaign.docCount === 1 ? "file" : "files"}
          </span>
          <span aria-hidden="true">·</span>
          <span>{campaign.updatedAt}</span>
        </div>
      </Link>
      {menuOpen && <ActionsMenu id={campaign.id} name={campaign.name} onClose={onMenuToggle} />}
    </div>
  );
}

function CampaignList({
  campaigns,
  menuId,
  onMenuToggle,
}: {
  campaigns: Campaign[];
  menuId: string | null;
  onMenuToggle: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
      <div className="grid grid-cols-[1fr_auto_auto_2.5rem] items-center gap-4 border-b border-border px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">
        <span>Name</span>
        <span>Files</span>
        <span>Updated</span>
        <span aria-hidden="true" />
      </div>
      {campaigns.map((c) => (
        <div
          key={c.id}
          className="group relative grid grid-cols-[1fr_auto_auto_2.5rem] items-center gap-4 border-b border-white/[0.04] px-4 py-2.5 transition last:border-b-0 hover:bg-surface/70"
        >
          <Link
            href={`/campaign-creator/${c.id}`}
            className="flex min-w-0 items-center gap-3"
          >
            <Folder className="h-4 w-4 shrink-0 text-accent/70" />
            <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
          </Link>
          <span className="tabular-nums text-xs text-foreground-muted">{c.docCount}</span>
          <span className="text-xs text-foreground-muted">{c.updatedAt}</span>
          <button
            type="button"
            onClick={() => onMenuToggle(c.id)}
            aria-label="More actions"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition hover:bg-foreground/10 hover:text-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuId === c.id && (
            <ActionsMenu id={c.id} name={c.name} onClose={() => onMenuToggle(c.id)} />
          )}
        </div>
      ))}
    </div>
  );
}

function ActionsMenu({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-3 top-10 z-20 min-w-44 rounded-xl border border-white/12 bg-background/98 p-1.5 shadow-2xl"
    >
      <button
        type="button"
        onClick={async () => {
          const next = window.prompt("Rename campaign", name);
          if (next && next.trim()) await renameCampaign(id, next.trim());
          onClose();
        }}
        className="flex w-full rounded-lg px-3 py-1.5 text-left text-sm text-foreground transition hover:bg-foreground/10"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!window.confirm(`Delete "${name}"? Its documents are removed too.`)) return;
          await deleteCampaign(id);
          onClose();
        }}
        className="flex w-full rounded-lg px-3 py-1.5 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
      >
        Delete
      </button>
    </div>
  );
}
