"use client";

import {
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  remixCampaignArtifact,
  sendCampaignArtifact,
  toggleArtifactPosted,
} from "@/app/actions/campaigns";
import type { CampaignDocumentKind } from "@/components/campaign-document-preview";

type Props = {
  documentId: string;
  kind: CampaignDocumentKind;
  content: string;
  initialPostedAt: Date | null;
  onContentChange?: (newContent: string) => void;
};

export function CampaignArtifactActions({
  documentId,
  kind,
  content,
  initialPostedAt,
  onContentChange,
}: Props) {
  const [postedAt, setPostedAt] = useState<Date | null>(initialPostedAt);
  const [sendStatus, setSendStatus] = useState<
    null | { ok: true; url?: string } | { ok: false; error: string; manual?: boolean }
  >(null);
  const [remixOpen, setRemixOpen] = useState(false);
  const [remixInstruction, setRemixInstruction] = useState("");
  const [remixError, setRemixError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [togglePending, startToggle] = useTransition();
  const [sendPending, startSend] = useTransition();
  const [remixPending, startRemix] = useTransition();

  const remixInputRef = useRef<HTMLTextAreaElement>(null);

  const supportsAutoSend = kind === "hive" || kind === "farcaster";
  const isEmail = kind === "email";

  // --- toggle posted ---
  const handleTogglePosted = () => {
    startToggle(async () => {
      const res = await toggleArtifactPosted(documentId);
      if (res.ok) setPostedAt(res.postedAt);
    });
  };

  // --- send ---
  const handleSend = () => {
    if (!supportsAutoSend) return;
    if (!window.confirm(`Publish this ${kind} now?`)) return;
    setSendStatus(null);
    startSend(async () => {
      const res = await sendCampaignArtifact(documentId);
      setSendStatus(res);
      if (res.ok) setPostedAt(new Date());
    });
  };

  // --- copy to clipboard ---
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — silently ignore
    }
  };

  // --- remix ---
  const handleRemix = () => {
    setRemixError(null);
    startRemix(async () => {
      const res = await remixCampaignArtifact(documentId, remixInstruction.trim() || undefined);
      if (res.ok) {
        onContentChange?.(res.content);
        setRemixOpen(false);
        setRemixInstruction("");
      } else {
        setRemixError(res.error);
      }
    });
  };

  const postedLabel = postedAt
    ? `Posted ${new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(postedAt))}`
    : "Mark as posted";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Send / Copy button */}
        {!isEmail ? (
          supportsAutoSend ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={sendPending}
              aria-label={`Publish ${kind}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {sendPending ? "Publishing…" : "Publish"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy content to clipboard to post manually"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy to post"}
            </button>
          )
        ) : null}

        {/* Posted checkmark */}
        <button
          type="button"
          onClick={handleTogglePosted}
          disabled={togglePending}
          aria-label={postedAt ? "Unmark as posted" : "Mark as posted"}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            postedAt
              ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
              : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          {togglePending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : postedAt ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Circle className="h-3.5 w-3.5" />
          )}
          <span className="tabular-nums">{postedLabel}</span>
        </button>

        {/* Remix button */}
        <button
          type="button"
          onClick={() => {
            setRemixOpen((v) => !v);
            setRemixError(null);
          }}
          aria-label="Remix this artifact"
          aria-expanded={remixOpen}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            remixOpen
              ? "border-border-strong bg-surface-elevated text-foreground"
              : "border-border bg-surface-elevated text-foreground-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Remix
        </button>
      </div>

      {/* Send status line */}
      {sendStatus && (
        <div className="flex items-center gap-1.5 text-[11px]">
          {sendStatus.ok ? (
            <>
              <span className="text-success">Published</span>
              {sendStatus.url ? (
                <a
                  href={sendStatus.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-success/80 underline underline-offset-2 hover:text-success"
                >
                  View
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </>
          ) : sendStatus.manual ? (
            <span className="text-foreground-subtle">No API — post manually. Copy above, then mark as posted.</span>
          ) : (
            <span className="text-danger">{sendStatus.error}</span>
          )}
        </div>
      )}

      {/* Copy hint for non-auto platforms */}
      {!isEmail && !supportsAutoSend && !sendStatus && (
        <p className="text-[10px] text-foreground-faint">No API — post manually, then mark as posted.</p>
      )}

      {/* Remix panel */}
      {remixOpen && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-3">
          <label className="text-[11px] text-foreground-subtle">
            How should I change it? <span className="text-foreground-faint">(optional — leave blank to regenerate as-is)</span>
          </label>
          <textarea
            ref={remixInputRef}
            value={remixInstruction}
            onChange={(e) => setRemixInstruction(e.target.value)}
            placeholder="e.g. make it shorter, more casual, add a call-to-action…"
            rows={2}
            className="resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
          />
          {remixError ? <p className="text-[11px] text-danger">{remixError}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRemix}
              disabled={remixPending}
              aria-label="Regenerate this artifact"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {remixPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {remixPending ? "Regenerating…" : "Regenerate"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRemixOpen(false);
                setRemixInstruction("");
                setRemixError(null);
              }}
              className="text-xs text-foreground-subtle hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
