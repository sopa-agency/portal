"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Loader2, X, CheckCircle2 } from "lucide-react";
import { sendBriefingToDiscord, type DiscordServerKey } from "@/app/actions/briefing-discord";

const SERVERS: { key: DiscordServerKey; label: string; hint: string }[] = [
  { key: "skatehive", label: "SkateHive", hint: "EN no #important · PT no #chat" },
  { key: "gnars", label: "Gnars", hint: "uma sala, em português" },
  { key: "reelflip", label: "Reelflip", hint: "uma sala, em português" },
];

export function SendToDiscordButton({ agentSlug, agentLabel }: { agentSlug: string; agentLabel: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DiscordServerKey | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const send = async (server: DiscordServerKey) => {
    setBusy(server);
    setResult(null);
    const r = await sendBriefingToDiscord(agentSlug, server).catch((e) => ({ ok: false as const, error: String(e) }));
    setBusy(null);
    setResult(r.ok ? { ok: true, msg: r.detail ?? "Enviado." } : { ok: false, msg: r.error ?? "Falhou." });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setResult(null); setOpen(true); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <MessageSquare className="h-3.5 w-3.5" /> Send to Discord
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <MessageSquare className="h-4 w-4 text-accent" /> Enviar pro Discord
                </h2>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-foreground-muted hover:bg-surface-elevated hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-xs text-foreground-muted">
                Briefing <span className="font-medium text-foreground">{agentLabel}</span> — escolha o servidor:
              </p>

              <div className="space-y-2">
                {SERVERS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    disabled={!!busy}
                    onClick={() => send(s.key)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-left transition-colors hover:border-accent-border hover:bg-accent-bg disabled:opacity-60"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                      <span className="block text-[11px] text-foreground-faint">{s.hint}</span>
                    </span>
                    {busy === s.key && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                  </button>
                ))}
              </div>

              {result && (
                <p className={`mt-3 flex items-center gap-1.5 text-xs ${result.ok ? "text-success" : "text-danger"}`}>
                  {result.ok && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                  {result.msg}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
