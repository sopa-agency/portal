"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Hash, Check, Search } from "lucide-react";
import { searchFarcasterChannels, type FarcasterChannel } from "@/app/actions/farcaster";

/**
 * Inline Farcaster channel selector for a single campaign cast. Defaults to the
 * project's channel; `onChange` gives the chosen channel id to pass as a
 * per-send override. Farcaster channels are an open set, so this is a live
 * search box (debounced) rather than a fixed dropdown. Renders nothing when
 * Neynar isn't configured.
 */
export function FarcasterChannelSelect({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FarcasterChannel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Seed the project's default channel on mount.
  useEffect(() => {
    let live = true;
    searchFarcasterChannels("").then((r) => {
      if (!live) return;
      if (r.ok) { if (!value && r.defaultId) onChange(r.defaultId); }
      else setUnavailable(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live search while the dropdown is open. All state updates live
  // inside the timeout (not the effect body) to satisfy set-state-in-effect.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    const t = setTimeout(async () => {
      if (!query) { setResults(null); return; }
      setLoading(true);
      const r = await searchFarcasterChannels(query);
      setLoading(false);
      setResults(r.ok ? r.channels : []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (unavailable) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Escolher o canal do Farcaster para este cast"
        className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-1.5 py-1 text-[11px] text-foreground transition hover:border-border-strong"
      >
        <Hash className="h-3 w-3 text-purple-400" />
        <span className="max-w-[10rem] truncate">/{value || "canal"}</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 shrink-0 text-foreground-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar canal do Farcaster…"
              className="w-full bg-transparent text-[12px] text-foreground placeholder:text-foreground-faint focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {loading && (
              <p className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-foreground-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> buscando…
              </p>
            )}
            {!loading && !results && <p className="px-2 py-1.5 text-[11px] text-foreground-faint">digite pra buscar canais</p>}
            {!loading && results && results.length === 0 && <p className="px-2 py-1.5 text-[11px] text-foreground-faint">nenhum canal encontrado</p>}
            {!loading &&
              results?.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange(c.id); setOpen(false); setQ(""); setResults(null); }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] text-foreground-muted transition hover:bg-accent-bg hover:text-foreground"
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
                  ) : (
                    <Hash className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate">/{c.id}</span>
                  {typeof c.followerCount === "number" && (
                    <span className="shrink-0 text-[10px] text-foreground-faint">{c.followerCount.toLocaleString()}</span>
                  )}
                  {c.id === value && <Check className="h-3 w-3 shrink-0 text-accent" />}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
