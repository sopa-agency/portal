export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { TeamView } from "@/components/team-view";
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Team"
        description="Members of this portal. Connections moved to Settings."
      />
      <TeamView projectName={project.name} members={members} />
    </div>
  );
}
