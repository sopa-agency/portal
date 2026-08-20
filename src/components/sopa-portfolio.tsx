"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, X, Trash2, Loader2, ImagePlus, UserPlus, Rocket } from "lucide-react";
import { toast } from "sonner";
import {
  type BoardCard,
  type TeamMember,
  createCard,
  updateCard,
  deleteCard,
} from "@/app/actions/sopa-boards";
import { publishSite } from "@/app/actions/sopa-site";
import { Toaster } from "@/components/studio/ui/sonner";
import type { Person } from "@/components/sopa-org-chart";
import { uploadSopaLogo } from "@/lib/sopa-logo-upload";

export function SopaPortfolio({
  initial,
  roster,
  canPublish = false,
}: {
  initial: BoardCard[];
  roster: Person[];
  canPublish?: boolean;
}) {
  const [cards, setCards] = useState<BoardCard[]>(initial);
  const [editing, setEditing] = useState<BoardCard | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [publishing, startPublish] = useTransition();
  const rosterMap = useMemo(() => new Map(roster.map((p) => [p.username.toLowerCase(), p])), [roster]);

  function handlePublish() {
    startPublish(async () => {
      const res = await publishSite();
      if (res.ok) toast.success("Deploy do site acionado.");
      else toast.error(res.error);
    });
  }

  function handleSave(
    id: string | null,
    title: string,
    body: string,
    logoUrl: string | null,
    team: TeamMember[],
  ) {
    startTransition(async () => {
      if (id) {
        const updated = await updateCard(id, { title, body, logoUrl, team });
        setCards((prev) => prev.map((c) => (c.id === id ? updated : c)));
      } else {
        const created = await createCard({
          board: "portfolio",
          title,
          body,
          logoUrl: logoUrl ?? undefined,
          team,
        });
        setCards((prev) => [...prev, created]);
      }
      setEditing(null);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCard(id);
      setCards((prev) => prev.filter((c) => c.id !== id));
      setEditing(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">SOPA</p>
          <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
        </div>
        <div className="flex items-center gap-3">
          {pending && (
            <span className="flex items-center gap-1.5 text-xs text-foreground-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> salvando…
            </span>
          )}
          {canPublish && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm font-semibold text-foreground hover:border-border-strong disabled:opacity-50"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              publicar site →
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo card
          </button>
        </div>
      </div>
      <Toaster />

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-foreground-muted">Nenhum card ainda. Crie o primeiro com “Novo card”.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="flex flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition hover:border-border-strong"
            >
              {c.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logoUrl}
                  alt=""
                  className="mb-3 h-12 w-12 rounded-lg border border-border bg-surface-elevated object-contain p-1"
                />
              )}
              <span className="text-base font-semibold text-foreground">{c.title}</span>
              {c.body && (
                <span className="mt-2 line-clamp-4 text-sm leading-relaxed text-foreground-muted">{c.body}</span>
              )}
              <MemberAvatars team={c.team} rosterMap={rosterMap} />
            </button>
          ))}
        </div>
      )}

      {editing && (
        <PortfolioDialog
          card={editing === "new" ? null : editing}
          roster={roster}
          rosterMap={rosterMap}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
          busy={pending}
        />
      )}
    </div>
  );
}

/** Member avatars (one per person, roles in tooltip) — same language as the org-chart. */
function MemberAvatars({ team, rosterMap }: { team: TeamMember[]; rosterMap: Map<string, Person> }) {
  if (team.length === 0) return null;
  const byUser = new Map<string, string[]>();
  for (const m of team) {
    const key = m.username.toLowerCase();
    byUser.set(key, [...(byUser.get(key) ?? []), m.role].filter(Boolean));
  }
  return (
    <div className="mt-3 flex items-center -space-x-1.5 border-t border-border pt-3">
      {[...byUser.entries()].map(([key, roles]) => {
        const person = rosterMap.get(key);
        const username = person?.username ?? key;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            src={person?.avatarUrl ?? `https://images.hive.blog/u/${username}/avatar`}
            alt={username}
            title={roles.length ? `${roles.join(", ")}: @${username}` : `@${username}`}
            className="h-6 w-6 rounded-full border-2 border-surface object-cover"
          />
        );
      })}
    </div>
  );
}

