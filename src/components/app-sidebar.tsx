"use client";

import Link from "next/link";
import { useT } from "@/components/locale-provider";
import { SidebarProfile } from "@/components/sidebar-profile";
import type { Dictionary } from "@/lib/i18n/dictionary";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef, useEffect, useCallback } from "react";
import { Megaphone, Home, Users, UsersRound, Sparkles, ChartColumn, SquarePen, ChevronsUpDown, Check, SquareKanban, Landmark, Presentation, Workflow, Briefcase, FlaskConical, BookOpenText, CalendarDays, Settings, Heart, Music2, Newspaper, LayoutTemplate, MessagesSquare, Menu, X, PanelLeftClose, PanelLeftOpen, Search, type LucideIcon } from "lucide-react";
import { OnlineAvatars } from "@/components/presence";
import { portalUrlFor } from "@/lib/portal-host";

const SIDEBAR_COLLAPSED_KEY = "portal.sidebar.collapsed";
const SIDEBAR_WIDTH_KEY = "portal.sidebar.width";

/** Matches lg:w-64, the width before the column became resizable. */
const SIDEBAR_WIDTH_DEFAULT = 256;
/** Narrow enough to be worth it, wide enough that no nav label truncates. */
const SIDEBAR_WIDTH_MIN = 200;
/** Past this the sidebar stops being a sidebar. */
const SIDEBAR_WIDTH_MAX = 440;

const clampWidth = (px: number) =>
  Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));

/** Opens the ⌘K palette from a click — see CommandK's listener. */
const COMMAND_K_EVENT = "portal:open-command-k";

type NavItemKey = keyof Dictionary["nav"]["items"];
type NavGroupKey = keyof Dictionary["nav"]["groups"];

type NavItem = {
  href: string;
  /** Dictionary key, not display text — the label itself is translated at
   *  render time so this table never has to be duplicated per language. */
  key: NavItemKey;
  icon: LucideIcon;
  /** Section header this item sits under (Home/Settings stay ungrouped). */
  group?: NavGroupKey;
  requiresPostCreator?: boolean;
  requiresLab?: boolean;
  requiresZine?: boolean;
  requiresKanban?: boolean;
  requiresMagazine?: boolean;
  requiresHomepage?: boolean;
  requiresAbout?: boolean;
  requiresOrgChart?: boolean;
  requiresPortfolio?: boolean;
  requiresChat?: boolean;
  requiresMeetings?: boolean;
  requiresFarcasterTrail?: boolean;
  requiresTikTok?: boolean;
};

