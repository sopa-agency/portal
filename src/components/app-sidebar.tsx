"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef, useEffect } from "react";
import { Megaphone, Home, LogOut, Users, UsersRound, Sparkles, ChartColumn, SquarePen, ChevronsUpDown, Check, SquareKanban, Landmark, Presentation, Workflow, Briefcase, FlaskConical, BookOpenText, CalendarDays, Settings, Heart, Newspaper, LayoutTemplate, type LucideIcon } from "lucide-react";
import { OnlineAvatars } from "@/components/presence";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Section header this item sits under (Home/Settings stay ungrouped). */
  group?: string;
  requiresPostCreator?: boolean;
  requiresLab?: boolean;
  requiresZine?: boolean;
  requiresKanban?: boolean;
  requiresMagazine?: boolean;
  requiresHomepage?: boolean;
  requiresAbout?: boolean;
  requiresOrgChart?: boolean;
  requiresPortfolio?: boolean;
  requiresMeetings?: boolean;
  requiresFarcasterTrail?: boolean;
};

// Grouped by what you're doing: Home on top, Settings pinned at the bottom.
const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },

  { href: "/post-creator", label: "Post Creator", icon: SquarePen, group: "Criação", requiresPostCreator: true },
  { href: "/zine", label: "Zine Studio", icon: BookOpenText, group: "Criação", requiresZine: true },
  { href: "/lab", label: "Lab", icon: FlaskConical, group: "Criação", requiresLab: true },
  { href: "/campaign-creator", label: "Campaign Creator", icon: Megaphone, group: "Criação" },
  { href: "/marketing-suggestions", label: "Post Suggestions", icon: Sparkles, group: "Criação" },

  { href: "/curadoria", label: "Engagement", icon: Heart, group: "Crescimento", requiresFarcasterTrail: true },
  { href: "/analytics", label: "Analytics", icon: ChartColumn, group: "Crescimento" },
  { href: "/userbase", label: "Userbase", icon: Users, group: "Crescimento" },

  { href: "/magazine", label: "Magazine", icon: Newspaper, group: "Publicação", requiresMagazine: true },
  { href: "/homepage", label: "Homepage", icon: LayoutTemplate, group: "Publicação", requiresHomepage: true },

  { href: "/kanban", label: "Kanban", icon: SquareKanban, group: "Operação", requiresKanban: true },
  { href: "/treasury", label: "Treasury", icon: Landmark, group: "Operação" },
  { href: "/org-chart", label: "Org Chart", icon: Workflow, group: "Operação", requiresOrgChart: true },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, group: "Operação", requiresPortfolio: true },
  { href: "/reunioes", label: "Reuniões", icon: CalendarDays, group: "Operação", requiresMeetings: true },
  { href: "/about", label: "About", icon: Presentation, group: "Operação", requiresAbout: true },
  { href: "/team", label: "Team", icon: UsersRound, group: "Operação" },

  { href: "/settings", label: "Settings", icon: Settings },
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
  meetingsEnabled?: boolean;
  labEnabled?: boolean;
  zineEnabled?: boolean;
  farcasterTrailEnabled?: boolean;
};

export function AppSidebar({ username, projectName, projectLogo, currentSlug, switchProjects, hiddenRoutes, postCreatorEnabled, kanbanEnabled, magazineEnabled, homepageEnabled, aboutEnabled, orgChartEnabled, portfolioEnabled, labEnabled, zineEnabled, meetingsEnabled, farcasterTrailEnabled }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

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

  // Switch portals by swapping the leftmost host label — works across prod
  // (admin/skatehive/gnars.reelflip.com, legacy slug.portal.skatehive.app),
  // Tailscale nip.io, and localhost. A project's host label is its `subdomain`
  // when set (Reelflip → "admin"), else its slug.
  const knownLabels = switchProjects.flatMap((p) => (p.subdomain ? [p.slug, p.subdomain] : [p.slug]));
  function switchTo(target: SwitchProject) {
    if (target.slug === currentSlug) { setSwitcherOpen(false); return; }
    const { protocol, hostname, port } = window.location;
    const labels = hostname.split(".");
    const base = knownLabels.includes(labels[0]) ? labels.slice(1) : labels;
    const targetLabel = target.subdomain ?? target.slug;
    const host = [targetLabel, ...base].join(".");
    window.location.assign(`${protocol}//${host}${port ? `:${port}` : ""}/`);
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
    if ("requiresMeetings" in item && item.requiresMeetings && !meetingsEnabled) return false;
    if ("requiresFarcasterTrail" in item && item.requiresFarcasterTrail && !farcasterTrailEnabled) return false;
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
    <aside className="w-full border-b border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="relative px-3 py-4" ref={switcherRef}>
        {switchProjects.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setSwitcherOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              aria-label="Switch workspace"
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/5"
            >
              <Image
                src={projectLogo}
                alt={projectName}
                width={36}
                height={36}
                className="shrink-0 rounded-md"
                priority
              />
              <p className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-accent">
                {projectName}
              </p>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-foreground-faint" />
            </button>
            {switcherOpen && (
              <div
                role="menu"
                className="absolute left-3 right-3 top-[calc(100%-0.5rem)] z-50 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-lg"
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
          <Link href="/" className="flex items-center gap-3 px-2 py-2">
            <Image src={projectLogo} alt={projectName} width={36} height={36} className="shrink-0 rounded-md" priority />
            <div className="min-w-0">
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
      <nav className="px-3 pb-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <ul className="space-y-1">
          {(() => {
            const items: React.ReactNode[] = [];
            let lastGroup: string | undefined;
            for (const { href, label, icon: Icon, group } of nav) {
              // Section header when entering a new group.
              if (group && group !== lastGroup) {
                items.push(
                  <li
                    key={`group-${group}`}
                    className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-foreground-faint"
                  >
                    {group}
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
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-accent-bg text-accent"
                        : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${active ? "text-accent" : ""}`} />
                    {label}
                  </Link>
                </li>,
              );
            }
            return items;
          })()}
        </ul>
      </nav>
      <div className="mt-auto border-t border-border px-3 py-3">
        <OnlineAvatars />
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-bold uppercase text-accent">
            {username.slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">@{username}</p>
            <p className="text-[10px] uppercase tracking-wider text-foreground-faint">connected</p>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            aria-label="Log out"
            className="shrink-0 rounded-lg p-2 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
