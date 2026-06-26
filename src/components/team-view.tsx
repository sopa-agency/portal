"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Bot,
  Mail,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Info,
  ExternalLink,
  X,
  Send,
  Loader2,
  Globe,
  Lock,
  Pencil,
  Check,
  Plus,
  Phone,
  ListChecks,
  Star,
  Trash2,
} from "lucide-react";
import { SocialBrandIcon } from "@/components/social-brand-icon";
import { ConnectionSetupDialog } from "@/components/connection-setup-dialog";
import { DiscordChannelPicker } from "@/components/discord-channel-picker";
import { useRouter } from "next/navigation";
import type { TeamContact } from "@/projects/types";
import type { PortalConnection, ConnectionStatus } from "@/lib/portal-connections";
import type { TeamMessageOption } from "@/lib/team-messaging";
import { resolveDiscordUser, sendTeamMessage, sendTeamTasksEmail, updateTeamMemberContact } from "@/app/actions/team";
import { FirePriority, DeadlineChip } from "@/components/card-indicators";
import { setMemberRole, removeMember, getMemberTasks, getMemberSkills, setMemberSkills, type MemberTask } from "@/app/actions/team-admin";
import { SkillRadar } from "@/components/skill-radar";
import { SKILL_CATEGORIES, describeContribution } from "@/lib/skills";
import { CardDialogHost } from "@/components/card-dialog-host";
import type { AggregatedItem } from "@/lib/github-project";
import { CONTACT_PLATFORMS, type ContactPlatform } from "@/lib/contact-platforms";
import { priorityRank } from "@/lib/kanban-priority";
import { useUrlTab } from "@/lib/use-url-tab";

// ── Types ──────────────────────────────────────────────────────────────────

type Role = "admin" | "member" | "viewer";

export type TeamMember = {
  username: string;
  avatarUrl: string;
  profileUrl: string;
  contacts: TeamContact[];
  messageOptions: TeamMessageOption[];
  /** Cross-portal admin (GLOBAL_ALLOWLIST) — has access to every portal. */
  global?: boolean;
  /** Portals this member can access (allowlist membership + global). */
  portals?: { slug: string; name: string }[];
  /** Effective role on this portal. */
  role?: Role;
  /** Last login (ISO) or null. */
  lastLoginAt?: string | null;
};

