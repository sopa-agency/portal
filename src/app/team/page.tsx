export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { TeamView } from "@/components/team-view";
import { getTeamMessageOptions } from "@/lib/team-messaging";
import { getTeamRoster, portalsForUser } from "@/lib/team-roster";
import { getRoles, authorize } from "@/lib/team-access";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamAdmin } from "@/components/team-admin";
import { PortalAccessManager } from "@/components/portal-access-manager";
import { listTeamMembers, listAllPortalAccess } from "@/app/actions/team-admin";

export default async function TeamPage() {
  const project = await getActiveProject();

  // Single centralized team registry (allowlist + cross-portal contacts + global admins).
  const roster = await getTeamRoster(project);
  const usernames = roster.map((m) => m.username);
  const [roleMap, activity, viewer] = await Promise.all([
    getRoles(project, usernames),
    prisma.memberActivity
      .findMany({ where: { username: { in: usernames } }, select: { username: true, lastLoginAt: true } })
      .catch(() => [] as { username: string; lastLoginAt: Date }[]),
    authorize((await cookies()).get(SESSION_COOKIE)?.value, project),
  ]);
  const lastSeen = new Map(activity.map((a) => [a.username, a.lastLoginAt.toISOString()]));

  const members = roster.map(({ username, avatarUrl, hasAvatar, profileUrl, contacts, global }) => ({
    username,
    avatarUrl,
    hasAvatar,
    profileUrl,
    contacts,
    global,
    role: roleMap.get(username)?.role ?? "member",
    lastLoginAt: lastSeen.get(username) ?? null,
    portals: portalsForUser(username),
    messageOptions: getTeamMessageOptions(project, username, { contacts }),
  }));

  // Team management lives on the SOPA hub — also surfaced here in the Team tab.
  const isTeamHub = project.slug === "sopa";
  const teamAdmin = isTeamHub && viewer?.role === "admin" ? await listTeamMembers().catch(() => null) : null;
  const portalAccess = isTeamHub && viewer?.global ? await listAllPortalAccess().catch(() => null) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Team"
        description="Members of this portal. Connections moved to Settings."
      />
      <TeamView projectName={project.name} members={members} canManage={viewer?.role === "admin"} />
      {teamAdmin?.ok ? (
        <TeamAdmin initial={teamAdmin.members} viewerGlobal={teamAdmin.viewerGlobal} projectName={project.name} />
      ) : null}
      {portalAccess?.ok ? <PortalAccessManager initial={portalAccess.portals} /> : null}
    </div>
  );
}
