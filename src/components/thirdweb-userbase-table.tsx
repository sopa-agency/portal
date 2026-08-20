"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Wallet } from "lucide-react";
import type { ThirdwebUser } from "@/app/actions/userbase";

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Separate table for the thirdweb in-app-wallet userbase (gnars.com) — kept
 *  apart from the Supabase userbase until we decide on a merge/import. */
export function ThirdwebUserbaseTable({ users }: { users: ThirdwebUser[] }) {
  const emails = useMemo(
    () => users.map((u) => u.email).filter((e): e is string => !!e).join(", "),
    [users],
  );
  const [copied, setCopied] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wallet className="h-4 w-4 text-accent" />
            Thirdweb userbase (gnars.com in-app wallets)
          </h2>
          <p className="mt-0.5 text-xs text-foreground-subtle">
            {users.length} user{users.length === 1 ? "" : "s"} — separate from the main userbase
            for now; importable to Paragraph when ready.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(emails);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {}
          }}
          disabled={!emails}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy emails"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Wallet</th>
                <th className="px-4 py-3 font-medium">Login</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3 text-foreground">{u.email ?? <span className="italic text-foreground-faint">wallet-only</span>}</td>
                  <td className="px-4 py-3 text-foreground-muted">{u.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://basescan.org/address/${u.wallet}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {shortAddr(u.wallet)}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground-subtle">
                      {u.provider}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground-subtle">{formatDate(u.createdAt)}</td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm italic text-foreground-faint">
                    No thirdweb users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
