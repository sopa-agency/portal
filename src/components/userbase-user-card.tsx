"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteUserbaseUser,
  getFarcasterInfo,
  getHiveInfo,
  getUserbaseUserDetail,
  setUserbaseEmail,
  type FarcasterInfo,
  type HiveInfo,
  type UserbaseRow,
  type UserbaseUserDetail,
} from "@/app/actions/userbase";
import { useConfirm } from "@/components/confirm-dialog";

/* eslint-disable @next/next/no-img-element */

type TabId = "account" | "hive" | "farcaster";

type Loadable<T> = { state: "idle" } | { state: "loading" } | { state: "ready"; data: T } | { state: "error"; error: string };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-foreground-faint">{label}</p>
      <div className="truncate text-sm text-foreground">{value ?? <span className="text-foreground-faint">—</span>}</div>
    </div>
  );
}

const IDENTITY_LINK: Record<string, (i: { handle: string | null; address: string | null }) => string | null> = {
  hive: (i) => (i.handle ? `https://skatehive.app/@${i.handle}` : null),
  farcaster: (i) => (i.handle ? `https://farcaster.xyz/${i.handle}` : null),
  instagram: (i) => (i.handle ? `https://instagram.com/${i.handle}` : null),
  evm: (i) => (i.address ? `https://etherscan.io/address/${i.address}` : null),
};

