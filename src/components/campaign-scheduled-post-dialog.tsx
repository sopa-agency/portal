"use client";

// Preview + reschedule dialog for a campaign asset, opened from the campaign
// calendar (instead of jumping to the Files view). Reuses ScheduledPostDialogShell
// — same chrome as the main calendar's dialog. Reschedule/clear go through the
// calendar's existing onSchedule; "abrir no editor" runs the old open behavior.

import { useState } from "react";
import { CalendarClock, FileText, Pencil, Trash2 } from "lucide-react";
import { ScheduledPostDialogShell } from "@/components/scheduled-post-dialog";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import type { CampaignDocumentKind } from "@/lib/campaign-kind";

// Kinds that map to a social brand mark; the rest fall back to a doc icon.
const KIND_PLATFORM: Partial<Record<CampaignDocumentKind, string>> = {
  hive: "hive",
  hive_mag: "hive",
  farcaster: "farcaster",
  tweets: "x",
  discord: "discord",
  instagram: "instagram",
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Instagram/email store a JSON builder payload — surface the human-readable
// bits (caption/subject/body) instead of raw JSON in the preview.
function previewText(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      const parts = [j.caption, j.captionPt, j.subject, j.preheader, j.body]
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      if (parts.length) return parts.join("\n\n");
    } catch {
      /* fall through to raw */
    }
  }
  return content;
}

export type CampaignCalendarAsset = {
  id: string;
  name: string;
  kind: CampaignDocumentKind;
  content: string;
  scheduledFor: Date | null;
};

export function CampaignScheduledPostDialog({
  asset,
  onReschedule,
  onClear,
  onOpenEditor,
  onClose,
  busy,
}: {
  asset: CampaignCalendarAsset;
  onReschedule: (iso: string) => void;
  onClear: () => void;
  onOpenEditor: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [when, setWhen] = useState(() =>
    toLocalInput(asset.scheduledFor ? new Date(asset.scheduledFor) : new Date()),
  );
  const platform = KIND_PLATFORM[asset.kind];

  return (
    <ScheduledPostDialogShell
      onClose={onClose}
      icon={
        platform ? (
          <SocialBrandIcon platform={platform} className="h-4 w-4 shrink-0" />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-foreground-muted" />
        )
      }
      label={asset.name}
      preview={previewText(asset.content)}
    >
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        Publicar em
      </label>
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onReschedule(new Date(when).toISOString())}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          <CalendarClock className="h-3.5 w-3.5" /> Reagendar
        </button>
        {asset.scheduledFor && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remover data
          </button>
        )}
        <button
          type="button"
          onClick={onOpenEditor}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-foreground-subtle hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> abrir no editor
        </button>
      </div>
    </ScheduledPostDialogShell>
  );
}