type TeamViewProps = {
  projectName: string;
  members: TeamMember[];
  /** Viewer is an admin of this portal → can change roles / remove from the dialog. */
  canManage?: boolean;
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", member: "Membro", viewer: "Viewer" };
const ROLE_BADGE: Record<Role, string> = {
  admin: "border-accent-border bg-accent-bg text-accent",
  member: "border-border bg-foreground/5 text-foreground-muted",
  viewer: "border-border bg-foreground/5 text-foreground-faint",
};

function relativeSince(iso: string | null | undefined): string {
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

type ConnectionsViewProps = {
  projectName: string;
  connections: PortalConnection[];
  /** Project env prefix (e.g. "KEEPKEY") — interpolated into setup tutorials. */
  envPrefix: string;
  /** GitHub repos the AI reads for context ("owner/name"). */
  repos?: string[];
  /** GitHub Project (Projects V2) powering the Kanban. */
  githubProject?: { org: string; number: number };
  /** Neynar SIWN client id (public) — enables the "Conectar Farcaster" button. */
  farcasterClientId?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────

// Real brand marks where the service has one (SocialBrandIcon); neutral
// lucide glyphs for the generic rows (email, website, agent…).
function networkIcon(network: string) {
  const name = network.toLowerCase();
  const SZ = "h-4 w-4 shrink-0";
  if (name.includes("instagram")) return <SocialBrandIcon platform="instagram" className={SZ} />;
  if (name.includes("facebook")) return <SocialBrandIcon platform="facebook" className={SZ} />;
  if (name.includes("hive")) return <SocialBrandIcon platform="hive" className={SZ} />;
  if (name.includes("farcaster")) return <SocialBrandIcon platform="farcaster" className={SZ} />;
  if (name.includes("discord")) return <SocialBrandIcon platform="discord" className={SZ} />;
  if (name.includes("binance")) return <SocialBrandIcon platform="binance" className={SZ} />;
  if (name.includes("paragraph")) return <SocialBrandIcon platform="paragraph" className={SZ} />;
  if (name.includes("github")) return <SocialBrandIcon platform="github" className={SZ} />;
  if (name.includes("drive")) return <SocialBrandIcon platform="drive" className={SZ} />;
  if (name.includes("supabase") || name.includes("userbase")) return <SocialBrandIcon platform="supabase" className={SZ} />;
  if (name.includes("pinata")) return <SocialBrandIcon platform="pinata" className={SZ} />;
  if (name.includes("analytics")) return <SocialBrandIcon platform="analytics" className={SZ} />;
  if (name.includes("telegram")) return <SocialBrandIcon platform="telegram" className={SZ} />;
  if (name.includes("x") || name.includes("twitter")) return <SocialBrandIcon platform="x" className={SZ} />;
  if (name.includes("email") || name.includes("smtp")) return <Mail className={SZ} aria-hidden />;
  if (name.includes("whatsapp")) return <Phone className={`${SZ} text-[#25D366]`} aria-hidden />;
  if (name.includes("website")) return <Globe className={SZ} aria-hidden />;
  if (name.includes("agent")) return <Bot className={`${SZ} text-accent`} aria-hidden />;
  return <Info className={SZ} aria-hidden />;
}

type BadgeConfig = {
  label: string;
  className: string;
  icon: React.ReactNode;
};

function statusBadge(status: ConnectionStatus): BadgeConfig {
  switch (status) {
    case "connected":
      return {
        label: "Connected",
        className: "text-success bg-success/10 border border-success/20",
        icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
      };
    case "warning":
      return {
        label: "Check",
        className: "text-warning bg-warning/10 border border-warning/20",
        icon: <AlertTriangle className="h-3 w-3" aria-hidden />,
      };
    case "manual":
      return {
        label: "Manual",
        className: "text-foreground-muted bg-foreground/5 border border-border",
        icon: <Info className="h-3 w-3" aria-hidden />,
      };
    case "missing":
      return {
        label: "Not set",
        className: "text-danger bg-danger/10 border border-danger/20",
        icon: <XCircle className="h-3 w-3" aria-hidden />,
      };
    case "na":
      return {
        label: "—",
        className: "text-foreground-faint bg-foreground/5 border border-border",
        icon: <MinusCircle className="h-3 w-3" aria-hidden />,
      };
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

/**
 * Resolves a Discord user ID to avatar + username via the project's bot —
 * best-effort: while loading / on failure only the raw ID shows.
 */
function DiscordUserChip({ userId }: { userId: string }) {
  const [resolved, setResolved] = useState<{ username: string; displayName: string | null; avatarUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!/^\d{17,20}$/.test(userId.trim())) return;
    resolveDiscordUser(userId).then((r) => {
      if (!cancelled && r.ok) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!resolved) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved.avatarUrl}
        alt=""
        width={18}
        height={18}
        className="h-[18px] w-[18px] shrink-0 rounded-full border border-border object-cover"
      />
      <span className="truncate text-foreground">@{resolved.username}</span>
      {resolved.displayName && (
        <span className="truncate text-foreground-faint">({resolved.displayName})</span>
      )}
    </span>
  );
}

/** Strip "@", profile URLs, and trailing path from a stored GitHub contact value. */
function githubLoginOf(member: TeamMember): string | null {
  const value = member.contacts.find((c) => c.label === "GitHub")?.value;
  if (!value) return null;
  const login = value
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .trim();
  return login || null;
}

/** GitHub avatar — predictable from the login, no API call needed. */
function githubAvatarUrl(login: string, size = 64): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}

function MemberCard({ member, onOpen }: { member: TeamMember; onOpen: (member: TeamMember) => void }) {
  const ghLogin = githubLoginOf(member);
  return (
    <button
      type="button"
      onClick={() => onOpen(member)}
      aria-label={`Open @${member.username} contact card`}
      className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
    >
      <span className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={member.avatarUrl}
          alt={`@${member.username}`}
          width={56}
          height={56}
          className="h-14 w-14 rounded-full border border-border object-cover"
          onError={(e) => {
            // Fallback: hide the img and let the initials div show via CSS
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {ghLogin && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={githubAvatarUrl(ghLogin)}
            alt={`GitHub: ${ghLogin}`}
            title={`GitHub: @${ghLogin}`}
            width={22}
            height={22}
            className="absolute -bottom-0.5 -right-0.5 h-[22px] w-[22px] rounded-full border-2 border-surface object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
      </span>
      <span className="flex items-center gap-1 text-center text-xs font-medium text-foreground-muted group-hover:text-foreground tabular-nums">
        @{member.username}
        {member.global ? (
          <span title="Admin global — acessa todos os portais" className="rounded-full bg-accent-bg px-1 text-[8px] font-bold uppercase text-accent">G</span>
        ) : member.role === "admin" ? (
          <span title="Admin do portal" className="rounded-full bg-accent-bg px-1 text-[8px] font-bold uppercase text-accent">A</span>
        ) : member.role === "viewer" ? (
          <span title="Viewer (só leitura)" className="rounded-full bg-foreground/10 px-1 text-[8px] font-bold uppercase text-foreground-faint">V</span>
        ) : null}
      </span>
    </button>
  );
}

const CHANNEL_LABEL: Record<TeamMessageOption["channel"], string> = {
  hive: "Hive",
  farcaster: "Farcaster",
  discord: "Discord",
  email: "Email",
};

function deliveryHint(option: TeamMessageOption, username: string): string {
  switch (option.channel) {
    case "hive":
      return `Public snap on Hive mentioning @${username}.`;
    case "farcaster":
      return `Public cast mentioning ${option.target}.`;
    case "discord":
      return "Public message in the project's Discord channel.";
    case "email":
      return `Private email to ${option.target}.`;
  }
}

/** Plain-text email body (no AI) listing a member's open Kanban tasks, priority-first. */
function buildTasksEmailDraft(username: string, tasks: MemberTask[]): string {
  // Link each task to its shareable Kanban card (opens the card dialog in the
  // portal via ?open=<item id>); fall back to the GitHub URL if there's no origin.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const open = tasks
    .filter((t) => !/done|closed/i.test(t.status) && t.state !== "CLOSED")
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  if (open.length === 0) return `Oi @${username}, você não tem tarefas abertas no Kanban no momento. 🎉`;
  const lines = open.map((t, i) => {
    const tags = [t.board, t.priority].filter(Boolean).join(" · ");
    const head = `${i + 1}. ${tags ? `[${tags}] ` : ""}${t.title} — ${t.status}`;
    const link = origin ? `${origin}/kanban?open=${encodeURIComponent(t.id)}` : t.url;
    return link ? `${head}\n   ${link}` : head;
  });
  return `Oi @${username}, aqui estão suas tarefas no Kanban (${open.length}):\n\n${lines.join("\n")}`;
}

// Motivational openers seeded into the tasks-email note — irreverent, skate-ish
// tone, but always nudging the person to actually go do the cards. A fresh one
// is picked every time you draft (see pickIntro), so the email never reads canned.
const DRAFT_INTROS = [
  "Separei o que importa pra essa semana — bora fazer acontecer! 🚀",
  "Olha o rolê: essas aqui são as suas. Manda ver antes que o café esfrie. ☕",
  "Lista feita, desculpa nenhuma aceita. Bora destruir esses cards! 🛹",
  "Teu futuro eu tô vendo daqui e ele tá maneiro — só falta fechar essas. 😎",
  "Menos scroll, mais flow. Cola nessas tarefas que o time precisa de ti. 🤙",
  "Avisa o universo que hoje é dia de fechar card. Partiu! ⚡",
  "Essas tarefas não vão se fazer sozinhas (já tentei, não rola). 😅",
  "Se liga: cada card fechado é um trick a mais no teu combo. 🛹",
  "Faz essas e some pra skatar com a consciência limpa. 🌊",
  "Pequeno empurrão motivacional: VAI LÁ E ARREBENTA. 🔥",
  "Confia: depois de fechar essas você vai se sentir um lord. 👑",
  "Modo produtivo ativado. Essas são as tuas missões do dia. 🎯",
  "O time tá contando contigo — e eu também, sem pressão (muita pressão). 😬",
  "Bora transformar esse backlog em 'done' e flexar no próximo stand-up. 💪",
  "Café na mão, fone no ouvido, e essas tarefas no chão. Partiu! 🎧",
  "Spoiler: você consegue. Agora prova fechando essas. ✅",
  "Menos 'amanhã eu faço', mais 'já tá feito'. Cola! 🏁",
  "Essas são as tuas joias da coroa da semana. Lapida elas. 💎",
  "Hoje a meta é simples: fazer o difícil parecer fácil. Bora! 🤘",
  "Tamo junto: eu mando a lista, você manda o show. 🎬",
  "Sem mimimi — pega essas e mostra quem manda no Kanban. 🧠",
];

/** Random opener, never repeating the one currently in the box. */
function pickIntro(exclude: string): string {
  const pool = DRAFT_INTROS.filter((p) => p !== exclude);
  const list = pool.length ? pool : DRAFT_INTROS;
  return list[Math.floor(Math.random() * list.length)];
}

function MessageComposer({ member, tasks, selectedIds, importantId }: { member: TeamMember; tasks: MemberTask[] | null; selectedIds: Set<string>; importantId: string | null }) {
  // Default to a private channel when the member has one.
  const [selected, setSelected] = useState<TeamMessageOption | null>(
    member.messageOptions.find((o) => o.visibility === "private") ??
      member.messageOptions[0] ??
      null,
  );
  const [message, setMessage] = useState("");
  // The last auto-seeded opener, so re-drafting can swap it for a fresh one
  // WITHOUT clobbering a note the user actually typed.
  const seededRef = useRef("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  const openTasks = (tasks ?? []).filter((t) => !/done|closed/i.test(t.status) && t.state !== "CLOSED");

  const emailOpt = member.messageOptions.find((o) => o.channel === "email");
  // True when Send will deliver the rich HTML tasks digest (email + ≥1 task).
  const chosenForEmail = selectedIds.size > 0 ? openTasks.filter((t) => selectedIds.has(t.id)) : openTasks;
  const isTasksEmail = selected?.channel === "email" && chosenForEmail.length > 0;

  // Prepare the tasks email: switch to the email channel and seed an editable
  // personal note. The tasks themselves render server-side as a branded card
  // grid (with the ⭐ hero), so the textarea is just the note — no text dump.
  // If the member has no email channel, fall back to the plain-text digest.
  function draftTasks() {
    setResult(null);
    const chosen = selectedIds.size > 0 ? openTasks.filter((t) => selectedIds.has(t.id)) : openTasks;
    if (chosen.length === 0) {
      setResult({ ok: false, text: "Sem tarefas abertas pra rascunhar." });
      return;
    }
    if (emailOpt) {
      setSelected(emailOpt);
      // Swap in a fresh random opener — unless the user typed their own note.
      setMessage((prev) => {
        const userEdited = prev.trim() && prev !== seededRef.current;
        if (userEdited) return prev;
        const next = pickIntro(seededRef.current);
        seededRef.current = next;
        return next;
      });
    } else {
      setMessage(buildTasksEmailDraft(member.username, chosen));
    }
  }

  if (member.messageOptions.length === 0) {
    return (
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs text-foreground-subtle">
          No connected channel can deliver a message to this member yet — add an email
          contact or connect a publisher for this portal.
        </p>
      </div>
    );
  }

  async function send() {
    if (!selected || sending) return;
    const text = message.trim();
    if (!isTasksEmail && !text) return; // tasks email can go with just the cards
    setSending(true);
    setResult(null);
    try {
      if (isTasksEmail) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        // Include the starred task even if it wasn't checked, then order
        // priority-first so the digest reads top-down by urgency.
        const ids = new Set(chosenForEmail.map((t) => t.id));
        const withStar = importantId && !ids.has(importantId)
          ? [...openTasks.filter((t) => t.id === importantId), ...chosenForEmail]
          : chosenForEmail;
        const payload = [...withStar]
          .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            board: t.board,
            priority: t.priority,
            number: t.number,
            url: origin ? `${origin}/kanban?open=${encodeURIComponent(t.id)}` : t.url,
            important: t.id === importantId,
          }));
        const r = await sendTeamTasksEmail({ username: member.username, intro: text, origin, tasks: payload });
        if (r.ok) {
          setMessage("");
          setResult({ ok: true, text: `Email enviado pra @${member.username} ✨` });
        } else {
          setResult({ ok: false, text: r.error });
        }
      } else {
        const r = await sendTeamMessage({
          username: member.username,
          channel: selected.channel,
          message: text,
        });
        if (r.ok) {
          setMessage("");
          setResult({ ok: true, text: `Sent via ${CHANNEL_LABEL[selected.channel]}.`, url: r.url });
        } else {
          setResult({ ok: false, text: r.error });
        }
      }
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Failed to send." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-sm font-medium text-foreground">Send a message</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {member.messageOptions.map((opt) => {
          const active = selected?.channel === opt.channel;
          return (
            <button
              key={opt.channel}
              type="button"
              onClick={() => {
                setSelected(opt);
                setResult(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-accent-border bg-accent-bg text-accent"
                  : "border-border bg-surface text-foreground-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {networkIcon(opt.channel)}
              {CHANNEL_LABEL[opt.channel]}
              {opt.visibility === "private" ? (
                <Lock className="h-3 w-3 opacity-70" aria-label="Private" />
              ) : (
                <Globe className="h-3 w-3 opacity-70" aria-label="Public" />
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="mt-2 text-xs text-foreground-subtle">
          {deliveryHint(selected, member.username)}
        </p>
      )}

      <div className="mt-2.5">
        <button
          type="button"
          onClick={draftTasks}
          disabled={openTasks.length === 0}
          title="Prepara um email visual com as tarefas do membro. Marque tarefas na lista acima pra escolher quais (sem seleção, usa todas as abertas) e ⭐ a mais importante. O texto abaixo vira a sua mensagem pessoal."
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
        >
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          {selectedIds.size > 0 ? `Rascunhar email (${selectedIds.size} selecionada${selectedIds.size > 1 ? "s" : ""})` : "Rascunhar email com tarefas"}
        </button>
      </div>

      {isTasksEmail && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-foreground-subtle">
          <Star className={`h-3 w-3 ${importantId ? "fill-amber-400 text-amber-500" : "text-foreground-faint"}`} aria-hidden />
          Email visual com {chosenForEmail.length} tarefa{chosenForEmail.length > 1 ? "s" : ""}
          {importantId ? " · 1 em destaque ⭐" : " · escolha uma ⭐ pra destacar"} · o texto abaixo é a sua mensagem pessoal.
        </p>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={isTasksEmail ? `Mensagem pessoal pra @${member.username} (opcional)…` : `Write to @${member.username}…`}
        className="mt-2 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:border-accent-border focus:ring-1 focus:ring-accent-border"
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs" aria-live="polite">
          {result ? (
            <span className={result.ok ? "text-success" : "text-danger"}>
              {result.text}{" "}
              {result.ok && result.url && (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  View
                </a>
              )}
            </span>
          ) : (
            <span className="tabular-nums text-foreground-faint">{message.length}/2000</span>
          )}
        </p>
        <button
          type="button"
          onClick={send}
          disabled={sending || !selected || (!message.trim() && !isTasksEmail)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-background transition-opacity disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden />
          )}
          {sending ? "Sending…" : isTasksEmail ? "Enviar email" : "Send"}
        </button>
      </div>
    </div>
  );
}

const PLATFORM_PLACEHOLDER: Record<string, string> = {
  Email: "name@example.com",
  Telegram: "@username",
  WhatsApp: "+55 11 91234-5678",
  Farcaster: "@handle",
  Instagram: "@handle",
  X: "@handle",
  GitHub: "username",
  Discord: "user ID — 1234567890123456789",
  Website: "https://…",
};

function ContactsEditor({
  member,
  editing,
  onStartAdd,
  onCancel,
  onSaved,
}: {
  member: TeamMember;
  editing: { label: string; value: string } | null;
  onStartAdd: () => void;
  onCancel: () => void;
  onSaved: (patch: { contacts: TeamContact[]; messageOptions: TeamMessageOption[] }) => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState<string>(editing?.label ?? CONTACT_PLATFORMS[0]);
  const [draft, setDraft] = useState(editing?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form when a different contact enters edit mode.
  useEffect(() => {
    setLabel(editing?.label ?? CONTACT_PLATFORMS[0]);
    setDraft(editing?.value ?? "");
    setError(null);
  }, [editing]);

  const isEditingExisting = editing !== null && editing.value !== "";

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await updateTeamMemberContact({
        username: member.username,
        label,
        value: draft,
      });
      if (r.ok) {
        onSaved({ contacts: r.contacts, messageOptions: r.messageOptions });
        router.refresh();
      } else {
        setError(r.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (editing === null) {
    return (
      <button
        type="button"
        onClick={onStartAdd}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-foreground-subtle transition-colors hover:text-foreground"
      >
        <Plus className="h-3 w-3" aria-hidden />
        Add contact
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <select
          value={label}
          disabled={isEditingExisting}
          onChange={(e) => setLabel(e.target.value as ContactPlatform)}
          className="h-8 shrink-0 rounded-md bg-surface-elevated px-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent-border disabled:opacity-60"
          aria-label="Contact platform"
        >
          {CONTACT_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type={label === "Email" ? "email" : "text"}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          placeholder={PLATFORM_PLACEHOLDER[label] ?? "value…"}
          className="min-w-0 flex-1 rounded-md bg-surface-elevated px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-faint focus:ring-1 focus:ring-accent-border"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save contact"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-background disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-foreground-faint">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : (
          "Visible to the whole team — the agent uses these to reach people. Leave empty to remove."
        )}
      </p>
    </div>
  );
}

function MemberTasks({ githubLogin, tasks, err, selectedIds, onToggle, importantId, onToggleImportant, canManage }: {
  githubLogin: string | null;
  tasks: MemberTask[] | null;
  err: string | null;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  importantId: string | null;
  onToggleImportant: (id: string) => void;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [card, setCard] = useState<AggregatedItem | null>(null);
  // Hide Done/closed — the dialog is for live work + drafting follow-up emails.
  const openTasks = (tasks ?? []).filter((t) => !/done|closed/i.test(t.status) && t.state !== "CLOSED");

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-foreground">
        Tarefas no Kanban
        {selectedIds.size > 0 && (
          <span className="ml-1.5 text-xs font-normal text-accent">{selectedIds.size} selecionada{selectedIds.size > 1 ? "s" : ""}</span>
        )}
      </h4>
      {!githubLogin ? (
        <p className="text-xs text-foreground-faint">Sem GitHub vinculado — adicione o contato GitHub pra ver as tarefas atribuídas.</p>
      ) : tasks === null ? (
        <p className="flex items-center gap-1.5 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
      ) : openTasks.length === 0 ? (
        <p className="text-xs text-foreground-faint">{err ?? "Nenhuma tarefa aberta atribuída no board."}</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] text-foreground-faint">Marque pra incluir no email · ⭐ define a tarefa mais importante ↓</p>
          {openTasks.map((t) => {
            const checked = selectedIds.has(t.id);
            const starred = importantId === t.id;
            return (
              <div key={t.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2 transition-colors ${starred ? "border-amber-400/70 bg-amber-400/10" : checked ? "border-accent-border bg-accent-bg/30" : "border-border bg-surface hover:border-border-strong"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(t.id)}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                  aria-label={`Selecionar ${t.title}`}
                />
                <button
                  type="button"
                  onClick={() => onToggleImportant(t.id)}
                  className={`mt-0.5 shrink-0 rounded-md p-0.5 transition-colors ${starred ? "text-amber-500" : "text-foreground-faint hover:text-amber-500"}`}
                  title={starred ? "Tarefa mais importante (clique pra remover)" : "Marcar como a tarefa mais importante"}
                  aria-label={starred ? "Remover destaque de mais importante" : "Marcar como mais importante"}
                  aria-pressed={starred}
                >
                  <Star className={`h-3.5 w-3.5 ${starred ? "fill-current" : ""}`} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => (t.card ? setCard(t.card) : router.push(`/kanban?open=${encodeURIComponent(t.id)}`))}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {t.board && <span className="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">{t.board}</span>}
                    <span className="rounded-full border border-border bg-foreground/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{t.status}</span>
                    <FirePriority value={t.firePriority} />
                    <DeadlineChip value={t.deadline} />
                    {t.priority && <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] text-foreground-subtle">{t.priority}</span>}
                    {t.number ? <span className="text-[10px] text-foreground-faint">#{t.number}</span> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-foreground">{t.title}</p>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {card && <CardDialogHost item={card} canManage={canManage} onClose={() => setCard(null)} />}
    </div>
  );
}

function MemberSkillsPanel({ username }: { username: string }) {
  const [values, setValues] = useState<Record<string, number> | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({}); // last persisted (for cancel)
  const [bio, setBio] = useState("");
  const [savedBio, setSavedBio] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getMemberSkills(username).then((r) => {
      if (!live) return;
      if (r.ok) { setValues(r.skills); setSaved(r.skills); setBio(r.bio); setSavedBio(r.bio); setCanEdit(r.canEdit); }
      else setValues({});
    });
    return () => { live = false; };
  }, [username]);

  if (values === null) {
    return <p className="flex items-center gap-1.5 text-xs text-foreground-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>;
  }

  const set = (key: string, v: number) => {
    setValues((p) => ({ ...(p ?? {}), [key]: v }));
    setDirty(true);
  };

  async function save() {
    if (!values || saving) return;
    setSaving(true);
    const r = await setMemberSkills(username, values, bio);
    setSaving(false);
    if (r.ok) { setSaved(values); setSavedBio(bio); setDirty(false); setEditing(false); }
  }

  function cancel() {
    setValues(saved);
    setBio(savedBio);
    setDirty(false);
    setEditing(false);
  }

  // Deterministic (no AI) read of what this member can contribute, from the
  // current trait setup — updates live as the sliders move while editing.
  const profile = describeContribution(values, username);

  return (
    <div className={editing ? "grid items-start gap-6 lg:grid-cols-2" : "flex flex-col items-center gap-4"}>
      <div className="flex w-full flex-col items-center gap-3">
        <SkillRadar values={values} accent="var(--color-accent)" />
        <div className="w-full max-w-md rounded-xl border border-border bg-surface px-4 py-3 text-center">
          {profile.archetype && (
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-accent">
              Perfil {profile.archetype}
            </p>
          )}
          <p className="text-sm text-foreground-muted">{profile.summary}</p>
        </div>
      </div>

      {!editing ? (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          {bio.trim() ? (
            <p className="whitespace-pre-wrap text-center text-sm text-foreground-muted">{bio}</p>
          ) : canEdit ? (
            <p className="text-xs italic text-foreground-faint">Sem bio ainda.</p>
          ) : null}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar atributos
            </button>
          )}
        </div>
      ) : (
        <div className="w-full space-y-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-foreground-faint">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => { setBio(e.target.value); setDirty(true); }}
              rows={3}
              maxLength={600}
              placeholder="Uma linha sobre o membro, foco, etc."
              className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-faint focus:border-border-strong focus:outline-none"
            />
          </div>
          {SKILL_CATEGORIES.map((c) => {
            const v = values![c.key] ?? 0;
            return (
              <div key={c.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-muted">{c.label}</span>
                  <span className="tabular-nums text-foreground-subtle">{v}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={v}
                  onChange={(e) => set(c.key, Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                  aria-label={c.label}
                />
              </div>
            );
          })}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-foreground transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemberModal({ member, canManage, onClose }: { member: TeamMember; canManage?: boolean; onClose: () => void }) {
  const titleId = useId();
  const router = useRouter();
  const [mgrBusy, setMgrBusy] = useState(false);
  const [mgrErr, setMgrErr] = useState<string | null>(null);
  async function manage(fn: () => Promise<{ ok: boolean; error?: string }>, close?: boolean) {
    setMgrBusy(true);
    setMgrErr(null);
    const r = await fn();
    setMgrBusy(false);
    if (!r.ok) setMgrErr(r.error ?? "Falhou.");
    else if (close) onClose();
    else router.refresh();
  }
  // Local copy so contact edits reflect immediately (server re-render catches
  // up via router.refresh()).
  const [current, setCurrent] = useState(member);
  const [editingContact, setEditingContact] = useState<{ label: string; value: string } | null>(
    null,
  );
  // Member's Kanban tasks + which are selected for the email draft. Lifted here
  // so the task list (MemberTasks) and the composer (MessageComposer) share them.
  const ghLogin = githubLoginOf(current);
  const [tasks, setTasks] = useState<MemberTask[] | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  // The one ⭐ task — the "most important" task, rendered as the email's hero.
  const [importantTaskId, setImportantTaskId] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!ghLogin) { setTasks([]); return; }
    let cancelled = false;
    getMemberTasks(ghLogin).then((r) => {
      if (cancelled) return;
      if (r.ok) setTasks(r.tasks);
      else { setTasks([]); setTasksErr(r.error); }
    });
    return () => { cancelled = true; };
  }, [ghLogin]);
  const toggleTask = (id: string) =>
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  // Starring a task makes it the hero AND ensures it's included in the digest.
  const toggleImportant = (id: string) => {
    setImportantTaskId((prev) => (prev === id ? null : id));
    setSelectedTaskIds((prev) => {
      if (importantTaskId === id) return prev; // un-starring: leave selection as-is
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };
  // Full setup: Hive (always), then EVERY contact platform — set ones with their
  // value, unset ones flagged `missing` so the whole setup is visible at a glance.
  const byLabel = new Map(current.contacts.map((c) => [c.label, c]));
  const known = new Set<string>(["Hive", ...CONTACT_PLATFORMS]);
  const contacts: { label: string; value: string; url?: string; missing?: boolean }[] = [
    { label: "Hive", value: `@${current.username}`, url: current.profileUrl },
    ...CONTACT_PLATFORMS.map((label) => {
      const c = byLabel.get(label);
      return c ? { label, value: c.value, url: c.url } : { label, value: "", missing: true };
    }),
    ...current.contacts.filter((c) => !known.has(c.label)).map((c) => ({ label: c.label, value: c.value, url: c.url })),
  ];

  const [tab, setTab] = useState<"skills" | "contacts" | "tasks">("tasks");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-[100dvh] w-full max-w-6xl flex-col bg-surface-elevated shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 p-5 pb-3 sm:p-6 sm:pb-3">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={member.avatarUrl}
              alt={`@${member.username}`}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full border border-border object-cover"
            />
            <div>
              <h3 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-foreground tabular-nums">
                @{member.username}
                {member.global ? (
                  <span className="rounded-full border border-accent-border bg-accent-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    Admin global
                  </span>
                ) : member.role ? (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ROLE_BADGE[member.role]}`}>
                    {ROLE_LABEL[member.role]}
                  </span>
                ) : null}
              </h3>
              <p className="text-sm text-foreground-muted">Setup do usuário · visto {relativeSince(member.lastLoginAt)}</p>
              {member.portals && member.portals.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-foreground-faint">Acesso:</span>
                  {member.portals.map((p) => (
                    <span key={p.slug} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] text-foreground-muted">
                      {p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close contact card"
            className="rounded-full border border-border p-2 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Tabs — keep each section roomy instead of cramming the screen */}
        <div className="flex shrink-0 gap-1 border-b border-border px-5 sm:px-6">
          {([["tasks", "Tarefas"], ["contacts", "Conexões"], ["skills", "Skills"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${tab === id ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content (scrolls; header/tabs/danger-zone stay fixed) */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {tab === "skills" && <MemberSkillsPanel username={member.username} />}

          {tab === "contacts" && (
          <div className="space-y-2">
          {contacts.filter((c) => !c.missing).map((contact) => {
            const editable = (CONTACT_PLATFORMS as readonly string[]).includes(contact.label);
            // GitHub rows get the live avatar next to the handle — instant
            // visual confirmation the login is right (404 logins render blank).
            const ghRowLogin =
              contact.label === "GitHub"
                ? contact.value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "")
                : null;
            const content = (
              <>
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="text-foreground-subtle">{networkIcon(contact.label)}</span>
                  {contact.label}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-foreground-muted tabular-nums">
                  {contact.missing ? (
                    <span className="italic text-foreground-faint">não configurado</span>
                  ) : (
                    <>
                      {contact.label === "Discord" && <DiscordUserChip userId={contact.value} />}
                      {ghRowLogin && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={githubAvatarUrl(ghRowLogin, 40)}
                          alt=""
                          width={18}
                          height={18}
                          className="h-[18px] w-[18px] shrink-0 rounded-full border border-border object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      {contact.value}
                      {contact.url && <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />}
                    </>
                  )}
                </span>
              </>
            );
            const rowClass =
              "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3";

            return (
              <div key={`${contact.label}-${contact.value}`} className="flex items-center gap-1.5">
                {contact.url ? (
                  <a
                    href={contact.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${rowClass} transition-colors hover:border-border-strong hover:bg-background`}
                  >
                    {content}
                  </a>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Edit ${contact.label}`}
                    onClick={() =>
                      setEditingContact({ label: contact.label, value: contact.value })
                    }
                    className="shrink-0 rounded-md p-1.5 text-foreground-faint transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
            <ContactsEditor
              member={current}
              editing={editingContact}
              onStartAdd={() => setEditingContact({ label: CONTACT_PLATFORMS[0], value: "" })}
              onCancel={() => setEditingContact(null)}
              onSaved={(patch) => {
                setCurrent((c) => ({ ...c, ...patch }));
                setEditingContact(null);
              }}
            />
          </div>
          )}

          {tab === "tasks" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <MemberTasks
              githubLogin={ghLogin}
              tasks={tasks}
              err={tasksErr}
              selectedIds={selectedTaskIds}
              onToggle={toggleTask}
              importantId={importantTaskId}
              onToggleImportant={toggleImportant}
              canManage={canManage}
            />
            <MessageComposer
              key={current.messageOptions.map((o) => `${o.channel}:${o.target}`).join("|")}
              member={current}
              tasks={tasks}
              selectedIds={selectedTaskIds}
              importantId={importantTaskId}
            />
          </div>
          )}
        </div>

        {/* Danger zone — admin only, pinned at the bottom */}
        {canManage && !member.global && (
          <div className="shrink-0 border-t border-border p-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-danger">Danger zone</span>
              <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                Cargo:
                <select
                  defaultValue={member.role ?? "member"}
                  disabled={mgrBusy}
                  onChange={(e) => manage(() => setMemberRole(member.username, e.target.value as Role))}
                  className="rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground disabled:opacity-50"
                >
                  {(["admin", "member", "viewer"] as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={mgrBusy}
                onClick={() => manage(() => removeMember(member.username), true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remover do portal
              </button>
              {mgrErr && <p className="w-full text-[11px] text-danger">{mgrErr}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionCard({
  connection,
  onOpen,
  repos,
  githubProject,
}: {
  connection: PortalConnection;
  onOpen: () => void;
  repos?: string[];
  githubProject?: { org: string; number: number };
}) {
  const badge = statusBadge(connection.status);
  const isGitHub = connection.network.toLowerCase() === "github";
  const isDiscord = connection.network.toLowerCase() === "discord";

  return (
    <div className="group flex w-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong">
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${connection.network} setup guide`}
      className="flex w-full flex-col gap-3 text-left"
    >
      {/* Header: icon + name + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          <span className="text-foreground-subtle">{networkIcon(connection.network)}</span>
          <span className="truncate">{connection.network}</span>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
          {badge.icon}
          {badge.label}
        </span>
      </div>

      {isGitHub ? (
        // GitHub: show the Kanban project + the repos the AI reads for context.
        <div className="space-y-2">
          {githubProject ? (
            <div className="rounded-lg bg-surface-elevated px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Kanban</div>
              <div className="truncate text-sm font-medium text-foreground tabular-nums">
                {githubProject.org} · Project #{githubProject.number}
              </div>
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground-faint">
              Repos que a IA lê{repos?.length ? ` (${repos.length})` : ""}
            </div>
            {repos && repos.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {repos.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] text-foreground-muted"
                  >
                    {networkIcon("github")}
                    {r}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground-faint">Nenhum repo configurado.</p>
            )}
          </div>
        </div>
      ) : (
        // Connected account (handle), emphasized.
        connection.handle ? (
          <div className="rounded-lg bg-surface-elevated px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-foreground-faint">Conta</div>
            <div className="truncate text-sm font-medium text-foreground tabular-nums">{connection.handle}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-foreground-faint">
            Nenhuma conta conectada
          </div>
        )
      )}

      {/* Detail + fixHint */}
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-foreground-muted">{connection.detail}</p>
        {connection.fixHint && (
          <p className="text-[11px] text-foreground-subtle">
            <span className="mr-1 text-foreground-faint">→</span>
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">{connection.fixHint}</code>
          </p>
        )}
      </div>
    </button>

      {/* Discord: pick the default channel right on its card. */}
      {isDiscord && connection.status !== "missing" && (
        <div className="border-t border-border pt-2">
          <DiscordChannelPicker compact />
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function TeamView({ projectName, members, canManage }: TeamViewProps) {
  // Shareable: the open member lives in ?member=<username> so a copied link
  // opens that member's dialog directly.
  const [memberParam, setMemberParam] = useUrlTab("member", "");
  const selectedMember = members.find((m) => m.username === memberParam) ?? null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="team-heading">
        <div className="mb-4 flex items-baseline gap-3">
          <h2 id="team-heading" className="text-lg font-semibold tracking-tight text-foreground">
            Team
          </h2>
          <span className="text-xs tabular-nums text-foreground-faint">
            {members.length} {members.length === 1 ? "member" : "members"} · {projectName}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {members.map((m) => (
            <MemberCard key={m.username} member={m} onOpen={(mem) => setMemberParam(mem.username)} />
          ))}
        </div>
      </section>

      {selectedMember && (
        <MemberModal member={selectedMember} canManage={canManage} onClose={() => setMemberParam(null)} />
      )}
    </div>
  );
}

// Linked-network connection status + setup guides — lives in Settings now.
export function ConnectionsView({ projectName, connections, envPrefix, repos, githubProject, farcasterClientId }: ConnectionsViewProps) {
  const [setupConnection, setSetupConnection] = useState<PortalConnection | null>(null);

  // Reorder: put non-na, non-manual first for scannability
  const sorted = [...connections].sort((a, b) => {
    const order: Record<ConnectionStatus, number> = { missing: 0, warning: 1, connected: 2, manual: 3, na: 4 };
    return order[a.status] - order[b.status];
  });
  const connectedCount = connections.filter((c) => c.status === "connected").length;
  const relevant = connections.filter((c) => c.status !== "na").length;

  return (
    <section aria-labelledby="networks-heading">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h2 id="networks-heading" className="text-lg font-semibold tracking-tight text-foreground">
          Connections
        </h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">marca · admin</span>
        <span className="text-xs text-foreground-faint">
          {projectName} · {connectedCount}/{relevant} conectadas
        </span>
      </div>
      <p className="mb-4 text-xs text-foreground-muted">
        Contas oficiais da marca (posting key / signer do portal). Setup de admin. Sua conta pessoal fica em “Minhas contas no trail”, acima.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((c) => (
          <ConnectionCard
            key={c.network}
            connection={c}
            onOpen={() => setSetupConnection(c)}
            repos={repos}
            githubProject={githubProject}
          />
        ))}
      </div>
      {setupConnection && (
        <ConnectionSetupDialog
          connection={setupConnection}
          envPrefix={envPrefix}
          farcasterClientId={farcasterClientId}
          onClose={() => setSetupConnection(null)}
        />
      )}
    </section>
  );
}
