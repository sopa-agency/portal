"use client";

import { useState } from "react";
import { Loader2, Trash2, Shield, ShieldOff, UserPlus } from "lucide-react";
import {
  listTeamMembers,
  setMemberRole,
  removeMember,
  setGlobalAdmin,
  type ManagedMember,
} from "@/app/actions/team-admin";

type Role = ManagedMember["role"];
const ROLE_OPTS: Role[] = ["admin", "member", "viewer"];
const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Membro", viewer: "Viewer" };

function relativeSince(iso: string | null): string {
  if (!iso) return "nunca entrou";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function TeamAdmin({
  initial,
  viewerGlobal,
  projectName,
}: {
  initial: ManagedMember[];
  viewerGlobal: boolean;
  projectName: string;
}) {
  const [members, setMembers] = useState<ManagedMember[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<Role>("member");

  async function refresh() {
    const r = await listTeamMembers();
    if (r.ok) setMembers(r.members);
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
    <section aria-labelledby="team-admin-heading" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 id="team-admin-heading" className="text-lg font-semibold tracking-tight text-foreground">
          Equipe &amp; cargos
        </h2>
        <span className="text-xs text-foreground-faint">{projectName}</span>
      </div>

      {err && <p className="text-xs text-danger">{err}</p>}

      {/* Add member */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
        <UserPlus className="h-4 w-4 text-foreground-subtle" />
        <input
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          placeholder="usuário Hive (ex: skatedev)"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as Role)}
          className="rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-foreground"
        >
          {ROLE_OPTS.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!newUser.trim() || busy === "add"}
          onClick={() =>
            run("add", async () => {
              const r = await setMemberRole(newUser, newRole);
              if (r.ok) setNewUser("");
              return r;
            })
          }
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Adicionar
        </button>
      </div>

      {/* Member list */}
      <div className="space-y-1.5">
        {members.map((m) => (
          <div key={m.username} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://images.hive.blog/u/${m.username}/avatar`} alt="" className="h-7 w-7 shrink-0 rounded-full border border-border object-cover" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">@{m.username}</span>
              <span className="text-[10px] text-foreground-faint">visto {relativeSince(m.lastLoginAt)}</span>
            </span>
            {m.global && (
              <span className="rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                Admin global
              </span>
            )}
            <select
              value={m.global ? "admin" : m.role}
              disabled={m.global || busy === `role:${m.username}`}
              onChange={(e) => run(`role:${m.username}`, () => setMemberRole(m.username, e.target.value as Role))}
              className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground disabled:opacity-50"
              title={m.global ? "Admin global — cargo fixo em todos os portais" : "Cargo neste portal"}
            >
              {ROLE_OPTS.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            {viewerGlobal && (
              <button
                type="button"
                title={m.global ? "Remover admin global" : "Tornar admin global"}
                disabled={busy === `g:${m.username}`}
                onClick={() => run(`g:${m.username}`, () => setGlobalAdmin(m.username, !m.global))}
                className={`rounded-md p-1.5 ${m.global ? "text-accent hover:bg-accent/10" : "text-foreground-faint hover:bg-foreground/5 hover:text-foreground"} disabled:opacity-50`}
              >
                {m.global ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
              </button>
            )}
            {!m.global && (
              <button
                type="button"
                title="Remover do portal"
                disabled={busy === `rm:${m.username}`}
                onClick={() => run(`rm:${m.username}`, () => removeMember(m.username))}
                className="rounded-md p-1.5 text-foreground-faint hover:bg-foreground/5 hover:text-danger disabled:opacity-50"
              >
                {busy === `rm:${m.username}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-foreground-faint">
        Admin gerencia equipe e settings · Membro usa as features · Viewer só leitura. Admins globais acessam todos os portais.
      </p>
    </section>
  );
}
