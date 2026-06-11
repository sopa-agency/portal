"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useTransition, useState, useRef, useEffect } from "react";
import { GitBranch, Megaphone, Home, LogOut, Users, UsersRound, Sparkles, Brain, ChartColumn, SquarePen, ChevronsUpDown, Check, SquareKanban, Landmark } from "lucide-react";
import { OnlineAvatars } from "@/components/presence";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/post-creator", label: "Post Creator", icon: SquarePen, requiresPostCreator: true },
  { href: "/repo-to-social", label: "Repo to Social", icon: GitBranch },
  { href: "/marketing-suggestions", label: "Post Suggestions", icon: Sparkles },
  { href: "/campaign-creator", label: "Campaign Creator", icon: Megaphone },
  { href: "/userbase", label: "Userbase", icon: Users },
  { href: "/brain", label: "Brain", icon: Brain },
  { href: "/analytics", label: "Analytics", icon: ChartColumn },
  { href: "/kanban", label: "Kanban", icon: SquareKanban, requiresKanban: true },
  { href: "/treasury", label: "Treasury", icon: Landmark },
  { href: "/team", label: "Team", icon: UsersRound },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SwitchProject = { slug: string; subdomain?: string; name: string; logo: string };

type AppSidebarProps = {
  username: string;
  projectName: string;
  projectLogo: string;
  currentSlug: string;
  switchProjects: SwitchProject[];
  hiddenRoutes?: string[];
  postCreatorEnabled?: boolean;
  kanbanEnabled?: boolean;
};

export function AppSidebar({ username, projectName, projectLogo, currentSlug, switchProjects, hiddenRoutes, postCreatorEnabled, kanbanEnabled }: AppSidebarProps) {
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
    window.location.href = `${protocol}//${host}${port ? `:${port}` : ""}/`;
  }

  const nav = NAV.filter((item) => {
    if (hiddenRoutes?.includes(item.href)) return false;
    if ("requiresPostCreator" in item && item.requiresPostCreator && !postCreatorEnabled) return false;
    if ("requiresKanban" in item && item.requiresKanban && !kanbanEnabled) return false;
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
    <aside className="w-full border-b border-border bg-surface lg:flex lg:min-h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
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
                portal · {projectName.toLowerCase()}
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
                    <button
                      key={p.slug}
                      type="button"
                      role="menuitem"
                      onClick={() => switchTo(p)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/5 ${isCurrent ? "bg-accent-bg" : ""}`}
                    >
                      <Image src={p.logo} alt={p.name} width={24} height={24} className="shrink-0 rounded" />
                      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${isCurrent ? "text-accent" : "text-foreground"}`}>
                        {p.name}
                      </span>
                      {isCurrent && <Check className="h-4 w-4 shrink-0 text-accent" />}
                    </button>
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
                portal · {projectName.toLowerCase()}
              </p>
              <p className="mt-0.5 text-xs uppercase tracking-widest text-foreground-subtle">
                internal ops
              </p>
            </div>
          </Link>
        )}
      </div>
      <nav className="px-3 pb-6">
        <ul className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
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
              </li>
            );
          })}
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
