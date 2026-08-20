"use client";

import { ExternalLink, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { publishHiveSnap } from "@/app/actions/campaigns";

export function CampaignHivePublishButton({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const handlePublish = () => {
    if (!window.confirm("Publish this snap to the Hive feed now?")) return;
    setError(null);
    setPublishedUrl(null);
    startTransition(async () => {
      const result = await publishHiveSnap(documentId);
      if (!result.ok) {
        setError(result.error ?? "Failed to publish snap.");
        return;
      }
      if (result.url) setPublishedUrl(result.url);
    });
  };

  if (publishedUrl) {
    return (
      <a
        href={publishedUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition hover:bg-success/20"
      >
        Published
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handlePublish}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-3.5 w-3.5" />
        {pending ? "Publishing…" : "Publish to Hive"}
      </button>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
