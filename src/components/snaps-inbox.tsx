"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Send, RefreshCw, Heart, Rocket, Check, Play, Sparkles } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { HiveBoostButton } from "@/components/hive-boost-button";
import { listSnapsForCuration, replyToSnap, generateHivePostReply } from "@/app/actions/snap-curation";
import { type CurationSnap } from "@/lib/snap-curation-shared";

export function SnapsInbox() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [snaps, setSnaps] = useState<CurationSnap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();

  function load(force = false) {
    startReload(async () => {
      const res = await listSnapsForCuration(force);
      if (res.ok) { setSnaps(res.snaps); setStatus("ready"); }
      else { setError(res.error); setStatus("error"); }
    });
  }
  useEffect(() => { load(); }, []);

  const patch = (id: string, next: Partial<CurationSnap>) =>
    setSnaps((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));

  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando snaps da SkateHive…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">Não consegui carregar os snaps.</p>
        <p className="mt-1 text-foreground-muted">{error}</p>
        <button type="button" onClick={() => load(true)} disabled={reloading} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-foreground-faint">
          <SocialBrandIcon platform="hive" className="h-3.5 w-3.5" /> snaps recentes da comunidade · responda ou impulsione
        </p>
        <button type="button" onClick={() => load(true)} disabled={reloading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>
      {snaps.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-faint">Nenhum snap recente.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {snaps.map((s) => (
            <SnapCard key={s.id} snap={s} onPatch={(p) => patch(s.id, p)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SnapCard({ snap, onPatch }: { snap: CurationSnap; onPatch: (p: Partial<CurationSnap>) => void }) {
  const [text, setText] = useState("");
  const [justReplied, setJustReplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [genBusy, startGen] = useTransition();

  // Commented state survives refresh/reload: the server reports snap.replied
  // (our account already has a reply on this post); local state only covers the
  // reply we just posted before the next refresh confirms it.
  const replied = justReplied ?? (snap.replied ? snap.replyUrl ?? snap.url : null);

  const reply = () =>
    startBusy(async () => {
      setError(null);
      const res = await replyToSnap(snap.author, snap.permlink, text);
      if (res.ok) { setJustReplied(res.url); setText(""); onPatch({ replied: true, replyUrl: res.url }); }
      else setError(res.error);
    });

  const generate = () =>
    startGen(async () => {
      setError(null);
      const res = await generateHivePostReply({ author: snap.author, title: snap.title, kind: "snap" });
      if (res.ok) setText(res.draft);
      else setError(res.error);
    });

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface">
      {/* Thumbnail — first frame of the snap clip, links to the post */}
      <a href={snap.url} target="_blank" rel="noreferrer" className="group relative block aspect-[4/5] overflow-hidden rounded-t-2xl bg-surface-elevated">
        <video
          src={`${snap.thumbnail}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
          <Play className="h-7 w-7 text-white/85 drop-shadow" />
        </span>
        <span className="absolute left-1.5 top-1.5 max-w-[80%] truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          @{snap.author}
        </span>
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          <Heart className="h-3 w-3 fill-current" /> {snap.votes}
        </span>
        {snap.boost && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
            <Rocket className="h-3 w-3" /> {snap.boost.released}/{snap.boost.budget}
          </span>
        )}
      </a>

      {/* Footer — boost + reply */}
      <div className="flex flex-1 flex-col gap-2 p-2">
        <HiveBoostButton post={snap} onBoosted={(b) => onPatch({ boost: b })} />
        {replied ? (
          <p className="flex items-center gap-1 text-[11px] text-success">
            <Check className="h-3 w-3" /> postado. <a href={replied} target="_blank" rel="noreferrer" className="underline">ver</a>
          </p>
        ) : (
          <div className="mt-auto flex items-center gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) reply(); }}
              placeholder="Comentar…"
              maxLength={500}
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
            />
            <button type="button" onClick={generate} disabled={genBusy} title="Gerar resposta com IA" className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50">
              {genBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={reply} disabled={busy || !text.trim()} title="Responder" className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  );
}
