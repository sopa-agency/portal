export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { getDictionary } from "@/lib/i18n/server";
import { TeamView } from "@/components/team-view";
import { getTeamMessageOptions } from "@/lib/team-messaging";
import { getTeamRoster, getPortalsByUser } from "@/lib/team-roster";
import { getRoles, authorize } from "@/lib/team-access";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamAdmin } from "@/components/team-admin";
import { PortalAccessManager } from "@/components/portal-access-manager";
import { listTeamMembers, listAllPortalAccess } from "@/app/actions/team-admin";

export default async function TeamPage() {
  const project = await getActiveProject();
  const t = await getDictionary();

  // Single centralized team registry (allowlist + cross-portal contacts + global admins).
  const roster = await getTeamRoster(project);
  const usernames = roster.map((m) => m.username);
  // Inclui os apelidos: a atividade fica gravada sob o login que entrou.
  const todosLogins = [...new Set(roster.flatMap((m) => [m.username, ...(m.aliases ?? [])]))];
  const [roleMap, activity, viewer, portalsByUser] = await Promise.all([
    getRoles(project, usernames),
    prisma.memberActivity
      .findMany({ where: { username: { in: todosLogins } }, select: { username: true, lastLoginAt: true } })
      .catch(() => [] as { username: string; lastLoginAt: Date }[]),
    authorize((await cookies()).get(SESSION_COOKIE)?.value, project),
    getPortalsByUser(),
  ]);
  const lastSeen = new Map(activity.map((a) => [a.username, a.lastLoginAt.toISOString()]));

  const members = roster.map(({ username, avatarUrl, hasAvatar, profileUrl, contacts, global, aliases }) => ({
    username,
    avatarUrl,
    hasAvatar,
    profileUrl,
    contacts,
    global,
    aliases,
    role: roleMap.get(username)?.role ?? "member",
    // O último acesso é o mais recente ENTRE os logins da pessoa: ela entrou,
    // e por qual porta é detalhe. Mostrar só o do canônico diria "nunca
    // entrou" de alguém que entrou ontem por outro login.
    lastLoginAt:
      [username, ...(aliases ?? [])]
        .map((u) => lastSeen.get(u))
        .filter((d): d is string => !!d)
        .sort()
        .pop() ?? null,
    portals: portalsByUser.get(username.toLowerCase()) ?? [],
    messageOptions: getTeamMessageOptions(project, username, { contacts }),
  }));

  // Team management lives on the SOPA hub — also surfaced here in the Team tab.
  const isTeamHub = project.slug === "sopa";
  const teamAdmin = isTeamHub && viewer?.role === "admin" ? await listTeamMembers().catch(() => null) : null;
  const portalAccess = isTeamHub && viewer?.global ? await listAllPortalAccess().catch(() => null) : null;

  return (
    <div className="space-y-8">
      {/* Eyebrow is the CATEGORY, not the portal — the portal is already named
          in the sidebar switcher, and the roster count belongs up here rather
          than repeated in a second heading below. */}
      <PageHeader
        eyebrow={t.team.eyebrow}
        title={t.team.title}
        status={t.team.memberCount(members.length)}
        description={t.team.description}
      />
      <TeamView projectName={project.name} members={members} canManage={viewer?.role === "admin"} />
      {teamAdmin?.ok ? (
        <TeamAdmin initial={teamAdmin.members} viewerGlobal={teamAdmin.viewerGlobal} projectName={project.name} />
      ) : null}
      {portalAccess?.ok ? <PortalAccessManager initial={portalAccess.portals} /> : null}
    </div>
  );
}
