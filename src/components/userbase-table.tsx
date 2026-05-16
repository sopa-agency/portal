"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Search, Mail, Copy, Check } from "lucide-react";
import type { UserbaseEmailUser } from "@/app/actions/userbase";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function statusBadge(status: string | null) {
  if (!status) {
    return (
      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground-subtle">
        unknown
      </span>
    );
  }
  const map: Record<string, string> = {
    active: "border-accent-border bg-accent-bg text-accent",
    suspended: "border-danger/30 bg-danger/10 text-danger",
    pending: "border-warning/30 bg-warning/10 text-warning",
  };
  const cls = map[status] ?? "border-border bg-surface-elevated text-foreground-muted";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

function Avatar({ user }: { user: UserbaseEmailUser }) {
  const initials = (user.handle || user.displayName || user.email).slice(0, 2).toUpperCase();
  if (user.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt={user.handle ?? user.email}
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
        unoptimized
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-bold uppercase text-accent">
      {initials}
    </div>
  );
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(email);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      title="Copy email"
      className="rounded-md p-1 text-foreground-subtle transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function UserbaseTable({ users }: { users: UserbaseEmailUser[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        u.email.toLowerCase().includes(q) ||
        (u.handle ?? "").toLowerCase().includes(q) ||
        (u.displayName ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, query]);

  const allEmails = useMemo(() => filtered.map((u) => u.email).join(", "), [filtered]);
  const [copiedAll, setCopiedAll] = useState(false);

  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-6 py-12 text-center">
        <Mail className="mx-auto h-8 w-8 text-foreground-faint" />
        <p className="mt-3 text-sm text-foreground-muted">No users with registered emails yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search handle, name, or email"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground-subtle">
          <span>
            {filtered.length} of {users.length}
          </span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(allEmails);
                setCopiedAll(true);
                setTimeout(() => setCopiedAll(false), 1500);
              } catch {}
            }}
            disabled={filtered.length === 0}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            {copiedAll ? "Copied!" : "Copy all emails"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Onboarding</th>
                <th className="px-4 py-3 font-medium">Identities</th>
                <th className="px-4 py-3 font-medium">Email linked</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar user={u} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {u.displayName || u.handle || "—"}
                        </p>
                        <p className="truncate text-xs text-foreground-subtle">
                          {u.handle ? `@${u.handle}` : "no handle"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-foreground" title={u.email}>
                        {u.email}
                      </span>
                      <CopyEmailButton email={u.email} />
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(u.status)}</td>
                  <td className="px-4 py-3">
                    <span className="text-foreground-muted">
                      {u.onboardingStep === null ? "—" : `step ${u.onboardingStep}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-xs text-foreground-muted">
                      {u.identitiesCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{formatDate(u.emailLinkedAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-foreground-subtle">
                    No matches for &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
