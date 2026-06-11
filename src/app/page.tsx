export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { MorningBriefing, BriefingMissing } from "@/components/morning-briefing";
import { RegenerateBriefingButton } from "@/components/regenerate-briefing-button";
import { BriefingTabs, type BriefingTab } from "@/components/briefing-tabs";
import { SocialDashboard } from "@/components/social-dashboard";
import {
  loadLatestBriefing,
  todayIsoDate,
} from "@/lib/morning-briefing";
import { getActiveProject } from "@/projects";

export default async function Home() {
  const today = todayIsoDate();
  const project = await getActiveProject();
  const briefingAgents = project.briefingAgents;
  const results = await Promise.all(briefingAgents.map((a) => loadLatestBriefing(a)));

  const briefingTabs: BriefingTab[] = [];
  for (const agent of briefingAgents) {
    const result = results.find((r) => (r.ok ? r.briefing.agent.slug : r.agent.slug) === agent.slug);
    if (!result) continue;
    briefingTabs.push({
      slug: agent.slug,
      label: agent.tabLabel ?? agent.label,
      content: result.ok ? (
        <MorningBriefing
          briefing={result.briefing}
          today={today}
          teamEmails={project.teamEmails ?? []}
          projectName={project.name}
          githubRepo={project.repos[0]}
        />
      ) : (
        <BriefingMissing agent={result.agent} error={result.error} />
      ),
    });
  }

  const topTabs: BriefingTab[] = [
    {
      slug: "brief",
      label: "Morning brief",
      content: <BriefingTabs tabs={briefingTabs} />,
    },
    {
      slug: "socials",
      label: "Socials",
      content: <SocialDashboard socials={project.socials} agentName={project.agent.displayName} />,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Daily"
        title={project.name}
        description="Morning briefings from the OpenClaw crons, plus the social posting strategy per channel."
        status={today}
        actions={<RegenerateBriefingButton />}
      />

      <BriefingTabs tabs={topTabs} />
    </div>
  );
}
