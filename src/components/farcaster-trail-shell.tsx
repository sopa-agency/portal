"use client";

import { useState } from "react";
import { Loader2, Sparkles, Send, X, Check, ExternalLink, Heart, ChevronDown } from "lucide-react";
import {
  generateTrailReply,
  postTrailReply,
  skipTrailReply,
  type TrailItem,
} from "@/app/actions/farcaster-trail";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function TrailCard({ item, onResolved }: { item: TrailItem; onResolved: (id: string) => void }) {
  const [text, setText] = useState(item.draft ?? "");
  const [busy, setBusy] = useState<null | "gen" | "post" | "skip">(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(item.status === "done" ? "posted" : null);
  const [steerOpen, setSteerOpen] = useState(false);
  const [steer, setSteer] = useState("");

  const QUICK_STEERS = ["mais curto", "mais engraçado", "menciona o autor", "faz uma pergunta", "mais hype"];

  const gen = async (instruction?: string) => {
    setBusy("gen"); setErr(null);
    const r = await generateTrailReply(item.actionId, instruction, instruction ? text : undefined);
    setBusy(null);
    if (r.ok) { setText(r.draft); setSteerOpen(false); }
    else setErr(r.error);
  };
  const post = async () => {
    if (!text.trim()) return;
    setBusy("post"); setErr(null);
    const r = await postTrailReply(item.actionId, text);
    setBusy(null);
    if (r.ok) { setDone(r.url); setTimeout(() => onResolved(item.actionId), 1200); }
    else setErr(r.error);
  };
  const skip = async () => {
    setBusy("skip");
    await skipTrailReply(item.actionId);
    onResolved(item.actionId);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-semibold text-accent">
            @{item.cast.authorSlug}
          </span>
          {item.liked && (
            <span className="inline-flex items-center gap-1 text-[11px] text-danger">
              <Heart className="h-3 w-3 fill-current" /> curtido
            </span>
          )}
          <span className="text-[11px] text-foreground-faint">{timeAgo(item.cast.postedAt)} atrás</span>
        </div>
        <a
          href={item.cast.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-foreground-subtle transition-colors hover:text-foreground"
        >
          ver no Warpcast <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="mb-3 whitespace-pre-wrap rounded-lg bg-surface-elevated px-3 py-2 text-sm text-foreground">
        {item.cast.text || <span className="text-foreground-faint">(sem texto — só mídia)</span>}
      </p>

      {done ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> Reply postado.{" "}
          {done !== "posted" && (
            <a href={done} target="_blank" rel="noreferrer" className="underline">
              ver
            </a>
          )}
        </p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escreva ou gere um reply on-brand…"
            rows={3}
            maxLength={320}
            disabled={busy === "post"}
            className="w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-foreground-faint">{text.length}/320</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={skip}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Pular
              </button>
              {/* Split button: default generate + caret to steer the prompt */}
              <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => gen()}
                  disabled={!!busy}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
                >
                  {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Gerar com IA
                </button>
                <button
                  type="button"
                  onClick={() => setSteerOpen((v) => !v)}
                  disabled={!!busy}
                  aria-label="Ajustar prompt"
                  aria-expanded={steerOpen}
                  className="border-l border-border px-1.5 text-foreground-muted transition-colors hover:bg-foreground/5 disabled:opacity-50"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${steerOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              <button
                type="button"
                onClick={post}
                disabled={!!busy || !text.trim()}
                className="inline-flex items-center gap-1 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {busy === "post" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Postar reply
              </button>
            </div>
          </div>

          {/* Prompt-steer panel (toggled by the caret) */}
          {steerOpen && (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface-elevated p-2.5">
              <div className="flex flex-wrap gap-1">
                {QUICK_STEERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => gen(q)}
                    disabled={!!busy}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={steer}
                  onChange={(e) => setSteer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && steer.trim() && gen(steer)}
                  placeholder="Instrução pra IA (ex: cita o /skateboard, mais irônico…)"
                  disabled={!!busy}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
                <button
                  type="button"
                  onClick={() => steer.trim() && gen(steer)}
                  disabled={!!busy || !steer.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-bg px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                >
                  {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Ajustar
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {err && <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{err}</p>}
    </div>
  );
}

export function FarcasterTrailShell({ initial, projectName }: { initial: TrailItem[]; projectName: string }) {
  const [items, setItems] = useState(initial);
  const pending = items.filter((i) => i.status !== "done");
  const resolve = (id: string) => setItems((prev) => prev.filter((i) => i.actionId !== id));

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        Quando um portal parceiro posta, o trail curte automaticamente e lista o post aqui pra{" "}
        <strong className="text-foreground">{projectName}</strong> responder. Gere um rascunho on-brand, edite e poste.
      </p>
      {pending.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-foreground-faint">
          Nada pendente. Quando um parceiro postar, aparece aqui.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pending.map((it) => (
            <TrailCard key={it.actionId} item={it} onResolved={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
