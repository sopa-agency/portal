"use client";

import { useRef, useState, useTransition } from "react";
import { renameCampaign } from "@/app/actions/campaigns";

export function CampaignTitleEditor({
  campaignId,
  initialName,
}: {
  campaignId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [, startTransition] = useTransition();
  const savedRef = useRef(initialName);

  const commit = () => {
    const next = name.trim() || "Untitled campaign";
    if (next === savedRef.current) {
      if (next !== name) setName(next);
      return;
    }
    setStatus("saving");
    startTransition(async () => {
      await renameCampaign(campaignId, next);
      savedRef.current = next;
      setName(next);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1200);
    });
  };

  return (
    <div className="flex items-center gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setName(savedRef.current);
            (e.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Campaign name"
        className="-mx-1.5 min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-0.5 text-2xl font-semibold tracking-tight text-foreground outline-none transition hover:bg-surface/70 focus:bg-white/[0.04] focus:ring-1 focus:ring-lime-400/40"
      />
      <span className="text-[11px] text-foreground-subtle" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
      </span>
    </div>
  );
}