function PortfolioDialog({
  card,
  roster,
  rosterMap,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  card: BoardCard | null;
  roster: Person[];
  rosterMap: Map<string, Person>;
  onClose: () => void;
  onSave: (id: string | null, title: string, body: string, logoUrl: string | null, team: TeamMember[]) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [body, setBody] = useState(card?.body ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(card?.logoUrl ?? null);
  const [team, setTeam] = useState<TeamMember[]>(card?.team ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const canSave = title.trim().length > 0;

  const onTeam = new Set(team.map((m) => m.username.toLowerCase()));
  const available = roster.filter((p) => !onTeam.has(p.username.toLowerCase()));

  function addMember(username: string) {
    setTeam((prev) => [...prev, { username, role: "" }]);
    setPickOpen(false);
  }
  function setRole(username: string, role: string) {
    setTeam((prev) => prev.map((m) => (m.username === username ? { ...m, role } : m)));
  }
  function removeMember(username: string) {
    setTeam((prev) => prev.filter((m) => m.username !== username));
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadErr(null);
    setUploading(true);
    const res = await uploadSopaLogo(file);
    setUploading(false);
    if (res.ok) setLogoUrl(res.url);
    else setUploadErr(res.error);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{card ? "Editar card" : "Novo card"}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-foreground-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Logo</label>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-elevated">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <ImagePlus className="h-5 w-5 text-foreground-faint" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
            <button
              type="button"
              disabled={uploading || busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-strong disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {logoUrl ? "Trocar logo" : "Enviar logo"}
            </button>
            {logoUrl && (
              <button type="button" onClick={() => setLogoUrl(null)} className="w-fit text-[11px] text-foreground-muted hover:text-danger">
                Remover
              </button>
            )}
          </div>
        </div>
        {uploadErr && <p className="mb-3 text-xs text-danger">{uploadErr}</p>}

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Título</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        <label className="mb-1 block text-xs font-medium text-foreground-muted">Detalhes</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="Descrição, resultado, links…"
          className="mb-4 w-full resize-none rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-border-strong focus:outline-none"
        />

        {/* Members — who's working on this process */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-foreground-muted">Membros</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickOpen((o) => !o)}
                disabled={available.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:border-border-strong hover:text-foreground disabled:opacity-40"
              >
                <UserPlus className="h-3 w-3" /> Adicionar
              </button>
              {pickOpen && available.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPickOpen(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-xl border border-border bg-surface-elevated py-1 shadow-xl">
                    {available.map((p) => (
                      <button
                        key={p.username}
                        type="button"
                        onClick={() => addMember(p.username)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground-muted hover:bg-surface hover:text-foreground"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                        @{p.username}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          {team.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-foreground-faint">
              Ninguém atribuído. Adicione quem está trabalhando neste processo.
            </p>
          ) : (
            <div className="space-y-1.5">
              {team.map((m) => {
                const person = rosterMap.get(m.username.toLowerCase());
                return (
                  <div key={m.username} className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-2 py-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={person?.avatarUrl ?? `https://images.hive.blog/u/${m.username}/avatar`}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full object-cover"
                    />
                    <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">@{m.username}</span>
                    <input
                      value={m.role}
                      onChange={(e) => setRole(m.username, e.target.value)}
                      placeholder="função (opcional)"
                      className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeMember(m.username)}
                      aria-label={`Remover @${m.username}`}
                      className="shrink-0 text-foreground-faint hover:text-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          {card ? (
            confirmDel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(card.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Confirmar exclusão
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-foreground-muted hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </button>
            )
          ) : (
            <span />
          )}

          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => onSave(card?.id ?? null, title, body, logoUrl, team)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
