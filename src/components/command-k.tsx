"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, ArrowRight, LayoutGrid, Clock, CornerDownLeft } from "lucide-react";
import { portalUrlFor } from "@/lib/portal-host";

type NavItem = { href: string; label: string };
type Portal = { slug: string; name: string; subdomain?: string };
type Cmd = { id: string; label: string; group: string; run: () => void; hint?: string };

const RECENT_KEY = "portal-recent-paths";

export function CommandK({
  navItems,
  portals,
  currentSlug,
}: {
  navItems: NavItem[];
  portals: Portal[];
  currentSlug: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track recently-visited paths.
  useEffect(() => {
    if (!pathname || pathname === "/login") return;
    try {
      const prev: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      const next = [pathname, ...prev.filter((p) => p !== pathname)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {}
  }, [pathname]);

  // ⌘K / Ctrl+K toggles; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The sidebar's search button opens the palette through this event, so the
  // shortcut isn't the only way in — nobody discovers ⌘K on their own.
  useEffect(() => {
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("portal:open-command-k", onOpenRequest);
    return () => window.removeEventListener("portal:open-command-k", onOpenRequest);
  }, []);

  useEffect(() => {
    if (open) {
      try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")); } catch {}
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Same rule as the sidebar switcher, same helper — these two drifting apart
  // is how one of them would silently keep the three-level bug.
  const portalUrl = useCallback((p: Portal) => {
    const knownLabels = portals.flatMap((x) => (x.subdomain ? [x.slug, x.subdomain] : [x.slug]));
    return portalUrlFor(p.subdomain ?? p.slug, window.location, knownLabels);
  }, [portals]);

  const labelFor = useCallback((href: string) => navItems.find((n) => n.href === href)?.label ?? href, [navItems]);

  const commands = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => { setOpen(false); router.push(href); };
    const recents: Cmd[] = recent
      .filter((p) => p !== pathname)
      .slice(0, 5)
      .map((p) => ({ id: `recent:${p}`, label: labelFor(p), group: "Recentes", hint: p, run: go(p) }));
    const pages: Cmd[] = navItems.map((n) => ({ id: `page:${n.href}`, label: n.label, group: "Páginas", hint: n.href, run: go(n.href) }));
    const portalCmds: Cmd[] = portals
      .filter((p) => p.slug !== currentSlug)
      .map((p) => ({ id: `portal:${p.slug}`, label: p.name, group: "Portais", hint: "trocar de portal", run: () => { window.location.href = portalUrl(p); } }));
    return [...recents, ...pages, ...portalCmds];
  }, [recent, pathname, navItems, portals, currentSlug, labelFor, portalUrl, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => { setCursor(0); }, [query]);

  if (!open) return null;

  const groups = [...new Set(filtered.map((c) => c.group))];
  let idx = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-foreground-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); filtered[cursor]?.run(); }
            }}
            placeholder="Ir para… (páginas, portais)"
            className="w-full bg-transparent py-3 text-sm text-foreground placeholder:text-foreground-faint focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-foreground-faint">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-foreground-faint">Nada encontrado.</p>}
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide text-foreground-faint">
                {g === "Recentes" ? <Clock className="h-3 w-3" /> : g === "Portais" ? <LayoutGrid className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                {g}
              </div>
              {filtered.filter((c) => c.group === g).map((c) => {
                idx++;
                const sel = idx === cursor;
                const myIdx = idx;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onMouseEnter={() => setCursor(myIdx)}
                    onClick={() => c.run()}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${sel ? "bg-accent-bg text-accent" : "text-foreground hover:bg-foreground/5"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="shrink-0 truncate text-[11px] text-foreground-faint">{c.hint}</span>}
                    {sel && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
