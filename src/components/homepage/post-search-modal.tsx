"use client";

import { useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { searchSkatehivePosts, type PickerPost } from "@/app/actions/homepage-pickers";

// Shared post picker for the homepage composer (hero slides, strip, junk drawer,
// featured video). Search existing Skatehive posts by author / hashtag / direct
// ref; picking one returns the post (author, permlink, title, thumbnail) so the
// caller can auto-fill media + byline.

type Kind = "author" | "tag" | "ref";

export function PostSearchModal({
  onPick,
  onClose,
}: {
  onPick: (post: PickerPost) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("author");
  const [value, setValue] = useState("");
  const [results, setResults] = useState<PickerPost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await searchSkatehivePosts({ kind, value: value.trim() });
      if (r.ok) setResults(r.posts);
      else { setResults([]); setError(r.error); }
    } catch (e) {
      setResults([]);
      setError(e instanceof Error ? e.message : "Falha na busca.");
    } finally {
      setLoading(false);
    }
  }

  const kindBtn = (k: Kind, label: string) => (
    <button type="button" onClick={() => setKind(k)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${kind === k ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground"}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Escolher post</h4>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded p-1 text-foreground-faint hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {kindBtn("author", "Autor")}
          {kindBtn("tag", "Hashtag")}
          {kindBtn("ref", "URL / ref")}
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-lg border border-border bg-surface px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-foreground-faint" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
            placeholder={kind === "author" ? "@usuário" : kind === "tag" ? "hashtag (ex: skatehive)" : "@autor/permlink ou link"}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
            autoFocus
          />
          <button type="button" onClick={run} disabled={loading || !value.trim()} className="rounded px-2 py-1 text-xs text-accent hover:bg-accent-bg disabled:opacity-40">Buscar</button>
        </div>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
          {loading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-foreground-faint" /></div>}
          {!loading && results?.map((p) => (
            <button key={`${p.author}/${p.permlink}`} type="button" onClick={() => onPick(p)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-2 text-left transition hover:border-accent-border">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-surface-elevated">
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{p.title}</p>
                <p className="truncate text-[11px] text-foreground-subtle">@{p.author}{p.votes ? ` · ${p.votes} votos` : ""}</p>
              </div>
            </button>
          ))}
          {!loading && results && results.length === 0 && !error && <p className="py-6 text-center text-[11px] text-foreground-faint">Nada encontrado.</p>}
        </div>
      </div>
    </div>
  );
}
