"use client";

import { useEffect, useRef, useState } from "react";
import { Smile, Search, Loader2 } from "lucide-react";
import { EMOJI_CATEGORIES, searchEmojis } from "@/lib/emoji-data";
import { getServerEmojis, type ServerEmoji } from "@/app/actions/discord-emojis";

/**
 * Lightweight emoji picker — a button that opens a popover with categorized
 * unicode emojis + search. When `withServerEmojis` is set it adds a "Server"
 * tab that lazy-loads the active project's Discord custom emojis; picking one
 * inserts the `<:name:id>` syntax Discord renders.
 */
export function EmojiPicker({
  onPick,
  withServerEmojis = false,
  align = "left",
}: {
  /** Receives the chosen emoji char (or Discord `<:name:id>` syntax). */
  onPick: (text: string) => void;
  withServerEmojis?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string>(withServerEmojis ? "server" : EMOJI_CATEGORIES[0].id);
  const [serverEmojis, setServerEmojis] = useState<ServerEmoji[] | null>(null);
  const [loadingServer, setLoadingServer] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Lazy-load server emojis the first time the picker opens.
  useEffect(() => {
    if (!open || !withServerEmojis || serverEmojis !== null || loadingServer) return;
    setLoadingServer(true);
    getServerEmojis()
      .then((r) => setServerEmojis(r.emojis))
      .catch(() => setServerEmojis([]))
      .finally(() => setLoadingServer(false));
  }, [open, withServerEmojis, serverEmojis, loadingServer]);

  const searchHits = query.trim() ? searchEmojis(query) : null;
  const serverHits =
    query.trim() && serverEmojis
      ? serverEmojis.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
      : serverEmojis;

  const pick = (text: string) => {
    onPick(text);
    // keep open for multi-insert; clear search for convenience
  };

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Insert emoji"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/70 px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:text-foreground"
      >
        <Smile className="h-3.5 w-3.5" />
        Emoji
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 w-[296px] rounded-xl border border-border bg-surface-elevated p-2 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          } top-full`}
        >
          {/* search */}
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-foreground-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji…"
              className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-foreground-faint"
            />
          </div>

          {/* category tabs (hidden while searching) */}
          {!query.trim() && (
            <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
              {withServerEmojis && (
                <TabBtn active={tab === "server"} onClick={() => setTab("server")} label="Server" />
              )}
              {EMOJI_CATEGORIES.map((c) => (
                <TabBtn key={c.id} active={tab === c.id} onClick={() => setTab(c.id)} label={c.label} />
              ))}
            </div>
          )}

          {/* grid */}
          <div className="max-h-[200px] overflow-y-auto">
            {searchHits ? (
              <UnicodeGrid emojis={searchHits} onPick={pick} />
            ) : tab === "server" ? (
              loadingServer ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-foreground-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading server emojis…
                </div>
              ) : serverHits && serverHits.length > 0 ? (
                <ServerGrid emojis={serverHits} onPick={pick} />
              ) : (
                <p className="px-2 py-8 text-center text-xs text-foreground-subtle">
                  No custom server emojis available.
                </p>
              )
            ) : (
              <UnicodeGrid
                emojis={(EMOJI_CATEGORIES.find((c) => c.id === tab) ?? EMOJI_CATEGORIES[0]).emojis.map(
                  ([e]) => e,
                )}
                onPick={pick}
              />
            )}
          </div>

          {tab === "server" && !query.trim() && (serverHits?.length ?? 0) > 0 && (
            <p className="mt-1 px-1 text-[10px] text-foreground-faint">
              Inserts <code>{"<:name:id>"}</code> — only renders in Discord.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active ? "bg-accent-bg text-accent" : "text-foreground-subtle hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function UnicodeGrid({ emojis, onPick }: { emojis: string[]; onPick: (t: string) => void }) {
  if (emojis.length === 0) {
    return <p className="px-2 py-8 text-center text-xs text-foreground-subtle">No matches.</p>;
  }
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((e, i) => (
        <button
          key={`${e}-${i}`}
          type="button"
          onClick={() => onPick(e)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-foreground/10"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

function ServerGrid({ emojis, onPick }: { emojis: ServerEmoji[]; onPick: (t: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onPick(e.syntax)}
          title={`:${e.name}:`}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/10"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.url} alt={e.name} className="h-5 w-5 object-contain" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
