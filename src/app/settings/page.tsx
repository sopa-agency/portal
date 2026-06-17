export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { ConnectionsView } from "@/components/team-view";
import { getPortalConnections, verifyDiscordConnection } from "@/lib/portal-connections";

export default async function SettingsPage() {
  const project = await getActiveProject();

  const connections = getPortalConnections(project);
  // Merge live Discord verification only when a token exists (status !== missing).
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
        title="Settings"
        description="Portal connections and configuration."
      />
      <ConnectionsView
        projectName={project.name}
        connections={connections}
        envPrefix={project.agent.gatewayEnvPrefix}
      />
    </div>
  );
}
