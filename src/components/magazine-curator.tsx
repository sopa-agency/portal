"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus, Loader2, Send, CheckCircle2, ExternalLink, FilePlus2, Undo2, Radio } from "lucide-react";
import {
  getCuratorIssue,
  listMagazineIssues,
  createDraftIssue,
  addMagazinePost,
  removeMagazinePost,
  reorderMagazinePosts,
  setMagazineIssueMeta,
  publishMagazineIssue,
  unpublishMagazineIssue,
  type CuratorIssue,
  type IssueSummary,
} from "@/app/actions/magazine";

type Candidate = { author: string; permlink: string; title: string; thumbnail: string | null; votes: number };

function EditionButton({ i, selected, disabled, onSelect }: { i: IssueSummary; selected: boolean; disabled: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(i.id)}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
        selected ? "border-accent-border bg-accent-bg text-accent" : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
      }`}
    >
      <span className="min-w-0 truncate">#{i.number} · {i.title}</span>
      <span className="shrink-0 text-[10px] text-foreground-faint">{i.postCount}</span>
    </button>
  );
}

export function MagazineCurator({
  initialIssues,
  initialActiveId,
  initialIssue,
  candidates,
  frontend,
}: {
  initialIssues: IssueSummary[];
  initialActiveId: string | null;
  initialIssue: CuratorIssue;
  candidates: Candidate[];
  frontend: string;
}) {
  const [issues, setIssues] = useState(initialIssues);
  const [activeId, setActiveId] = useState(initialActiveId);
  const [issue, setIssue] = useState(initialIssue);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState(initialIssue.title);
  const [cover, setCover] = useState(initialIssue.coverUrl ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Keep the title/cover inputs in sync with the selected edition.
  useEffect(() => {
    setTitle(issue.title);
    setCover(issue.coverUrl ?? "");
  }, [issue.id, issue.title, issue.coverUrl]);

  const inIssue = new Set(issue.posts.map((p) => `${p.author}/${p.permlink}`));

  async function refreshList() {
    const r = await listMagazineIssues();
    if (r.ok) { setIssues(r.issues); setActiveId(r.activeId); }
  }
  async function loadIssue(id: string) {
    const r = await getCuratorIssue(id);
    if (r.ok) setIssue(r.issue);
    else setMsg({ ok: false, text: r.error });
  }

  // Run a mutation against the selected edition, then re-sync issue + list.
  function mutate(fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) { setMsg({ ok: false, text: r.error || "Falhou." }); return; }
      if (okText) setMsg({ ok: true, text: okText });
      await loadIssue(issue.id);
      await refreshList();
    });
  }

  function select(id: string) {
    if (id === issue.id) return;
    setMsg(null);
    start(async () => { await loadIssue(id); });
  }

  function newEdition() {
    setMsg(null);
    start(async () => {
      const r = await createDraftIssue();
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      await loadIssue(r.issueId);
      await refreshList();
    });
  }

  function move(idx: number, dir: -1 | 1) {
    const next = [...issue.posts];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setIssue({ ...issue, posts: next });
    const ids = next.map((p) => p.id);
    start(async () => {
      const r = await reorderMagazinePosts(issue.id, ids);
      if (!r.ok) { setMsg({ ok: false, text: r.error || "Falha ao reordenar." }); await loadIssue(issue.id); }
    });
  }

  const published = issue.status === "published";
  const isActive = issue.id === activeId;
  const active = issues.find((i) => i.active);
  const drafts = issues.filter((i) => i.status === "draft");
  const old = issues.filter((i) => i.status === "published" && !i.active);

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* Editions */}
      <aside className="space-y-4">
        <button
          type="button"
          onClick={newEdition}
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-2 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
        >
          <FilePlus2 className="h-3.5 w-3.5" /> Nova edição
        </button>
        {active && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 px-1 text-[10px] uppercase tracking-wider text-success"><Radio className="h-3 w-3" /> Ativa (no ar)</p>
            <EditionButton i={active} selected={active.id === issue.id} disabled={pending} onSelect={select} />
          </div>
        )}
        {drafts.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-[10px] uppercase tracking-wider text-warning">Rascunhos</p>
            {drafts.map((i) => <EditionButton key={i.id} i={i} selected={i.id === issue.id} disabled={pending} onSelect={select} />)}
          </div>
        )}
        {old.length > 0 && (
          <div className="space-y-1.5">
            <p className="px-1 text-[10px] uppercase tracking-wider text-foreground-faint">Antigas</p>
            {old.map((i) => <EditionButton key={i.id} i={i} selected={i.id === issue.id} disabled={pending} onSelect={select} />)}
          </div>
        )}
      </aside>

      {/* Selected edition editor */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">
              Edição #{issue.number} ·{" "}
              <span className={isActive ? "text-success" : published ? "text-foreground-muted" : "text-warning"}>
                {isActive ? "ativa" : published ? "publicada (antiga)" : "rascunho"}
              </span>
              {" · "}{issue.posts.length} posts
            </span>
            <span className="flex items-center gap-1.5">
              {published && (
                <button type="button" onClick={() => mutate(() => unpublishMagazineIssue(issue.id), "Voltou para rascunho.")} disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50">
                  <Undo2 className="h-3.5 w-3.5" /> Despublicar
                </button>
              )}
              <button type="button" onClick={() => mutate(() => publishMagazineIssue(issue.id), isActive ? "Republicada." : "Publicada — agora é a edição ativa no site.")} disabled={pending || issue.posts.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {isActive ? "Republicar" : published ? "Tornar ativa" : "Publicar edição"}
              </button>
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== issue.title && mutate(() => setMagazineIssueMeta(issue.id, { title }))}
              placeholder="Título da edição"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none" />
            <input value={cover} onChange={(e) => setCover(e.target.value)}
              onBlur={() => cover !== (issue.coverUrl ?? "") && mutate(() => setMagazineIssueMeta(issue.id, { coverUrl: cover }))}
              placeholder="URL da capa (opcional)"
              className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none" />
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
            {issue.posts.map((p, i) => (
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
                  <button type="button" onClick={() => mutate(() => removeMagazinePost(p.id))} disabled={pending} aria-label="Remover" className="rounded p-1 text-foreground-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Candidates */}
      <aside className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">Adicionar por ref</p>
          <div className="mt-2 flex items-center gap-1.5">
            <input value={ref} onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ref.trim()) { e.preventDefault(); const v = ref; setRef(""); mutate(() => addMagazinePost(issue.id, v)); } }}
              placeholder="@autor/permlink ou URL"
              className="min-w-0 flex-1 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-[13px] text-foreground focus:border-border-strong focus:outline-none" />
            <button type="button" onClick={() => { const v = ref; setRef(""); mutate(() => addMagazinePost(issue.id, v)); }} disabled={pending || !ref.trim()} className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground disabled:opacity-50">Add</button>
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
                  <button type="button" onClick={() => mutate(() => addMagazinePost(issue.id, { author: c.author, permlink: c.permlink }))} disabled={pending || added}
                    aria-label="Adicionar à edição"
                    className="shrink-0 rounded-md border border-border p-1.5 text-foreground-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-40">
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
