"use client";

import { useEffect, useId, useState } from "react";
import {
  Camera,
  Hash,
  Radio,
  AtSign,
  MessageSquare,
  Mail,
  BarChart2,
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
} from "lucide-react";
import type { TeamContact } from "@/projects/types";
import type { PortalConnection, ConnectionStatus } from "@/lib/portal-connections";
import type { TeamMessageOption } from "@/lib/team-messaging";
import { sendTeamMessage } from "@/app/actions/team";

// ── Types ──────────────────────────────────────────────────────────────────

type TeamMember = {
  username: string;
  avatarUrl: string;
  profileUrl: string;
  contacts: TeamContact[];
  messageOptions: TeamMessageOption[];
};

type TeamViewProps = {
  projectName: string;
  members: TeamMember[];
  connections: PortalConnection[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

function networkIcon(network: string) {
  const name = network.toLowerCase();
  if (name.includes("instagram")) return <Camera className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("hive")) return <Hash className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("farcaster")) return <Radio className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("x") || name.includes("twitter")) return <AtSign className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("discord")) return <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("email") || name.includes("smtp")) return <Mail className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("analytics")) return <BarChart2 className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("github")) return <Hash className="h-4 w-4 shrink-0" aria-hidden />;
  if (name.includes("telegram")) return <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />;
  return <Info className="h-4 w-4 shrink-0" aria-hidden />;
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

function MemberCard({ member, onOpen }: { member: TeamMember; onOpen: (member: TeamMember) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(member)}
      aria-label={`Open @${member.username} contact card`}
      className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-elevated"
    >
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
      <span className="text-center text-xs font-medium text-foreground-muted group-hover:text-foreground tabular-nums">
        @{member.username}
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

function MessageComposer({ member }: { member: TeamMember }) {
  // Default to a private channel when the member has one.
  const [selected, setSelected] = useState<TeamMessageOption | null>(
    member.messageOptions.find((o) => o.visibility === "private") ??
      member.messageOptions[0] ??
      null,
  );
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

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
    if (!text) return;
    setSending(true);
    setResult(null);
    try {
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

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={`Write to @${member.username}…`}
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
          disabled={sending || !message.trim() || !selected}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-background transition-opacity disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden />
          )}
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function MemberModal({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const titleId = useId();
  const contacts = [
    { label: "Hive", value: `@${member.username}`, url: member.profileUrl },
    ...member.contacts,
  ];

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
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
              <h3 id={titleId} className="text-lg font-semibold text-foreground tabular-nums">
                @{member.username}
              </h3>
              <p className="text-sm text-foreground-muted">Known team contacts</p>
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

        <div className="mt-5 space-y-2">
          {contacts.map((contact) => {
            const content = (
              <>
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="text-foreground-subtle">{networkIcon(contact.label)}</span>
                  {contact.label}
                </span>
                <span className="flex items-center gap-1 text-sm text-foreground-muted tabular-nums">
                  {contact.value}
                  {contact.url && <ExternalLink className="h-3 w-3" aria-hidden />}
                </span>
              </>
            );

            return contact.url ? (
              <a
                key={`${contact.label}-${contact.value}`}
                href={contact.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-background"
              >
                {content}
              </a>
            ) : (
              <div
                key={`${contact.label}-${contact.value}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                {content}
              </div>
            );
          })}
        </div>

        <MessageComposer member={member} />
      </div>
    </div>
  );
}

function ConnectionRow({ connection }: { connection: PortalConnection }) {
  const badge = statusBadge(connection.status);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      {/* Icon + name */}
      <div className="flex min-w-[160px] items-center gap-2 text-sm font-medium text-foreground">
        <span className="text-foreground-subtle">{networkIcon(connection.network)}</span>
        <span>{connection.network}</span>
        {connection.handle && (
          <span className="text-xs text-foreground-muted tabular-nums">{connection.handle}</span>
        )}
      </div>

      {/* Badge */}
      <div className="flex shrink-0 items-center">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.icon}
          {badge.label}
        </span>
      </div>

      {/* Detail + fixHint */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-foreground-muted">{connection.detail}</p>
        {connection.fixHint && (
          <p className="text-xs text-foreground-subtle">
            <span className="mr-1 text-foreground-faint">→</span>
            <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[11px]">
              {connection.fixHint}
            </code>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function TeamView({ projectName, members, connections }: TeamViewProps) {
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);

  // Reorder: put non-na, non-manual first for scannability
  const sorted = [...connections].sort((a, b) => {
    const order: Record<ConnectionStatus, number> = {
      missing: 0,
      warning: 1,
      connected: 2,
      manual: 3,
      na: 4,
    };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="space-y-12">
      {/* ── Team ──────────────────────────────────────────────────────────── */}
      <section aria-labelledby="team-heading">
        <div className="mb-4 flex items-baseline gap-3">
          <h2
            id="team-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Team
          </h2>
          <span className="text-xs tabular-nums text-foreground-faint">
            {members.length} {members.length === 1 ? "member" : "members"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {members.map((m) => (
            <MemberCard key={m.username} member={m} onOpen={setSelectedMember} />
          ))}
        </div>
      </section>

      {/* ── Linked networks ───────────────────────────────────────────────── */}
      <section aria-labelledby="networks-heading">
        <div className="mb-4 flex items-baseline gap-3">
          <h2
            id="networks-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Linked networks
          </h2>
          <span className="text-xs text-foreground-faint">{projectName}</span>
        </div>
        <div className="space-y-2">
          {sorted.map((c) => (
            <ConnectionRow key={c.network} connection={c} />
          ))}
        </div>
      </section>

      {selectedMember && (
        <MemberModal member={selectedMember} onClose={() => setSelectedMember(null)} />
      )}
    </div>
  );
}
