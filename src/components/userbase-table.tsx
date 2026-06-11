"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { Search, Mail, Copy, Check, Pencil, Loader2, AtSign } from "lucide-react";
import { setUserbaseInstagram, type UserbaseEmailUser } from "@/app/actions/userbase";

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

/** Inline editor for a user's Instagram handle (userbase_identities). */
function InstagramCell({ user }: { user: UserbaseEmailUser }) {
  const [value, setValue] = useState(user.instagram ?? "");
  const [saved, setSaved] = useState(user.instagram ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setUserbaseInstagram(user.id, value);
      if (res.ok) {
        setSaved(res.instagram ?? "");
        setValue(res.instagram ?? "");
        setEditing(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        {saved ? (
          <a
            href={`https://instagram.com/${saved}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-foreground transition-colors hover:text-accent"
          >
            <AtSign className="h-3.5 w-3.5 text-foreground-faint" />
            @{saved}
          </a>
        ) : (
          <span className="text-foreground-faint">—</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit Instagram for ${user.handle ?? user.email}`}
          className="rounded p-1 text-foreground-faint transition-colors hover:bg-surface-elevated hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setValue(saved);
              setEditing(false);
              setError(null);
            }
          }}
          placeholder="@handle"
          className="w-32 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          aria-label="Save Instagram handle"
          className="rounded-md border border-accent-border bg-accent-bg px-2 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
      </div>
      {error && <p className="text-[10px] text-danger">{error}</p>}
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

export function UserbaseTable({
  users,
  subscribedEmails,
  subscriptionPartial,
}: {
  users: UserbaseEmailUser[];
  /** Lowercased emails subscribed on Paragraph; undefined = newsletter not configured (column hidden). */
  subscribedEmails?: string[];
  /** Paragraph's list API couldn't enumerate everyone — misses show "unknown", not "not subscribed". */
  subscriptionPartial?: boolean;
}) {
  const [query, setQuery] = useState("");
  const subscribedSet = useMemo(
    () => (subscribedEmails ? new Set(subscribedEmails) : null),
    [subscribedEmails],
  );

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
                <th className="px-4 py-3 font-medium">Instagram</th>
                {subscribedSet && <th className="px-4 py-3 font-medium">Newsletter</th>}
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
                  <td className="px-4 py-3 text-xs">
                    <InstagramCell user={u} />
                  </td>
                  {subscribedSet && (
                    <td className="px-4 py-3">
                      {subscribedSet.has(u.email.toLowerCase()) ? (
                        <span className="rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                          subscribed
                        </span>
                      ) : (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground-subtle">
                          {subscriptionPartial ? "unknown" : "not subscribed"}
                        </span>
                      )}
                    </td>
                  )}
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
