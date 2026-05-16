export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { MorningBriefing, BriefingMissing } from "@/components/morning-briefing";
import { RegenerateBriefingButton } from "@/components/regenerate-briefing-button";
import { BriefingTabs, type BriefingTab } from "@/components/briefing-tabs";
import {
  BRIEFING_AGENTS,
  loadLatestBriefing,
  todayIsoDate,
} from "@/lib/morning-briefing";

const TAB_LABELS: Record<string, string> = {
  "skatehive-marketing": "MKT",
  "skate-dev": "DEV",
};

const TAB_ORDER = ["skatehive-marketing", "skate-dev"];

export default async function Home() {
  const today = todayIsoDate();
  const results = await Promise.all(BRIEFING_AGENTS.map((a) => loadLatestBriefing(a)));

  const tabs: BriefingTab[] = [];
  for (const slug of TAB_ORDER) {
    const result = results.find((r) => (r.ok ? r.briefing.agent.slug : r.agent.slug) === slug);
    if (!result) continue;
    tabs.push({
      slug,
      label: TAB_LABELS[slug] ?? slug,
      content: result.ok ? (
        <MorningBriefing briefing={result.briefing} today={today} />
      ) : (
        <BriefingMissing agent={result.agent} error={result.error} />
      ),
    });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Daily"
        title="Morning brief"
        description="Latest snapshots from the OpenClaw morning briefing crons — one per agent. Sections classify themselves: status, priorities, risks, next actions."
        status={today}
        actions={<RegenerateBriefingButton />}
      />

      <BriefingTabs tabs={tabs} />
    </div>
  );
}
