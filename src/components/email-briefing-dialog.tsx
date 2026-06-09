"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Mail, Send, X } from "lucide-react";
import { getBriefingEmailMeta, sendBriefingEmail } from "@/app/actions/briefings";
import { MarkdownContent } from "@/components/markdown-content";

type Meta = {
  recipients: string[];
  configured: boolean;
  hasBriefing: boolean;
};

type SendState = "idle" | "sending" | "success" | "error";

export function EmailBriefingButton({
  agentSlug,
  agentLabel,
  briefingDate,
  markdownBody,
  projectName,
}: {
  agentSlug: string;
  agentLabel: string;
  briefingDate: string;
  markdownBody: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaPending, startMetaTransition] = useTransition();
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sentTo, setSentTo] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);

  const openDialog = () => {
    setOpen(true);
    setSendState("idle");
    setSendError(null);
    setSentTo(0);
    setMeta(null);
    startMetaTransition(async () => {
      const m = await getBriefingEmailMeta(agentSlug);
      setMeta(m);
    });
  };

  const closeDialog = () => {
    setOpen(false);
    setSendState("idle");
    setSendError(null);
  };

  const handleSend = async () => {
    if (!meta || sendState === "sending") return;
    setSendState("sending");
    setSendError(null);
    const result = await sendBriefingEmail(agentSlug);
    if (result.ok) {
      setSentTo(result.sentTo);
      setSendState("success");
      // Auto-close after 2.5 s on success.
      setTimeout(() => setOpen(false), 2500);
    } else {
      setSendError(result.error);
      setSendState("error");
    }
  };

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const n = meta?.recipients.length ?? 0;
  const canSend =
    meta !== null &&
    meta.configured &&
    meta.hasBriefing &&
    meta.recipients.length > 0 &&
    sendState === "idle";

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        aria-label={`Email morning brief for ${agentLabel} to team`}
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        Email to team
      </button>

      {/* Dialog */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Email morning brief — ${agentLabel}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-foreground-muted" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">
                  Email morning brief
                </span>
              </div>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={closeDialog}
                className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-surface-elevated hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Subject line */}
              <div className="border-b border-border px-6 py-3">
                <p className="text-xs text-foreground-subtle">Subject</p>
                <p className="mt-0.5 font-medium text-foreground tabular-nums">
                  {projectName} — Morning Brief · {briefingDate}
                </p>
              </div>

              {/* Email preview */}
              <div className="px-6 py-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-foreground-subtle">
                  Preview
                </p>
                <div
                  aria-label="Email preview"
                  className="rounded-xl border border-border bg-surface-elevated p-5"
                >
                  <MarkdownContent markdown={markdownBody} />
                </div>
              </div>
            </div>

            {/* Footer — recipients + actions */}
            <div className="border-t border-border px-6 py-4">
              {/* Recipient list */}
              {metaPending || meta === null ? (
                <div className="mb-4 flex items-center gap-2 text-sm text-foreground-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Loading recipient list…
                </div>
              ) : (
                <div className="mb-4">
                  {!meta.configured && (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
                    >
                      Email isn&apos;t configured for {projectName} yet. Set{" "}
                      {/* Show the prefix without exposing values */}
                      SMTP credentials to enable sending.
                    </div>
                  )}
                  {!meta.hasBriefing && (
                    <div
                      role="alert"
                      className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
                    >
                      No briefing generated yet — regenerate one first.
                    </div>
                  )}
                  {meta.recipients.length === 0 ? (
                    <p className="text-xs text-foreground-muted">
                      No team emails configured for this project.
                    </p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-foreground-muted">
                        Sending to{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {meta.recipients.length}
                        </span>{" "}
                        {meta.recipients.length === 1 ? "coworker" : "coworkers"} (BCC)
                      </p>
                      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Recipients">
                        {meta.recipients.map((email) => (
                          <span
                            key={email}
                            role="listitem"
                            className="inline-flex items-center rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] text-foreground-muted tabular-nums"
                          >
                            {email}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Send result feedback */}
              {sendState === "success" && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success"
                >
                  Sent to {sentTo} {sentTo === 1 ? "coworker" : "coworkers"} ✓
                </div>
              )}
              {sendState === "error" && sendError && (
                <div
                  role="alert"
                  className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
                >
                  {sendError}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  aria-label={
                    canSend
                      ? `Send morning brief to ${n} ${n === 1 ? "coworker" : "coworkers"}`
                      : "Send (unavailable)"
                  }
                  disabled={!canSend}
                  onClick={handleSend}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sendState === "sending" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      Send to {n > 0 ? `${n} ` : ""}
                      {n === 1 ? "coworker" : "coworkers"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
