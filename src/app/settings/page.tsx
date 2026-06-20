export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { ConnectionsView } from "@/components/team-view";
import { TeamAdmin } from "@/components/team-admin";
import { PortalAccessManager } from "@/components/portal-access-manager";
import { BountySetup } from "@/components/bounty-setup";
import { getPortalConnections, verifyDiscordConnection, verifyFarcasterConnection } from "@/lib/portal-connections";
import { listTeamMembers, listAllPortalAccess } from "@/app/actions/team-admin";

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
  // Upgrade the Farcaster row when a signer was connected via SIWN (DB-stored).
  const farcasterRow = connections.find((c) => c.network === "Farcaster");
  if (farcasterRow && farcasterRow.status !== "na") {
    const fc = await verifyFarcasterConnection(project);
    if (fc) {
      farcasterRow.status = fc.status;
      farcasterRow.detail = fc.detail;
      farcasterRow.fixHint = undefined;
      if (fc.handle) farcasterRow.handle = fc.handle;
    }
  }

  // Team management is centralized on the SOPA portal (the team hub). Other
  // portals' Settings only show connections; SOPA's "Acesso por portal" already
  // manages every portal's roster from one place.
  const isTeamHub = project.slug === "sopa";
  const team = isTeamHub ? await listTeamMembers().catch(() => null) : null;
  const showAdmin = isTeamHub && team?.ok && team.viewerRole === "admin";
  // Cross-portal access — global admins only.
  const portalAccess = isTeamHub && team?.ok && team.viewerGlobal ? await listAllPortalAccess().catch(() => null) : null;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={project.name}
        title="Settings"
        description="Portal connections, team & roles."
      />
      {showAdmin && team?.ok ? (
        <TeamAdmin initial={team.members} viewerGlobal={team.viewerGlobal} projectName={project.name} />
      ) : null}
      {portalAccess?.ok ? <PortalAccessManager initial={portalAccess.portals} /> : null}
      {showAdmin ? <BountySetup /> : null}
      <ConnectionsView
        projectName={project.name}
        connections={connections}
        envPrefix={project.agent.gatewayEnvPrefix}
        repos={project.repos}
        githubProject={project.githubProject}
        farcasterClientId={
          process.env[`${project.agent.gatewayEnvPrefix}_NEYNAR_CLIENT_ID`] ||
          process.env.NEYNAR_CLIENT_ID
        }
      />
    </div>
  );
}
