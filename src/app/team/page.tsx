export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { TeamView } from "@/components/team-view";
import { getPortalConnections } from "@/lib/portal-connections";

export default async function TeamPage() {
  const project = await getActiveProject();

  const members = project.allowlist.map((username) => ({
    username,
    avatarUrl: `https://images.hive.blog/u/${username}/avatar`,
    profileUrl: `${project.hive.frontend ?? "https://peakd.com"}/@${username}`,
  }));

  const connections = getPortalConnections(project);

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
      />
    </div>
  );
}
