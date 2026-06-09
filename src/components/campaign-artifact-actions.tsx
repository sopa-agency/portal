"use client";

import {
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  remixCampaignArtifact,
  sendCampaignArtifact,
  sendCampaignEmail,
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
    | null
    | { ok: true; url?: string; detail?: string }
    | { ok: false; error: string; manual?: boolean }
  >(null);
  const [remixOpen, setRemixOpen] = useState(false);
  const [remixInstruction, setRemixInstruction] = useState("");
  const [remixError, setRemixError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Email send UI state.
  const [emailInputOpen, setEmailInputOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState("");
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const [togglePending, startToggle] = useTransition();
  const [sendPending, startSend] = useTransition();
  const [remixPending, startRemix] = useTransition();

  const remixInputRef = useRef<HTMLTextAreaElement>(null);

  const supportsAutoSend = kind === "hive" || kind === "farcaster" || kind === "discord";
  const isTweets = kind === "tweets";
  const isEmail = kind === "email";

  // --- toggle posted ---
  const handleTogglePosted = () => {
    startToggle(async () => {
      const res = await toggleArtifactPosted(documentId);
      if (res.ok) setPostedAt(res.postedAt);
    });
  };

  // --- send (hive / farcaster / discord) ---
  const handleSend = () => {
    if (!supportsAutoSend) return;
    const label = kind === "discord" ? "Discord" : kind === "farcaster" ? "Farcaster" : "Hive";
    if (!window.confirm(`Send this ${label} post now?`)) return;
    setSendStatus(null);
    startSend(async () => {
      const res = await sendCampaignArtifact(documentId);
      setSendStatus(res);
      if (res.ok) setPostedAt(new Date());
    });
  };

  // --- X / Twitter intent (client-side, no server round-trip) ---
  const handleXIntent = () => {
    // Tweets are stored joined by \n---\n; open the first segment (thread opener).
    const firstTweet = content.split(/\n---\n/)[0]?.trim() ?? content.trim();
    const intentUrl =
      "https://twitter.com/intent/tweet?text=" + encodeURIComponent(firstTweet);
    window.open(intentUrl, "_blank", "noopener");
    // Inform the user so they can mark as posted.
    setSendStatus({ ok: false, error: "__x_intent_opened__" });
  };

  // --- email send ---
  const handleEmailSend = () => {
    setSendStatus(null);
    startSend(async () => {
      const res = await sendCampaignEmail(documentId, emailRecipient);
      if (res.ok) {
        setEmailSentTo(emailRecipient);
        setPostedAt(new Date());
        setEmailInputOpen(false);
        setSendStatus({ ok: true });
      } else {
        setSendStatus(res);
      }
    });
  };

  // --- copy to clipboard ---
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently ignore
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

        {/* hive / farcaster / discord — auto-publish via server action */}
        {supportsAutoSend && (
          <button
            type="button"
            onClick={handleSend}
            disabled={sendPending}
            aria-label={
              kind === "discord"
                ? "Send to Discord via agent"
                : kind === "farcaster"
                ? "Publish Farcaster cast"
                : "Publish Hive snap"
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sendPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : kind === "discord" ? (
              <MessageSquare className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sendPending
              ? kind === "discord"
                ? "Posting…"
                : "Publishing…"
              : kind === "discord"
              ? "Send to Discord"
              : "Publish"}
          </button>
        )}

        {/* tweets — open X composer intent in new tab */}
        {isTweets && (
          <button
            type="button"
            onClick={handleXIntent}
            aria-label="Open X/Twitter composer with the first tweet"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Post on X
          </button>
        )}

        {/* email — reveal recipient input */}
        {isEmail && !emailSentTo && (
          <button
            type="button"
            onClick={() => setEmailInputOpen((v) => !v)}
            aria-label="Send email to a recipient"
            aria-expanded={emailInputOpen}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              emailInputOpen
                ? "border-border-strong bg-surface-elevated text-foreground"
                : "border-accent-border bg-accent-bg text-accent hover:bg-accent/20"
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            Send email
          </button>
        )}
        {isEmail && emailSentTo && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Sent to {emailSentTo}
          </span>
        )}

        {/* copy — available for tweets (alongside X intent) */}
        {isTweets && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy tweet thread to clipboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied ? "Copied!" : "Copy thread"}
          </button>
        )}

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

      {/* Email recipient input panel */}
      {isEmail && emailInputOpen && !emailSentTo && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-3">
          <label htmlFor="email-recipient" className="text-[11px] text-foreground-subtle">
            Send to (single recipient)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="email-recipient"
              type="email"
              value={emailRecipient}
              onChange={(e) => setEmailRecipient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEmailSend();
              }}
              placeholder="hello@example.com"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={handleEmailSend}
              disabled={sendPending || !emailRecipient.trim()}
              aria-label="Send email now"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {sendPending ? "Sending…" : "Send"}
            </button>
          </div>
          <p className="text-[10px] text-foreground-faint">
            Sends to one recipient via SMTP. Requires SMTP_HOST / EMAIL_USER / EMAIL_PASS in your env.
          </p>
        </div>
      )}

      {/* Send status line */}
      {sendStatus && (
        <div className="flex items-center gap-1.5 text-[11px]">
          {sendStatus.ok ? (
            <>
              <span className="text-success">
                {kind === "discord" ? "Posted to Discord" : kind === "email" ? "Email sent" : "Published"}
              </span>
              {"url" in sendStatus && sendStatus.url ? (
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
              {"detail" in sendStatus && sendStatus.detail ? (
                <span className="text-foreground-subtle">&mdash; {sendStatus.detail}</span>
              ) : null}
            </>
          ) : sendStatus.error === "__x_intent_opened__" ? (
            <span className="text-foreground-subtle">
              X composer opened — post the thread, then mark as posted. Post remaining tweets as replies.
            </span>
          ) : sendStatus.manual ? (
            <span className="text-foreground-subtle">No API — post manually, then mark as posted.</span>
          ) : (
            <span className="text-danger">{sendStatus.error}</span>
          )}
        </div>
      )}

      {/* Hint for tweets when no action taken yet */}
      {isTweets && !sendStatus && (
        <p className="text-[10px] text-foreground-faint">
          Opens the first tweet in the X composer. Post the rest as replies.
        </p>
      )}

      {/* Remix panel */}
      {remixOpen && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-3">
          <label className="text-[11px] text-foreground-subtle">
            How should I change it?{" "}
            <span className="text-foreground-faint">(optional — leave blank to regenerate as-is)</span>
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