// Grouped by what you're doing: Home on top, Settings pinned at the bottom.
const NAV: NavItem[] = [
  { href: "/", key: "home", icon: Home },

  { href: "/post-creator", key: "postCreator", icon: SquarePen, group: "creation", requiresPostCreator: true },
  { href: "/zine", key: "zine", icon: BookOpenText, group: "creation", requiresZine: true },
  { href: "/lab", key: "lab", icon: FlaskConical, group: "creation", requiresLab: true },
  { href: "/tiktok", key: "tiktok", icon: Music2, group: "creation", requiresTikTok: true },
  { href: "/campaign-creator", key: "campaignCreator", icon: Megaphone, group: "creation" },
  { href: "/marketing-suggestions", key: "postSuggestions", icon: Sparkles, group: "creation" },

  { href: "/curadoria", key: "engagement", icon: Heart, group: "growth", requiresFarcasterTrail: true },
  { href: "/analytics", key: "analytics", icon: ChartColumn, group: "growth" },
  { href: "/userbase", key: "userbase", icon: Users, group: "growth" },

  { href: "/magazine", key: "magazine", icon: Newspaper, group: "publishing", requiresMagazine: true },
  { href: "/homepage", key: "homepage", icon: LayoutTemplate, group: "publishing", requiresHomepage: true },

  { href: "/kanban", key: "kanban", icon: SquareKanban, group: "operations", requiresKanban: true },
  { href: "/treasury", key: "treasury", icon: Landmark, group: "operations" },
  { href: "/org-chart", key: "orgChart", icon: Workflow, group: "operations", requiresOrgChart: true },
  { href: "/portfolio", key: "portfolio", icon: Briefcase, group: "operations", requiresPortfolio: true },
  // O CHAT ficou com o lugar que era dos Briefs, como pedido. A rota /briefs
  // continua de pé e funcionando — ela é a caixa de entrada dos briefings que
  // chegam pelo formulário do site público, e apagar isso não foi o pedido.
  // Hoje ela se alcança pela URL. Se fizer falta no menu, é uma linha de volta.
  { href: "/chat", key: "chat", icon: MessagesSquare, group: "operations", requiresChat: true },
  { href: "/reunioes", key: "meetings", icon: CalendarDays, group: "operations", requiresMeetings: true },
  { href: "/about", key: "about", icon: Presentation, group: "operations", requiresAbout: true },
  { href: "/team", key: "team", icon: UsersRound, group: "operations" },

  { href: "/settings", key: "settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SwitchProject = {
  slug: string;
  subdomain?: string;
  name: string;
  logo: string;
  /** Indent under the previous top-level entry (e.g. Gnars under Reelflip). */
  indent?: boolean;
  /** Horizontal rule above this entry — a separate org (e.g. KeepKey). */
  dividerBefore?: boolean;
};

type AppSidebarProps = {
  username: string;
  /** Resolved at login and read from the DB; null when the account has no Hive
   *  picture, so the initials stand in rather than Hive's generic silhouette. */
  avatarUrl?: string | null;
  /** Carteira cadastrada no Team — o menu de perfil compara com a conectada. */
  registeredWallet?: string | null;
  projectName: string;
  projectLogo: string;
  currentSlug: string;
  switchProjects: SwitchProject[];
  hiddenRoutes?: string[];
  postCreatorEnabled?: boolean;
  kanbanEnabled?: boolean;
  magazineEnabled?: boolean;
  homepageEnabled?: boolean;
  aboutEnabled?: boolean;
  orgChartEnabled?: boolean;
  portfolioEnabled?: boolean;
  chatEnabled?: boolean;
  meetingsEnabled?: boolean;
  tiktokEnabled?: boolean;
  labEnabled?: boolean;
  zineEnabled?: boolean;
  farcasterTrailEnabled?: boolean;
};

export function AppSidebar({ username, avatarUrl, registeredWallet = null, projectName, projectLogo, currentSlug, switchProjects, hiddenRoutes, postCreatorEnabled, kanbanEnabled, magazineEnabled, homepageEnabled, aboutEnabled, orgChartEnabled, portfolioEnabled, chatEnabled, labEnabled, zineEnabled, meetingsEnabled, farcasterTrailEnabled, tiktokEnabled }: AppSidebarProps) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  // On mobile the sidebar is an off-canvas drawer; on lg+ it's the static column.
  const [mobileOpen, setMobileOpen] = useState(false);
  // Collapsed = the lg+ column shrinks to an icon rail. This single <aside> is
  // BOTH the mobile drawer and the desktop column, so every collapse style is
  // lg:-prefixed — dropping labels outright would strip them from the drawer too.
  const [collapsed, setCollapsed] = useState(false);
  // Gates the width transition: restoring the stored state on load should snap,
  // not animate, or every page load looks like the sidebar is closing itself.
  const [hydrated, setHydrated] = useState(false);

  const [width, setWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [dragging, setDragging] = useState(false);

  // Restore in an effect rather than during render: reading localStorage while
  // rendering would disagree with the server HTML and trip hydration.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
      const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(stored) && stored > 0) setWidth(clampWidth(stored));
    } catch {}
    setHydrated(true);
  }, []);

  // Drag the right edge to resize. The column is pinned to the viewport's left
  // edge, so the pointer's x IS the width — no offset math, and it keeps working
  // if the sidebar's own scroll position changes mid-drag.
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: PointerEvent) => setWidth(clampWidth(ev.clientX));
    const onUp = (ev: PointerEvent) => {
      const final = clampWidth(ev.clientX);
      setWidth(final);
      setDragging(false);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(final));
      } catch {}
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  // Keyboard resize, so the handle isn't mouse-only.
  const nudgeWidth = useCallback((delta: number) => {
    setWidth((w) => {
      const next = clampWidth(w + delta);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const resetWidth = useCallback(() => {
    setWidth(SIDEBAR_WIDTH_DEFAULT);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_WIDTH_DEFAULT));
    } catch {}
  }, []);

  // While dragging, kill text selection and hold the resize cursor everywhere —
  // otherwise the pointer picks up labels as it crosses them.
  useEffect(() => {
    if (!dragging) return;
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B, the shortcut this control has in most editors and chat apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  // Close the workspace switcher on outside click.
  useEffect(() => {
    if (!switcherOpen) return;
    function onDoc(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [switcherOpen]);

  // While the drawer is open: close on Escape and lock body scroll behind it.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Switch portals via the shared helper: on the real domain the root is fixed
  // (see portal-host.ts — deriving it from the current host is what produced
  // `<brand>.portal.sopa.team`), with label-swapping kept for nip.io/localhost.
  // A project's host label is its `subdomain` when set, else its slug.
  const knownLabels = switchProjects.flatMap((p) => (p.subdomain ? [p.slug, p.subdomain] : [p.slug]));
  function switchTo(target: SwitchProject) {
    if (target.slug === currentSlug) { setSwitcherOpen(false); return; }
    window.location.assign(portalUrlFor(target.subdomain ?? target.slug, window.location, knownLabels));
  }

  const nav = NAV.filter((item) => {
    if (hiddenRoutes?.includes(item.href)) return false;
    if ("requiresPostCreator" in item && item.requiresPostCreator && !postCreatorEnabled) return false;
    if ("requiresLab" in item && item.requiresLab && !labEnabled) return false;
    if ("requiresZine" in item && item.requiresZine && !zineEnabled) return false;
    if ("requiresKanban" in item && item.requiresKanban && !kanbanEnabled) return false;
    if ("requiresMagazine" in item && item.requiresMagazine && !magazineEnabled) return false;
    if ("requiresHomepage" in item && item.requiresHomepage && !homepageEnabled) return false;
    if ("requiresAbout" in item && item.requiresAbout && !aboutEnabled) return false;
    if ("requiresOrgChart" in item && item.requiresOrgChart && !orgChartEnabled) return false;
    if ("requiresPortfolio" in item && item.requiresPortfolio && !portfolioEnabled) return false;
    if ("requiresChat" in item && item.requiresChat && !chatEnabled) return false;
    if ("requiresMeetings" in item && item.requiresMeetings && !meetingsEnabled) return false;
    if ("requiresFarcasterTrail" in item && item.requiresFarcasterTrail && !farcasterTrailEnabled) return false;
    if ("requiresTikTok" in item && item.requiresTikTok && !tiktokEnabled) return false;
    return true;
  });

  const logout = () => {
    startTransition(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {}
      router.replace("/login");
      router.refresh();
    });
  };

  return (
    <>
      {/* Mobile top bar — hamburger + brand. The static column takes over at lg. */}
      {/*
        Altura FIXA de propósito (h-14 = 56px). Antes era altura automática e
        dava 57px por acaso, e o /chat precisa saber quanto sobra da janela para
        ocupar o resto exato — ver APP_ROUTES em content-shell.tsx. Constante
        combinada vale mais que constante adivinhada; se mudar aqui, muda lá.
      */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={t.nav.openMenu}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          className="rounded-lg p-2 text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Image src={projectLogo} alt={projectName} width={28} height={28} className="shrink-0 rounded-md" />
          <span className="min-w-0 truncate text-base font-bold tracking-tight text-accent">{projectName}</span>
        </Link>
      </div>

      {/* Backdrop behind the open drawer (mobile only). */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[85%] max-w-xs flex-col overflow-y-auto border-r border-border bg-surface transition-transform duration-300 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-w-none lg:translate-x-0 lg:overflow-visible ${
          hydrated && !dragging ? "lg:transition-[width] lg:duration-200" : "lg:transition-none"
        } ${collapsed ? "lg:w-14" : "lg:w-[var(--sidebar-w)]"}`}
        // Width rides a custom property so it only applies at lg — an inline
        // width would also hit the mobile drawer, which is sized by percentage.
        style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
      >
        {/* Close affordance — mobile only (lg uses the always-open column). */}
        <div className="flex justify-end px-3 pt-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label={t.nav.closeMenu}
            className="rounded-lg p-2 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Rail controls, lg+ only — the drawer has its own close button, and a
            search affordance matters most where ⌘K is discoverable. */}
        <div
          className={`hidden pt-3 lg:flex lg:items-center lg:gap-1 ${
            collapsed ? "lg:flex-col lg:px-2" : "lg:justify-between lg:px-3"
          }`}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={`${collapsed ? t.nav.expand : t.nav.collapse} ${t.nav.menu}`}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            title={`${collapsed ? t.nav.expand : t.nav.collapse} ${t.nav.menu} (⌘B)`}
            className="rounded-lg p-2 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_K_EVENT))}
            aria-label={t.nav.searchPages}
            title={`${t.nav.search} (⌘K)`}
            className="rounded-lg p-2 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      <div
        className={`relative py-3 pt-0 lg:pt-4 ${collapsed ? "px-3 lg:px-2" : "px-3"}`}
        ref={switcherRef}
      >
        {switchProjects.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              aria-label={t.nav.switchWorkspace}
              title={collapsed ? projectName : undefined}
              className={`flex w-full items-center gap-3 rounded-lg py-2 text-left transition-colors hover:bg-foreground/5 ${
                collapsed ? "px-2 lg:justify-center lg:px-0" : "px-2"
              }`}
            >
              <Image
                src={projectLogo}
                alt={projectName}
                width={36}
                height={36}
                className="shrink-0 rounded-md"
                priority
              />
              <p
                className={`min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-accent ${
                  collapsed ? "lg:hidden" : ""
                }`}
              >
                {projectName}
              </p>
              <ChevronsUpDown
                className={`h-4 w-4 shrink-0 text-foreground-faint ${collapsed ? "lg:hidden" : ""}`}
              />
            </button>
            {switcherOpen && (
              <div
                role="menu"
                // On the rail the sidebar is 3.5rem wide, so the menu can't be
                // pinned to both edges — it opens to a fixed width instead.
                className={`absolute top-[calc(100%-0.5rem)] z-50 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-lg ${
                  collapsed ? "left-3 right-3 lg:right-auto lg:left-2 lg:w-60" : "left-3 right-3"
                }`}
              >
                {switchProjects.map((p) => {
                  const isCurrent = p.slug === currentSlug;
                  return (
                    <div key={p.slug}>
                      {p.dividerBefore && <div className="mx-3 my-1 border-t border-border" role="separator" />}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => switchTo(p)}
                        className={`flex w-full items-center gap-3 py-2.5 pr-3 text-left transition-colors hover:bg-foreground/5 ${
                          p.indent ? "pl-8" : "pl-3"
                        } ${isCurrent ? "bg-accent-bg" : ""}`}
                      >
                        <Image src={p.logo} alt={p.name} width={24} height={24} className="shrink-0 rounded" />
                        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${isCurrent ? "text-accent" : "text-foreground"}`}>
                          {p.name}
                        </span>
                        {isCurrent && <Check className="h-4 w-4 shrink-0 text-accent" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <Link
            href="/"
            onClick={() => setMobileOpen(false)}
            title={collapsed ? projectName : undefined}
            className={`flex items-center gap-3 py-2 ${collapsed ? "px-2 lg:justify-center lg:px-0" : "px-2"}`}
          >
            <Image src={projectLogo} alt={projectName} width={36} height={36} className="shrink-0 rounded-md" priority />
            <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
              <p className="text-lg font-bold tracking-tight text-accent">
                {projectName}
              </p>
              <p className="mt-0.5 text-xs uppercase tracking-widest text-foreground-subtle">
                internal ops
              </p>
            </div>
          </Link>
        )}
      </div>
      <nav className={`pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${collapsed ? "px-3 lg:px-2" : "px-3"}`}>
        <ul className="space-y-1">
          {(() => {
            const items: React.ReactNode[] = [];
            let lastGroup: string | undefined;
            for (const { href, key, icon: Icon, group } of nav) {
              const label = t.nav.items[key];
              // Section header when entering a new group.
              if (group && group !== lastGroup) {
                items.push(
                  // On the rail the wordmark goes but the grouping shouldn't —
                  // it degrades to a divider so the sections stay legible.
                  <li
                    key={`group-${group}`}
                    className={collapsed ? "lg:my-2 lg:border-t lg:border-border" : undefined}
                  >
                    <span
                      className={`block px-3 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint ${
                        collapsed ? "lg:hidden" : ""
                      }`}
                    >
                      {t.nav.groups[group]}
                    </span>
                  </li>,
                );
              }
              // Divider before a trailing ungrouped item (Settings).
              if (!group && lastGroup) {
                items.push(<li key={`sep-${href}`} role="separator" className="my-2 border-t border-border" />);
              }
              lastGroup = group;
              const active = isActive(pathname, href);
              items.push(
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? label : undefined}
                    className={`flex items-center gap-3 rounded-lg py-2 text-sm transition-colors ${
                      collapsed ? "px-3 lg:justify-center lg:px-0" : "px-3"
                    } ${
                      active
                        ? "bg-accent-bg text-accent"
                        : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`} />
                    <span className={collapsed ? "lg:hidden" : ""}>{label}</span>
                  </Link>
                </li>,
              );
            }
            return items;
          })()}
        </ul>
      </nav>
      <div className={`mt-auto border-t border-border py-3 ${collapsed ? "px-3 lg:px-2" : "px-3"}`}>
        {/* The presence strip needs horizontal room the rail doesn't have. */}
        <div className={collapsed ? "lg:hidden" : undefined}>
          <OnlineAvatars />
        </div>
        {/* O perfil deixou de ser um rótulo com um botão de sair ao lado: agora
            é o lugar da identidade inteira — quem está logado, com qual carteira,
            e a saída. Ver sidebar-profile.tsx. */}
        <SidebarProfile
          username={username}
          avatarUrl={avatarUrl ?? null}
          registeredWallet={registeredWallet}
          collapsed={collapsed}
          pending={pending}
          onLogout={logout}
        />
      </div>

      {/* Resize handle — lg+ only, and pointless on the collapsed rail. The strip
          is wider than the visible line so it's easy to grab. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t.nav.resizeMenu}
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); nudgeWidth(-16); }
            else if (e.key === "ArrowRight") { e.preventDefault(); nudgeWidth(16); }
            else if (e.key === "Home") { e.preventDefault(); resetWidth(); }
          }}
          title={t.nav.resizeHint}
          className={`absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize touch-none lg:block ${
            dragging ? "bg-accent" : "bg-transparent hover:bg-accent/40"
          } focus-visible:bg-accent focus-visible:outline-none`}
        />
      )}
      </aside>
    </>
  );
}
