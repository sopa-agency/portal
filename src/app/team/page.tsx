export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { TeamView } from "@/components/team-view";
import { getPortalConnections, verifyDiscordConnection } from "@/lib/portal-connections";
import { getTeamMessageOptions } from "@/lib/team-messaging";
import { getTeamRoster, portalsForUser } from "@/lib/team-roster";

export default async function TeamPage() {
  const project = await getActiveProject();

  // Single centralized team registry (allowlist + cross-portal contacts + global admins).
  const roster = await getTeamRoster(project);
  const members = roster.map(({ username, avatarUrl, profileUrl, contacts, global }) => ({
    username,
    avatarUrl,
    profileUrl,
    contacts,
    global,
    portals: portalsForUser(username),
    messageOptions: getTeamMessageOptions(project, username, { contacts }),
  }));

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
