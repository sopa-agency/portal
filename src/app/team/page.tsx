export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { TeamView } from "@/components/team-view";
import { getPortalConnections, verifyDiscordConnection } from "@/lib/portal-connections";
import {
  getTeamMessageOptions,
  mergeContacts,
  resolveCrossPortalContacts,
} from "@/lib/team-messaging";
import { prisma } from "@/lib/prisma";

export default async function TeamPage() {
  const project = await getActiveProject();

  // Coworker-edited contacts override the static teamContacts config. Rows are
  // fetched across ALL portals for these members so a contact entered in one
  // portal (email, socials) carries over here — the current portal still wins.
  const contactRows = await prisma.teamMemberContact.findMany({
    where: { username: { in: project.allowlist } },
  });
  const rowsByUser = resolveCrossPortalContacts(contactRows, project.slug);

  const members = project.allowlist.map((username) => {
    const contacts = mergeContacts(
      project.teamContacts?.[username] ?? [],
      rowsByUser.get(username) ?? [],
    );
    return {
      username,
      avatarUrl: `https://images.hive.blog/u/${username}/avatar`,
      profileUrl: `${project.hive.frontend ?? "https://peakd.com"}/@${username}`,
      contacts,
      messageOptions: getTeamMessageOptions(project, username, { contacts }),
    };
  });

  const connections = getPortalConnections(project);

  // Merge live Discord verification result only when a token exists (i.e. the
  // sync row is "manual" — meaning token+channel were found — not "missing").
  const discordRow = connections.find((c) => c.network === "Discord");
  if (discordRow && discordRow.status !== "missing") {
    const live = await verifyDiscordConnection(project);
    discordRow.status = live.status;
    discordRow.detail = live.detail;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Team"
        description="Allowlist members and linked network connection status for this portal."
      />
      <TeamView
        projectName={project.name}
        members={members}
        connections={connections}
        envPrefix={project.agent.gatewayEnvPrefix}
      />
    </div>
  );
}
