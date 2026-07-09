"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, Trash2, Plus, Loader2, Send, CheckCircle2, ExternalLink } from "lucide-react";
import {
  addMagazinePost,
  removeMagazinePost,
  reorderMagazinePosts,
  setMagazineIssueMeta,
  publishMagazineIssue,
  type CuratorIssue,
  type CuratorPost,
} from "@/app/actions/magazine";

type Candidate = { author: string; permlink: string; title: string; thumbnail: string | null; votes: number };

export function MagazineCurator({
  initialIssue,
  candidates,
  frontend,
}: {
  initialIssue: CuratorIssue;
  candidates: Candidate[];
  frontend: string;
}) {
  const router = useRouter();
  const [issue, setIssue] = useState(initialIssue);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState(initialIssue.title);
  const [cover, setCover] = useState(initialIssue.coverUrl ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const inIssue = new Set(issue.posts.map((p) => `${p.author}/${p.permlink}`));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (okText) setMsg({ ok: true, text: okText });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error || "Falhou." });
      }
    });
  }

  // Optimistic reorder (local) then persist the new id order.
  function move(idx: number, dir: -1 | 1) {
    const next = [...issue.posts];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setIssue({ ...issue, posts: next });
    const ids = next.map((p) => p.id);
    start(async () => {
      const r = await reorderMagazinePosts(ids);
      if (!r.ok) { setMsg({ ok: false, text: r.error || "Falha ao reordenar." }); router.refresh(); }
    });
  }

  const published = issue.status === "published";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Left: the issue */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">
              Edição #{issue.number} ·{" "}
              <span className={published ? "text-success" : "text-warning"}>{published ? "publicada" : "rascunho"}</span>
              {" · "}{issue.posts.length} posts
            </span>
            <button
              type="button"
              onClick={() => run(publishMagazineIssue, "Edição publicada — já está em /api/magazine/current.")}
              disabled={pending || issue.posts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {published ? "Republicar" : "Publicar edição"}
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== issue.title && run(() => setMagazineIssueMeta({ title }))}
              placeholder="Título da edição"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
            <input
              value={cover}
              onChange={(e) => setCover(e.target.value)}
              onBlur={() => cover !== (issue.coverUrl ?? "") && run(() => setMagazineIssueMeta({ coverUrl: cover }))}
              placeholder="URL da capa (opcional)"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        {msg && (
          <p className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${msg.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
            {msg.ok && <CheckCircle2 className="h-3.5 w-3.5" />} {msg.text}
          </p>
        )}

        {issue.posts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-foreground-muted">
            Edição vazia. Adicione posts pela lista ao lado ou colando um @autor/permlink.
          </p>
        ) : (
          <ol className="space-y-2">
            {issue.posts.map((p: CuratorPost, i) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5">
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-foreground-faint">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-md bg-surface-elevated" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{p.title}</p>
                  <p className="truncate text-[11px] text-foreground-subtle">@{p.author}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => move(i, -1)} disabled={pending || i === 0} aria-label="Subir" className="rounded p-1 text-foreground-faint hover:text-foreground disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={pending || i === issue.posts.length - 1} aria-label="Descer" className="rounded p-1 text-foreground-faint hover:text-foreground disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                  <a href={`${frontend.replace(/\/$/, "")}/post/@${p.author}/${p.permlink}`} target="_blank" rel="noreferrer" aria-label="Abrir post" className="rounded p-1 text-foreground-faint hover:text-foreground"><ExternalLink className="h-4 w-4" /></a>
                  <button type="button" onClick={() => run(() => removeMagazinePost(p.id))} disabled={pending} aria-label="Remover" className="rounded p-1 text-foreground-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Right: add posts */}
      <aside className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">Adicionar por ref</p>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ref.trim()) { e.preventDefault(); run(() => addMagazinePost(ref), undefined); setRef(""); } }}
              placeholder="@autor/permlink ou URL"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-[13px] text-foreground focus:border-border-strong focus:outline-none"
            />
            <button type="button" onClick={() => { run(() => addMagazinePost(ref)); setRef(""); }} disabled={pending || !ref.trim()} className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">Add</button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">Posts recentes da comunidade</p>
          <ul className="mt-2 space-y-1.5">
            {candidates.map((c) => {
              const added = inIssue.has(`${c.author}/${c.permlink}`);
              return (
                <li key={`${c.author}/${c.permlink}`} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.thumbnail ? <img src={c.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" /> : <div className="h-9 w-9 shrink-0 rounded bg-surface-elevated" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{c.title}</p>
                    <p className="truncate text-[10px] text-foreground-subtle">@{c.author} · {c.votes} votos</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => run(() => addMagazinePost({ author: c.author, permlink: c.permlink }))}
                    disabled={pending || added}
                    aria-label="Adicionar à edição"
                    className="shrink-0 rounded-md border border-border p-1.5 text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40"
                  >
                    {added ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Plus className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
            {candidates.length === 0 && <li className="text-[11px] text-foreground-faint">Nenhum post recente disponível.</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}
