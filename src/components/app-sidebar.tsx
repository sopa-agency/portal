"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";
import { GitBranch, Megaphone, Home, Moon, Sun, LogOut, Users } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/repo-to-social", label: "Repo to Social", icon: GitBranch },
  { href: "/campaign-creator", label: "Campaign Creator", icon: Megaphone },
  { href: "/userbase", label: "Userbase", icon: Users },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [pending, startTransition] = useTransition();

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
      <div className="px-5 py-6">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/skatehive-logo.svg"
            alt="SkateHive"
            width={36}
            height={36}
            className="shrink-0"
            priority
          />
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-tight text-accent">portal · skatehive</p>
            <p className="mt-0.5 text-xs uppercase tracking-widest text-foreground-subtle">
              internal ops
            </p>
          </div>
        </Link>
      </div>
      <nav className="px-3 pb-6">
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
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
      <div className="mt-auto hidden lg:block">
        <div className="space-y-1 border-t border-border px-3 py-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-bold uppercase text-accent">
              {username.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">@{username}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground-faint">
                connected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-4 w-4" />
                Light mode
              </>
            ) : (
              <>
                <Moon className="h-4 w-4" />
                Dark mode
              </>
            )}
          </button>
          <button
            type="button"
            onClick={logout}
            disabled={pending}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
