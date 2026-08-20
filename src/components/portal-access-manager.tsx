"use client";

import { useState } from "react";
import { Loader2, Trash2, ChevronDown, UserPlus } from "lucide-react";
import {
  listAllPortalAccess,
  setPortalAccess,
  removePortalAccess,
  type PortalAccess,
} from "@/app/actions/team-admin";

type Role = PortalAccess["members"][number]["role"];
const ROLE_OPTS: Role[] = ["admin", "member", "viewer"];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Membro", viewer: "Viewer" };

export function PortalAccessManager({ initial }: { initial: PortalAccess[] }) {
  const [portals, setPortals] = useState<PortalAccess[]>(initial);
  const [open, setOpen] = useState<string | null>(initial[0]?.slug ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adds, setAdds] = useState<Record<string, string>>({});

  async function refresh() {
    const r = await listAllPortalAccess();
    if (r.ok) setPortals(r.portals);
  }
  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setErr(null);
    const r = await fn();
    if (!r.ok) setErr(r.error ?? "Falhou.");
    else await refresh();
    setBusy(null);
  }

  return (
    <section aria-labelledby="portal-access-heading" className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 id="portal-access-heading" className="text-lg font-semibold tracking-tight text-foreground">
          Acesso por portal
        </h2>
        <span className="text-xs text-foreground-faint">quem entra em quais portais (admin global)</span>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}

      <div className="space-y-2">
        {portals.map((p) => {
          const isOpen = open === p.slug;
          return (
            <div key={p.slug} className="overflow-hidden rounded-xl border border-border bg-surface">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : p.slug)}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-elevated"
              >
                <span className="text-sm font-semibold text-foreground">{p.name}</span>
                <span className="flex items-center gap-2 text-xs text-foreground-faint">
                  {p.members.length} {p.members.length === 1 ? "membro" : "membros"}
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </span>
              </button>

              {isOpen && (
                <div className="space-y-1.5 border-t border-border p-3">
                  {p.members.map((m) => (
                    <div key={m.username} className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`https://images.hive.blog/u/${m.username}/avatar`} alt="" className="h-6 w-6 shrink-0 rounded-full border border-border object-cover" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">@{m.username}</span>
                      {m.global && (
                        <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">global</span>
                      )}
                      <select
                        value={m.global ? "admin" : m.role}
                        disabled={m.global || busy === `r:${p.slug}:${m.username}`}
                        onChange={(e) => run(`r:${p.slug}:${m.username}`, () => setPortalAccess(p.slug, m.username, e.target.value as Role))}
                        className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground disabled:opacity-50"
                      >
                        {ROLE_OPTS.map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                      {!m.global && (
                        <button
                          type="button"
                          title="Revogar acesso a este portal"
                          disabled={busy === `rm:${p.slug}:${m.username}`}
                          onClick={() => run(`rm:${p.slug}:${m.username}`, () => removePortalAccess(p.slug, m.username))}
                          className="rounded-md p-1.5 text-foreground-faint hover:bg-foreground/5 hover:text-danger disabled:opacity-50"
                        >
                          {busy === `rm:${p.slug}:${m.username}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1.5">
                    <UserPlus className="h-3.5 w-3.5 text-foreground-subtle" />
                    <input
                      value={adds[p.slug] ?? ""}
                      onChange={(e) => setAdds((a) => ({ ...a, [p.slug]: e.target.value }))}
                      placeholder="dar acesso a usuário Hive…"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground focus:border-border-strong focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!(adds[p.slug] ?? "").trim() || busy === `add:${p.slug}`}
                      onClick={() =>
                        run(`add:${p.slug}`, async () => {
                          const r = await setPortalAccess(p.slug, adds[p.slug] ?? "", "member");
                          if (r.ok) setAdds((a) => ({ ...a, [p.slug]: "" }));
                          return r;
                        })
                      }
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === `add:${p.slug}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Dar acesso"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
