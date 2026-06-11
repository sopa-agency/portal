"use client";

import { Loader2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useTransition } from "react";
import {
  getParagraphSyncStatus,
  syncUserbaseToParagraph,
  type ParagraphSyncStatus,
} from "@/app/actions/userbase";

/** Paragraph publication status + one-click userbase→Paragraph subscriber sync. */
export function ParagraphSyncCard({ initial }: { initial: ParagraphSyncStatus }) {
  const [status, setStatus] = useState(initial);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status.ok && !status.configured) return null; // no key for this project — hide

  const handleSync = () => {
    setSyncResult(null);
    startTransition(async () => {
      const res = await syncUserbaseToParagraph();
      if (res.ok) {
        setSyncResult(`Synced — ${res.added} new subscriber${res.added === 1 ? "" : "s"} pushed to Paragraph.`);
        setStatus(await getParagraphSyncStatus());
      } else {
        setSyncResult(`Error: ${res.error}`);
      }
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Paragraph newsletter
          </p>
          {status.ok && status.configured ? (
            <p className="mt-1 text-sm text-foreground-muted">
              <span className="font-medium text-foreground">{status.publication}</span> ·{" "}
              {status.paragraphCount} subscribers on Paragraph · {status.userbaseEmails} eligible
              userbase emails ·{" "}
              {status.missing === 0 ? (
                <span className="text-success">fully synced</span>
              ) : (
                <span className="text-warning">{status.missing} not yet synced</span>
              )}
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {status.ok ? "Not configured" : status.error}
            </p>
          )}
        </div>
        {status.ok && status.configured && (
          <button
            type="button"
            onClick={handleSync}
            disabled={pending || status.missing === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {pending ? "Syncing…" : "Sync to Paragraph"}
          </button>
        )}
      </div>
      {syncResult && (
        <p
          className={`mt-3 flex items-center gap-1.5 text-[12px] ${
            syncResult.startsWith("Error") ? "text-danger" : "text-success"
          }`}
        >
          {syncResult.startsWith("Error") ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          {syncResult}
        </p>
      )}
    </div>
  );
}
