"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Search, Copy, Check, Pencil, Loader2, AtSign, ArrowUp, ArrowDown } from "lucide-react";
import {
  listUserbaseUsersPage,
  setUserbaseInstagram,
  type UserbaseRow,
  type UserbaseSort,
  type UserbaseSortField,
} from "@/app/actions/userbase";
import { UserbaseUserCard } from "@/components/userbase-user-card";

function SortableTh({
  field,
  sort,
  onSort,
  children,
}: {
  field: UserbaseSortField;
  sort: UserbaseSort;
  onSort: (field: UserbaseSortField) => void;
  children: React.ReactNode;
}) {
  const active = sort.field === field;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
        className={`group inline-flex items-center gap-1 uppercase tracking-wider transition-colors ${
          active ? "text-accent" : "hover:text-foreground"
        }`}
      >
        {children}
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUp className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-40" />
        )}
      </button>
    </th>
  );
}

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

function Avatar({ user }: { user: UserbaseRow }) {
  const initials = (user.handle || user.displayName || user.email || "??").slice(0, 2).toUpperCase();
  if (user.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt={user.handle ?? user.email ?? "user"}
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
function InstagramCell({ user }: { user: UserbaseRow }) {
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
          aria-label={`Edit Instagram for ${user.handle ?? user.email ?? user.id}`}
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
  initialUsers,
  initialCursor,
  initialTotal,
  subscribedEmails,
  subscriptionPartial,
}: {
  initialUsers: UserbaseRow[];
  initialCursor: string | null;
  initialTotal: number;
  /** Lowercased emails subscribed on Paragraph; undefined = newsletter not configured (column hidden). */
  subscribedEmails?: string[];
  /** Paragraph's list API couldn't enumerate everyone — misses show "unknown", not "not subscribed". */
  subscriptionPartial?: boolean;
}) {
  const [users, setUsers] = useState<UserbaseRow[]>(initialUsers);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UserbaseSort>({ field: "created", dir: "desc" });
  const [busy, setBusy] = useState(false);
  const [cardUser, setCardUser] = useState<UserbaseRow | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Monotonic id discards stale responses when search/scroll race.
  const reqRef = useRef(0);

  // Text columns start ascending; date/count columns start with the big stuff.
  const DESC_FIRST: ReadonlySet<UserbaseSortField> = useMemo(
    () => new Set<UserbaseSortField>(["created", "emailLinked", "identities", "onboarding"]),
    [],
  );
  const toggleSort = (field: UserbaseSortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: DESC_FIRST.has(field) ? "desc" : "asc" },
    );
  };

  const subscribedSet = useMemo(
    () => (subscribedEmails ? new Set(subscribedEmails) : null),
    [subscribedEmails],
  );

  // Debounced server-side search/sort — resets the list from page one.
  useEffect(() => {
    const req = ++reqRef.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const res = await listUserbaseUsersPage({ search: query.trim() || undefined, sort });
      if (reqRef.current !== req) return; // superseded
      if (res.ok) {
        setUsers(res.users);
        setCursor(res.nextCursor);
        setTotal(res.total);
      }
      setBusy(false);
    }, query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort]);

  const loadMore = useCallback(async () => {
    if (!cursor || busy) return;
    const req = ++reqRef.current;
    setBusy(true);
    const res = await listUserbaseUsersPage({ cursor, search: query.trim() || undefined, sort });
    if (reqRef.current !== req) return;
    if (res.ok) {
      setUsers((prev) => {
        const seen = new Set(prev.map((u) => u.id));
        return [...prev, ...res.users.filter((u) => !seen.has(u.id))];
      });
      setCursor(res.nextCursor);
      setTotal(res.total);
    } else {
      setCursor(null); // stop hammering on errors
    }
    setBusy(false);
  }, [cursor, busy, query, sort]);

  // Infinite scroll — one IntersectionObserver on a bottom sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px" }, // prefetch well before the edge
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const filtered = users;
  const allEmails = useMemo(
    () => filtered.map((u) => u.email).filter((e): e is string => !!e).join(", "),
    [filtered],
  );
  const [copiedAll, setCopiedAll] = useState(false);

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
            {users.length} of {total} loaded
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
            {copiedAll ? "Copied!" : "Copy loaded emails"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr>
                <SortableTh field="user" sort={sort} onSort={toggleSort}>User</SortableTh>
                <SortableTh field="email" sort={sort} onSort={toggleSort}>Email</SortableTh>
                <SortableTh field="instagram" sort={sort} onSort={toggleSort}>Instagram</SortableTh>
                {subscribedSet && <th className="px-4 py-3 font-medium">Newsletter</th>}
                <SortableTh field="status" sort={sort} onSort={toggleSort}>Status</SortableTh>
                <SortableTh field="onboarding" sort={sort} onSort={toggleSort}>Onboarding</SortableTh>
                <SortableTh field="identities" sort={sort} onSort={toggleSort}>Identities</SortableTh>
                <SortableTh field="emailLinked" sort={sort} onSort={toggleSort}>Email linked</SortableTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setCardUser(u)}
                      aria-label={`Open card for ${u.handle ?? u.email}`}
                      className="flex min-w-0 items-center gap-3 rounded-lg text-left transition-opacity hover:opacity-80"
                    >
                      <Avatar user={u} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {u.displayName || u.handle || "—"}
                        </p>
                        <p className="truncate text-xs text-foreground-subtle">
                          {u.handle ? `@${u.handle}` : "no handle"}
                        </p>
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {u.email ? (
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-foreground" title={u.email}>
                          {u.email}
                        </span>
                        <CopyEmailButton email={u.email} />
                      </div>
                    ) : (
                      <span className="text-foreground-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <InstagramCell user={u} />
                  </td>
                  {subscribedSet && (
                    <td className="px-4 py-3">
                      {!u.email ? (
                        <span className="text-foreground-faint">—</span>
                      ) : subscribedSet.has(u.email.toLowerCase()) ? (
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
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-foreground-subtle">
                    No matches for &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Infinite-scroll sentinel + tail state */}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {busy && (
        <p className="flex items-center justify-center gap-2 py-2 text-xs text-foreground-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {!busy && !cursor && users.length > 0 && users.length >= total && (
        <p className="py-2 text-center text-[11px] text-foreground-faint">
          All {total} users loaded.
        </p>
      )}

      {cardUser && <UserbaseUserCard user={cardUser} onClose={() => setCardUser(null)} />}
    </div>
  );
}
