"use client";

import { useState } from "react";
import { Loader2, Sparkles, Send, X, Check, ExternalLink, Heart, ChevronDown, Users, Lock } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import {
  generateTrailReply,
  generateTrailReplyAll,
  postTrailReply,
  skipTrailReply,
  type TrailItem,
  type TrailSibling,
} from "@/app/actions/farcaster-trail";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * One OTHER account's reply to the same post. Kept editable and postable right
 * here so approving every account is one pass down a single card, instead of a
 * login round-trip per brand.
 */
function SiblingRow({ sib }: { sib: TrailSibling }) {
  const [text, setText] = useState(sib.draft ?? "");
  const [busy, setBusy] = useState<null | "gen" | "post">(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const posted = sib.status === "done" || !!url;

  const gen = async () => {
    setBusy("gen"); setErr(null);
    const r = await generateTrailReply(sib.actionId);
    setBusy(null);
    if (r.ok) setText(r.draft); else setErr(r.error);
  };
  const post = async () => {
    if (!text.trim()) return;
    setBusy("post"); setErr(null);
    const r = await postTrailReply(sib.actionId, text);
    setBusy(null);
    if (r.ok) setUrl(r.url); else setErr(r.error);
  };

  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-semibold text-accent">
          {sib.actorName}
        </span>
        {posted && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
            <Check className="h-3 w-3" /> postado
          </span>
        )}
        {!sib.canAct && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-foreground-faint"
            title={
              sib.reason === "no_portal"
                ? "Esta conta da trilha não tem portal próprio, então não há credencial pra postar por ela daqui"
                : "Você não está na allowlist do portal desta conta"
            }
          >
            <Lock className="h-3 w-3" /> {sib.reason === "no_portal" ? "sem portal" : "sem permissão"}
          </span>
        )}
      </div>
      {posted ? (
        <p className="text-xs text-foreground-muted">{text || sib.draft || "—"}</p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            disabled={!sib.canAct}
            placeholder={sib.canAct ? "sem rascunho ainda" : "somente leitura"}
            className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none disabled:opacity-60"
          />
          {sib.canAct && (
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={gen}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-border-strong disabled:opacity-50"
              >
                {busy === "gen" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Gerar
              </button>
              <button
                type="button"
                onClick={post}
                disabled={!!busy || !text.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-bg px-2 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {busy === "post" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Postar
              </button>
            </div>
          )}
        </>
      )}
      {err && <p className="mt-1 text-[10px] text-danger">{err}</p>}
    </div>
  );
}

function TrailCard({ item, onResolved }: { item: TrailItem; onResolved: (id: string) => void }) {
  const [text, setText] = useState(item.draft ?? "");
  const [busy, setBusy] = useState<null | "gen" | "post" | "skip">(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(item.status === "done" ? "posted" : null);
  const [steerOpen, setSteerOpen] = useState(false);
  const [steer, setSteer] = useState("");
  const [others, setOthers] = useState(item.others);
  const [allBusy, setAllBusy] = useState(false);
  const [allNote, setAllNote] = useState<string | null>(null);

  // Draft for every pending account on this post at once — including THIS
  // portal's, so one press covers the whole card.
  const genAll = async () => {
    setAllBusy(true); setAllNote(null); setErr(null);
    const r = await generateTrailReplyAll(item.cast.hash, steer.trim() || undefined);
    setAllBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    const mine = r.results.find((x) => !others.some((o) => o.actorSlug === x.actorSlug) && x.ok && x.draft);
    if (mine?.draft) setText(mine.draft);
    setOthers((prev) =>
      prev.map((o) => {
        const hit = r.results.find((x) => x.actorSlug === o.actorSlug);
        return hit?.ok && hit.draft ? { ...o, draft: hit.draft } : o;
      }),
    );
    const failed = r.results.filter((x) => !x.ok);
    setAllNote(
      failed.length
        ? `${r.results.length - failed.length}/${r.results.length} geradas · ${failed.map((f) => `${f.actorName}: ${f.error}`).join(" · ")}`
        : `${r.results.length} contas geradas`,
    );
  };

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

  const isHive = item.cast.platform === "hive";
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Platform logo */}
          <SocialBrandIcon platform={isHive ? "hive" : "farcaster"} className="h-4 w-4 shrink-0" />
          <span className="inline-flex items-center rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-semibold text-accent">
            @{item.cast.authorHandle ?? item.cast.authorSlug}
          </span>
          {item.liked && (
            <span className="inline-flex items-center gap-1 text-[11px] text-danger">
              <Heart className="h-3 w-3 fill-current" /> {isHive ? "upvotado" : "curtido"}
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
          {isHive ? "ver no PeakD" : "ver no Warpcast"} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="mb-3 whitespace-pre-wrap rounded-lg bg-surface-elevated px-3 py-2 text-sm text-foreground">
        {item.cast.text || <span className="text-foreground-faint">(sem texto — só mídia)</span>}
      </p>

      {done ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" /> {isHive ? "Comentário postado" : "Reply postado"}.{" "}
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
                onClick={genAll}
                disabled={!!busy || allBusy}
                title="Gera o rascunho de TODAS as contas pendentes neste post, cada uma na sua voz"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
              >
                {allBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                Gerar p/ todas
              </button>
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

      {allNote && <p className="mt-2 text-[11px] text-foreground-subtle">{allNote}</p>}

      {others.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-faint">
            <Users className="h-3.5 w-3.5" /> outras contas ({others.length})
          </p>
          <div className="space-y-2">
            {others.map((o) => (
              <SiblingRow key={o.actionId} sib={o} />
            ))}
          </div>
        </div>
      )}
      {err && <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{err}</p>}
    </div>
  );
}

const NETWORKS = [
  { id: "all", label: "Todos", platform: null as string | null },
  { id: "farcaster", label: "Farcaster", platform: "farcaster" },
  { id: "hive", label: "Hive", platform: "hive" },
];

export function FarcasterTrailShell({ initial, projectName }: { initial: TrailItem[]; projectName: string }) {
  const [items, setItems] = useState(initial);
  const [net, setNet] = useState("all");
  const resolve = (id: string) => setItems((prev) => prev.filter((i) => i.actionId !== id));

  const pending = items.filter((i) => i.status !== "done");
  const countFor = (platform: string | null) =>
    pending.filter((i) => (platform ? i.cast.platform === platform : true)).length;
  const shown = pending.filter((i) => {
    const p = NETWORKS.find((n) => n.id === net)?.platform;
    return p ? i.cast.platform === p : true;
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        Quando um portal parceiro posta, o trail curte/upvota automaticamente e lista o post aqui pra{" "}
        <strong className="text-foreground">{projectName}</strong> responder. Gere um rascunho on-brand, edite e poste.
      </p>

      {/* Split by network */}
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {NETWORKS.map((n) => {
          const on = n.id === net;
          const c = countFor(n.platform);
          return (
            <button
              key={n.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setNet(n.id)}
              className={`-mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                on ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
              }`}
            >
              {n.platform && <SocialBrandIcon platform={n.platform} className="h-3.5 w-3.5" />}
              {n.label}
              <span className="rounded-full bg-surface-elevated px-1.5 text-[10px] tabular-nums text-foreground-subtle">{c}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-10 text-center text-sm text-foreground-faint">
          Nada pendente nesta rede. Quando um parceiro postar, aparece aqui.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((it) => (
            <TrailCard key={it.actionId} item={it} onResolved={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
