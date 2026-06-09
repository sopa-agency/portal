"use client";

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
} from "lucide-react";
import type { PortalConnection, ConnectionStatus } from "@/lib/portal-connections";

// ── Types ──────────────────────────────────────────────────────────────────

type TeamMember = {
  username: string;
  avatarUrl: string;
  profileUrl: string;
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

function MemberCard({ member }: { member: TeamMember }) {
  return (
    <a
      href={member.profileUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View @${member.username} on Hive`}
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
    </a>
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
            <MemberCard key={m.username} member={m} />
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
    </div>
  );
}