export function UserbaseUserCard({
  user,
  canDelete = false,
  onDeleted,
  onClose,
}: {
  user: UserbaseRow;
  canDelete?: boolean;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("account");
  const [detail, setDetail] = useState<Loadable<UserbaseUserDetail>>({ state: "loading" });
  const [hive, setHive] = useState<Loadable<HiveInfo>>({ state: "idle" });
  const [farcaster, setFarcaster] = useState<Loadable<FarcasterInfo>>({ state: "idle" });
  const { confirm, confirmUI } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  async function handleDelete() {
    const label = user.handle || user.displayName || user.email || user.id;
    const ok = await confirm({
      title: "Deletar usuário?",
      message: `Remove permanentemente "${label}" da userbase (DB do app) — identidades, métodos de auth e o registro. Não dá pra desfazer. Use só pra contas de teste.`,
      confirmLabel: "Deletar permanentemente",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setDelErr(null);
    const r = await deleteUserbaseUser(user.id);
    setDeleting(false);
    if (r.ok) onDeleted?.(user.id);
    else setDelErr(r.error);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    getUserbaseUserDetail(user.id).then((res) => {
      if (cancelled) return;
      setDetail(res.ok ? { state: "ready", data: res.user } : { state: "error", error: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const identities = detail.state === "ready" ? detail.data.identities : [];
  const hiveIdentity = identities.find((i) => i.type === "hive" && i.handle);
  const fcIdentity = identities.find((i) => i.type === "farcaster" && (i.externalId || i.handle));

  function openTab(next: TabId) {
    setTab(next);
    // On-demand loads, cached for the dialog's lifetime.
    if (next === "hive" && hive.state === "idle" && hiveIdentity?.handle) {
      setHive({ state: "loading" });
      getHiveInfo(hiveIdentity.handle).then((res) =>
        setHive(res.ok ? { state: "ready", data: res.info } : { state: "error", error: res.error }),
      );
    }
    if (next === "farcaster" && farcaster.state === "idle" && fcIdentity?.externalId) {
      setFarcaster({ state: "loading" });
      getFarcasterInfo(fcIdentity.externalId).then((res) =>
        setFarcaster(res.ok ? { state: "ready", data: res.info } : { state: "error", error: res.error }),
      );
    }
  }

  const TABS: { id: TabId; label: string; disabled?: boolean }[] = [
    { id: "account", label: "Account" },
    { id: "hive", label: "Hive", disabled: detail.state === "ready" && !hiveIdentity },
    { id: "farcaster", label: "Farcaster", disabled: detail.state === "ready" && !fcIdentity },
  ];

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`User ${user.handle ?? user.email ?? user.id}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-surface-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="flex min-w-0 items-center gap-3">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-bg text-sm font-bold uppercase text-accent">
                {(user.handle || user.email || "??").slice(0, 2)}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-foreground">
                {user.displayName || user.handle || user.email}
              </h3>
              <p className="truncate text-xs text-foreground-subtle">
                {user.handle ? `@${user.handle} · ` : ""}
                {user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close user card"
            className="shrink-0 rounded-lg border border-border p-2 text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-5 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={t.disabled}
              onClick={() => openTab(t.id)}
              className={`rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === t.id
                  ? "border border-b-0 border-border bg-surface text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {t.label}
              {t.disabled && <span className="ml-1 text-[10px] text-foreground-faint">none</span>}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-5">
          {detail.state === "loading" && (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {detail.state === "error" && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {detail.error}
            </p>
          )}

          {detail.state === "ready" && tab === "account" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Field label="Status" value={detail.data.status} />
                <Field label="Onboarding" value={detail.data.onboardingStep != null ? `step ${detail.data.onboardingStep}` : null} />
                <Field label="Created" value={formatDate(detail.data.createdAt)} />
                <Field label="Updated" value={formatDate(detail.data.updatedAt)} />
                <Field label="Location" value={detail.data.location} />
                <Field label="User id" value={<span className="font-mono text-xs">{detail.data.id}</span>} />
              </div>
              {detail.data.bio && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-foreground-faint">Bio</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-muted">{detail.data.bio}</p>
                </div>
              )}
              <EmailsEditor
                userId={detail.data.id}
                emails={detail.data.emails}
                onChange={(emails) =>
                  setDetail((d) => (d.state === "ready" ? { state: "ready", data: { ...d.data, emails } } : d))
                }
              />
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-foreground-faint">
                  Identities ({detail.data.identities.length})
                </p>
                <div className="space-y-1.5">
                  {detail.data.identities.map((i, idx) => {
                    const href = IDENTITY_LINK[i.type]?.(i) ?? null;
                    const label = i.handle ?? i.address ?? i.externalId ?? "—";
                    return (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 rounded-full border border-border bg-surface-elevated px-2 py-0.5 text-center text-[10px] uppercase tracking-wider text-foreground-muted">
                          {i.type}
                        </span>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-xs text-foreground transition-colors hover:text-accent">
                            {label}
                          </a>
                        ) : (
                          <span className="truncate font-mono text-xs text-foreground">{label}</span>
                        )}
                        {i.isPrimary && <span className="text-[10px] text-accent">primary</span>}
                        {i.verifiedAt && <span className="text-[10px] text-foreground-faint">verified</span>}
                      </div>
                    );
                  })}
                  {detail.data.identities.length === 0 && (
                    <p className="text-sm text-foreground-faint">No identities linked.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "hive" && (
            <TabBody
              loadable={hive}
              render={(h) => (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">@{h.username}</p>
                    <a
                      href={`https://skatehive.app/@${h.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-foreground-muted transition-colors hover:text-accent"
                    >
                      skatehive.app <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Field label="Reputation" value={h.reputation != null ? h.reputation.toFixed(1) : null} />
                    <Field label="Posts" value={h.postCount} />
                    <Field label="Followers" value={h.followers} />
                    <Field label="Following" value={h.following} />
                    <Field label="Location" value={h.location} />
                    <Field label="Joined" value={formatDate(h.created)} />
                  </div>
                  {h.about && <p className="text-sm text-foreground-muted">{h.about}</p>}
                </div>
              )}
            />
          )}

          {tab === "farcaster" && (
            <TabBody
              loadable={farcaster}
              render={(f) => (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      {f.pfpUrl && <img src={f.pfpUrl} alt="" className="h-8 w-8 rounded-full border border-border object-cover" />}
                      <p className="truncate text-sm font-semibold text-foreground">
                        {f.displayName ?? `@${f.username}`}{" "}
                        <span className="font-normal text-foreground-subtle">@{f.username} · fid {f.fid}</span>
                      </p>
                    </div>
                    <a
                      href={`https://farcaster.xyz/${f.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex shrink-0 items-center gap-1 text-xs text-foreground-muted transition-colors hover:text-accent"
                    >
                      farcaster.xyz <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Followers" value={f.followers} />
                    <Field label="Following" value={f.following} />
                  </div>
                  {f.bio && <p className="text-sm text-foreground-muted">{f.bio}</p>}
                </div>
              )}
            />
          )}
        </div>

        {/* Danger zone — global admins only (e.g. removing test accounts) */}
        {canDelete && (
          <div className="flex items-center justify-between gap-3 border-t border-border p-4">
            {delErr ? (
              <p className="min-w-0 flex-1 truncate text-xs text-danger">{delErr}</p>
            ) : (
              <span className="text-[11px] text-foreground-faint">Admin: remover conta de teste</span>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Deletar usuário
            </button>
          </div>
        )}
      </div>
    </div>
    {confirmUI}
    </>
  );
}

type EmailRow = { id: string; email: string; linkedAt: string };

function EmailsEditor({
  userId,
  emails,
  onChange,
}: {
  userId: string;
  emails: EmailRow[];
  onChange: (emails: EmailRow[]) => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, confirmUI } = useConfirm();

  async function save(rowId: string | null) {
    const email = draft.trim();
    if (!email) return;
    setBusy(true);
    setErr(null);
    const r = await setUserbaseEmail({ userId, rowId, email });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    if (rowId) onChange(emails.map((e) => (e.id === rowId ? { ...e, email: r.email! } : e)));
    else if (r.id) onChange([{ id: r.id, email: r.email!, linkedAt: new Date().toISOString() }, ...emails]);
    setEditId(null);
    setAdding(false);
    setDraft("");
  }

  async function remove(row: EmailRow) {
    const ok = await confirm({
      title: "Remover email?",
      message: `Remove "${row.email}" do login deste usuário.`,
      confirmLabel: "Remover",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    const r = await setUserbaseEmail({ userId, rowId: row.id, email: "" });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onChange(emails.filter((e) => e.id !== row.id));
  }

  const inputCls =
    "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-border-strong";
  const iconBtn = "rounded-md p-1.5 text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50";

  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-wider text-foreground-faint">Emails ({emails.length})</p>
      <div className="space-y-1.5">
        {emails.map((e) =>
          editId === e.id ? (
            <div key={e.id} className="flex items-center gap-1.5">
              <input
                autoFocus
                type="email"
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                onKeyDown={(ev) => ev.key === "Enter" && save(e.id)}
                className={inputCls}
              />
              <button type="button" onClick={() => save(e.id)} disabled={busy} aria-label="Salvar" className={iconBtn}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-success" />}
              </button>
              <button type="button" onClick={() => { setEditId(null); setDraft(""); }} aria-label="Cancelar" className={iconBtn}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div key={e.id} className="group flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{e.email}</span>
              <span className="shrink-0 text-xs text-foreground-faint">linked {formatDate(e.linkedAt)}</span>
              <button type="button" onClick={() => { setEditId(e.id); setDraft(e.email); setAdding(false); }} aria-label="Editar email" className={iconBtn}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => remove(e)} disabled={busy} aria-label="Remover email" className={`${iconBtn} hover:text-danger`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ),
        )}

        {adding ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="email"
              placeholder="email@exemplo.com"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => ev.key === "Enter" && save(null)}
              className={inputCls}
            />
            <button type="button" onClick={() => save(null)} disabled={busy} aria-label="Adicionar" className={iconBtn}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-success" />}
            </button>
            <button type="button" onClick={() => { setAdding(false); setDraft(""); }} aria-label="Cancelar" className={iconBtn}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setAdding(true); setDraft(""); setEditId(null); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground-muted transition-colors hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar email
          </button>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
      {confirmUI}
    </div>
  );
}

function TabBody<T>({ loadable, render }: { loadable: Loadable<T>; render: (data: T) => React.ReactNode }) {
  if (loadable.state === "loading" || loadable.state === "idle") {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (loadable.state === "error") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" /> {loadable.error}
      </p>
    );
  }
  return <>{render(loadable.data)}</>;
}
