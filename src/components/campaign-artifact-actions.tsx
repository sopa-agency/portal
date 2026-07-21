"use client";

import {
  BookUp,
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  CalendarClock,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import {
  getCampaignParagraphPreview,
  getNewsletterBlastInfo,
  publishCampaignDocToParagraph,
  remixCampaignArtifact,
  scheduleCampaignArtifact,
  sendCampaignArtifact,
  sendCampaignEmail,
  sendCampaignEmailBlast,
  toggleArtifactPosted,
} from "@/app/actions/campaigns";
import type { CampaignDocumentKind } from "@/components/campaign-document-preview";
import { CampaignMagPublishDialog } from "@/components/campaign-mag-publish-dialog";
import { ParagraphPublishDialog } from "@/components/paragraph-publish-dialog";
import { DiscordChannelSelect } from "@/components/discord-channel-picker";

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

  // Newsletter blast UI state: load subscriber count → confirm → send.
  const [blastCount, setBlastCount] = useState<number | null>(null);
  const [blastConfirm, setBlastConfirm] = useState(false);
  const [blastResult, setBlastResult] = useState<
    null | { ok: true; sent: number; failed: number; test: boolean } | { ok: false; error: string }
  >(null);
  const [blastPending, startBlastTransition] = useTransition();

  const [togglePending, startToggle] = useTransition();
  const [sendPending, startSend] = useTransition();
  const [remixPending, startRemix] = useTransition();

  const remixInputRef = useRef<HTMLTextAreaElement>(null);

  // hive_mag has its own preview-confirmation dialog, so it's excluded from the
  // generic one-click auto-send button below.
  const supportsAutoSend =
    kind === "hive" || kind === "farcaster" || kind === "discord" || kind === "binance";
  const isMag = kind === "hive_mag";
  const isTweets = kind === "tweets";
  const isEmail = kind === "email";

  const [magDialogOpen, setMagDialogOpen] = useState(false);
  const [paragraphOpen, setParagraphOpen] = useState(false);
  const [paragraphDone, setParagraphDone] = useState<{ url: string; published: boolean; emailed: boolean } | null>(null);
  const [discordChannel, setDiscordChannel] = useState<string | null>(null); // per-send channel override

  // --- schedule (queues a LabScheduledPost the scheduler publishes later) ---
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleStatus, setScheduleStatus] = useState<
    null | { ok: true; when: string } | { ok: false; error: string }
  >(null);
  const [schedulePending, startSchedule] = useTransition();
  const canSchedule = supportsAutoSend || isMag || isEmail;

  const handleSchedule = () => {
    if (!scheduleAt) return;
    setScheduleStatus(null);
    startSchedule(async () => {
      // datetime-local has no timezone — it is local wall time by definition.
      const res = await scheduleCampaignArtifact(documentId, new Date(scheduleAt).toISOString());
      if (res.ok) {
        setScheduleStatus({ ok: true, when: res.scheduledFor });
        setScheduleOpen(false);
        setScheduleAt("");
      } else setScheduleStatus({ ok: false, error: res.error });
    });
  };

  // Publish the mag post (invoked from the confirmation dialog).
  const confirmMagPublish = () => {
    setSendStatus(null);
    startSend(async () => {
      const res = await sendCampaignArtifact(documentId);
      setSendStatus(res);
      if (res.ok) setPostedAt(new Date());
    });
  };

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
    const label =
      kind === "discord"
        ? "Discord"
        : kind === "farcaster"
        ? "Farcaster"
        : kind === "binance"
        ? "Binance Square"
        : "Hive";
    if (!window.confirm(`Publish this ${label} post now?`)) return;
    setSendStatus(null);
    startSend(async () => {
      const res = await sendCampaignArtifact(documentId, kind === "discord" ? discordChannel ?? undefined : undefined);
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

  // --- newsletter blast ---
  const handleBlastPrepare = () => {
    setBlastResult(null);
    startBlastTransition(async () => {
      const info = await getNewsletterBlastInfo();
      if (info.ok) {
        setBlastCount(info.recipients);
        setBlastConfirm(true);
      } else {
        setBlastResult({ ok: false, error: info.error });
      }
    });
  };

  const handleBlastSend = (testTo?: string) => {
    setBlastResult(null);
    startBlastTransition(async () => {
      const res = await sendCampaignEmailBlast(documentId, testTo ? { testTo } : undefined);
      if (res.ok) {
        setBlastResult({ ok: true, sent: res.sent, failed: res.failed.length, test: !!res.test });
        if (!res.test) {
          setPostedAt(new Date());
          setBlastConfirm(false);
        }
      } else {
        setBlastResult(res);
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

        {/* Schedule this artifact on its own — each cast can go out at its own time. */}
        {canSchedule && (
          <button
            type="button"
            onClick={() => { setScheduleOpen((v) => !v); setScheduleStatus(null); }}
            aria-expanded={scheduleOpen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-border-strong hover:text-foreground"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Agendar
          </button>
        )}

        {/* Discord: pick the channel for this send (defaults to the project's). */}
        {kind === "discord" && (
          <DiscordChannelSelect value={discordChannel} onChange={setDiscordChannel} />
        )}

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
                : kind === "binance"
                ? "Publish to Binance Square"
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
              : kind === "binance"
              ? "Post to Binance Square"
              : "Publish"}
          </button>
        )}

        {/* hive_mag — open preview/confirm dialog instead of a one-click send */}
        {isMag && (
          <button
            type="button"
            onClick={() => setMagDialogOpen(true)}
            disabled={sendPending}
            aria-label="Preview and publish Hive blog post"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Publish…
          </button>
        )}
        {isMag && (
          <CampaignMagPublishDialog
            open={magDialogOpen}
            documentId={documentId}
            publishing={sendPending}
            result={sendStatus}
            onClose={() => setMagDialogOpen(false)}
            onConfirm={confirmMagPublish}
          />
        )}

        {/* hive_mag — also send to the project's Paragraph newsletter (web + opt-in email) */}
        {isMag && (
          paragraphDone ? (
            <a
              href={paragraphDone.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {paragraphDone.published ? (paragraphDone.emailed ? "Paragraph + email" : "Paragraph") : "Paragraph (draft)"}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setParagraphOpen(true)}
              aria-label="Send to Paragraph newsletter"
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20"
            >
              <BookUp className="h-3.5 w-3.5" />
              Paragraph…
            </button>
          )
        )}
        {isMag && paragraphOpen && (
          <ParagraphPublishDialog
            languages={[{ code: "en", label: "EN" }, { code: "pt", label: "PT" }]}
            loadPreview={(lang) => getCampaignParagraphPreview(documentId, lang)}
            onSend={(opts) => publishCampaignDocToParagraph(documentId, opts)}
            onClose={() => setParagraphOpen(false)}
            onDone={(r) => setParagraphDone(r)}
          />
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

          {/* Newsletter blast — userbase recipients with unsubscribe footer */}
          <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-foreground-subtle">Newsletter blast (userbase)</p>
            <div className="flex flex-wrap items-center gap-2">
              {!blastConfirm ? (
                <button
                  type="button"
                  onClick={handleBlastPrepare}
                  disabled={blastPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
                >
                  {blastPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Blast to userbase…
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleBlastSend()}
                    disabled={blastPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition hover:bg-danger/20 disabled:opacity-50"
                  >
                    {blastPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {blastPending ? "Sending…" : `Confirm: send to ${blastCount} subscriber${blastCount === 1 ? "" : "s"}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlastConfirm(false)}
                    disabled={blastPending}
                    className="rounded-lg border border-border px-3 py-2 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => handleBlastSend(emailRecipient)}
                disabled={blastPending || !emailRecipient.trim()}
                title="Sends the blast version (with unsubscribe footer) only to the address above"
                className="rounded-lg border border-border px-3 py-2 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
              >
                Test blast → address above
              </button>
            </div>
            {blastResult && (
              <p className={`text-[11px] ${blastResult.ok ? "text-success" : "text-danger"}`}>
                {blastResult.ok
                  ? blastResult.test
                    ? "Test sent — check the inbox (and the unsubscribe link)."
                    : `Blast sent to ${blastResult.sent} recipient${blastResult.sent === 1 ? "" : "s"}${blastResult.failed > 0 ? ` — ${blastResult.failed} failed` : ""}.`
                  : blastResult.error}
              </p>
            )}
            <p className="text-[10px] text-foreground-faint">
              Sends to every userbase email that hasn&apos;t unsubscribed, personalised with
              username + unsubscribe link. Takes ~1s per 2 recipients.
            </p>
          </div>
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
      {scheduleOpen && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-elevated p-3">
          <label className="text-[11px] text-foreground-subtle" htmlFor={`sched-${documentId}`}>
            Publicar automaticamente em:
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`sched-${documentId}`}
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-border-strong"
            />
            <button
              type="button"
              onClick={handleSchedule}
              disabled={schedulePending || !scheduleAt}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {schedulePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              {schedulePending ? "Agendando…" : "Confirmar"}
            </button>
          </div>
          <p className="text-[11px] text-foreground-faint">
            Entra na fila do agendador e publica sozinho no horário. Cada artefato tem o seu — dá pra escalonar os casts.
          </p>
          {scheduleStatus && !scheduleStatus.ok && (
            <p className="text-[11px] text-danger">{scheduleStatus.error}</p>
          )}
        </div>
      )}

      {scheduleStatus?.ok && !scheduleOpen && (
        <p className="text-[11px] text-success">
          Agendado para{" "}
          {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
            new Date(scheduleStatus.when),
          )}
          .
        </p>
      )}

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
