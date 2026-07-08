export const dynamic = "force-dynamic";

import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { ConnectionsView } from "@/components/team-view";
import { BountySetup } from "@/components/bounty-setup";
import { getPortalConnections, verifyDiscordConnection, verifyFarcasterConnection, verifyAnalyticsConnection } from "@/lib/portal-connections";
import { listTeamMembers } from "@/app/actions/team-admin";
import { MyFarcasterCard } from "@/components/my-farcaster-card";
import { getMyFarcaster } from "@/app/actions/farcaster-member";
import { isTrailParticipant } from "@/lib/farcaster-trail-config";
import { TrailAdmin } from "@/components/trail-admin";
import { listTrailAccounts } from "@/app/actions/trail-admin";
import { sponsorConfigured } from "@/lib/farcaster-sponsor";
import { SettingsTabs, type SettingsTab } from "@/components/settings-tabs";
import { KanbanFxToggle } from "@/components/kanban-fx-toggle";

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
  // Merge live GA4 + GSC verification (skip when unconfigured or creds missing).
  const analyticsRow = connections.find((c) => c.network === "Analytics");
  if (analyticsRow && analyticsRow.status !== "na" && analyticsRow.status !== "missing") {
    const live = await verifyAnalyticsConnection(project);
    if (live) {
      analyticsRow.status = live.status;
      analyticsRow.detail = live.detail;
    }
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

  // Per-member Farcaster connection (QR) — only on trail portals.
  const showMyFarcaster = isTrailParticipant(project.slug);
  const myFarcaster = showMyFarcaster ? await getMyFarcaster().catch(() => null) : null;

  // Trail registry admin — SOPA global admins only.
  const trailAccounts = isTeamHub && team?.ok && team.viewerGlobal ? await listTrailAccounts().catch(() => null) : null;

  const connectionsSection = (
    <div className="space-y-6">
      {showMyFarcaster && myFarcaster ? <MyFarcasterCard initial={myFarcaster} /> : null}
      <KanbanFxToggle />
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

  const trailSection = trailAccounts?.ok ? (
    <TrailAdmin initial={trailAccounts.accounts} sponsorReady={sponsorConfigured()} />
  ) : null;

  const bountiesSection = showAdmin ? <BountySetup /> : null;

  const tabs: SettingsTab[] = [
    { id: "connections", label: "Conexões", content: connectionsSection },
    { id: "trail", label: "Curation Trail", content: trailSection },
    { id: "bounties", label: "Bounties", content: bountiesSection },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Settings"
        description="Portal connections, team & roles."
      />
      <SettingsTabs tabs={tabs} />
    </div>
  );
}
