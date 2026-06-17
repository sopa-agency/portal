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

  const members = roster.map(({ username, avatarUrl, profileUrl, contacts, global }) => ({
    username,
    avatarUrl,
    profileUrl,
    contacts,
    global,
    role: roleMap.get(username)?.role ?? "member",
    lastLoginAt: lastSeen.get(username) ?? null,
    portals: portalsForUser(username),
    messageOptions: getTeamMessageOptions(project, username, { contacts }),
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Team"
        description="Members of this portal. Connections moved to Settings."
      />
      <TeamView projectName={project.name} members={members} canManage={viewer?.role === "admin"} />
    </div>
  );
}
