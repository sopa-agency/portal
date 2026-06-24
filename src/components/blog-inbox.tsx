"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Send, RefreshCw, Heart, Rocket, Check, ExternalLink, FileText, BookUp, Sparkles } from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { HiveBoostButton } from "@/components/hive-boost-button";
import { ParagraphPublishDialog } from "@/components/paragraph-publish-dialog";
import { listBlogPostsForCuration, replyToSnap, generateHivePostReply, previewBlogPostForParagraph, sendBlogPostToParagraph } from "@/app/actions/snap-curation";
import { type CurationSnap } from "@/lib/snap-curation-shared";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function BlogInbox() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [posts, setPosts] = useState<CurationSnap[]>([]);
  const [canParagraph, setCanParagraph] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();

  function load() {
    startReload(async () => {
      const res = await listBlogPostsForCuration();
      if (res.ok) { setPosts(res.posts); setCanParagraph(res.canParagraph); setStatus("ready"); }
      else { setError(res.error); setStatus("error"); }
    });
  }
  useEffect(() => { load(); }, []);

  const patch = (id: string, next: Partial<CurationSnap>) =>
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));

  if (status === "loading") {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando posts da comunidade…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 text-sm">
        <p className="font-medium text-foreground">Não consegui carregar os posts.</p>
        <p className="mt-1 text-foreground-muted">{error}</p>
        <button type="button" onClick={load} disabled={reloading} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-foreground-faint">
          <SocialBrandIcon platform="hive" className="h-3.5 w-3.5" /> blog posts recentes da comunidade · comente ou impulsione
        </p>
        <button type="button" onClick={load} disabled={reloading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-muted hover:border-border-strong disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </div>
      {posts.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-faint">Nenhum post recente.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {posts.map((p) => (
            <BlogCard key={p.id} post={p} canParagraph={canParagraph} onPatch={(x) => patch(p.id, x)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlogCard({ post, canParagraph, onPatch }: { post: CurationSnap; canParagraph: boolean; onPatch: (p: Partial<CurationSnap>) => void }) {
  const [text, setText] = useState("");
  const [replied, setReplied] = useState<string | null>(null);
  const [paraDialog, setParaDialog] = useState(false);
  const [paraDone, setParaDone] = useState<{ url: string; published: boolean; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [genBusy, startGen] = useTransition();

  const reply = () =>
    startBusy(async () => {
      setError(null);
      const res = await replyToSnap(post.author, post.permlink, text);
      if (res.ok) { setReplied(res.url); setText(""); }
      else setError(res.error);
    });

  const generate = () =>
    startGen(async () => {
      setError(null);
      const res = await generateHivePostReply({ author: post.author, title: post.title, kind: "blog" });
      if (res.ok) setText(res.draft);
      else setError(res.error);
    });

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface">
      <a href={post.url} target="_blank" rel="noreferrer" className="group relative block aspect-[16/9] overflow-hidden rounded-t-2xl bg-surface-elevated">
        {post.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-foreground-faint"><FileText className="h-7 w-7" /></span>
        )}
        <span className="absolute left-1.5 top-1.5 max-w-[80%] truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">@{post.author}</span>
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          <Heart className="h-3 w-3 fill-current" /> {post.votes} · {usd(post.payout)}
        </span>
        {post.boost && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
            <Rocket className="h-3 w-3" /> {post.boost.released}/{post.boost.budget}
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <a href={post.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold text-foreground hover:text-accent">
          {post.title} <ExternalLink className="inline h-3 w-3 align-baseline text-foreground-subtle" />
        </a>
        <div className="flex items-center gap-1.5">
          <HiveBoostButton post={post} onBoosted={(b) => onPatch({ boost: b })} />
          {canParagraph && (
            paraDone ? (
              <a href={paraDone.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-success/40 bg-success/10 px-2.5 py-1.5 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" /> {paraDone.published ? (paraDone.emailed ? "publicado + email" : "publicado") : "rascunho"} no Paragraph
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setParaDialog(true)}
                title="Enviar pro Paragraph"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <BookUp className="h-3.5 w-3.5" /> Paragraph
              </button>
            )
          )}
        </div>
        {replied ? (
          <p className="flex items-center gap-1 text-[11px] text-success">
            <Check className="h-3 w-3" /> comentário postado. <a href={replied} target="_blank" rel="noreferrer" className="underline">ver</a>
          </p>
        ) : (
          <div className="mt-auto flex items-center gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) reply(); }}
              placeholder="Comentar no post…"
              maxLength={500}
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-faint focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50"
            />
            <button type="button" onClick={generate} disabled={genBusy} title="Gerar resposta com IA" className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50">
              {genBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={reply} disabled={busy || !text.trim()} title="Comentar" className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>

      {paraDialog && (
        <ParagraphPublishDialog
          loadPreview={() => previewBlogPostForParagraph(post.author, post.permlink)}
          onSend={(opts) => sendBlogPostToParagraph(post.author, post.permlink, opts)}
          onClose={() => setParaDialog(false)}
          onDone={(r) => setParaDone(r)}
        />
      )}
    </div>
  );
}
