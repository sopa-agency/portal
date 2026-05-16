export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { MorningBriefing, BriefingMissing } from "@/components/morning-briefing";
import { RegenerateBriefingButton } from "@/components/regenerate-briefing-button";
import {
  BRIEFING_AGENTS,
  loadLatestBriefing,
  todayIsoDate,
} from "@/lib/morning-briefing";

export default async function Home() {
  const today = todayIsoDate();
  const results = await Promise.all(BRIEFING_AGENTS.map((a) => loadLatestBriefing(a)));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Daily"
        title="Morning brief"
        description="Latest snapshots from the OpenClaw morning briefing crons — one per agent. Sections classify themselves: status, priorities, risks, next actions."
        status={today}
        actions={<RegenerateBriefingButton />}
      />

      <div className="space-y-12">
        {results.map((r) =>
          r.ok ? (
            <MorningBriefing key={r.briefing.agent.slug} briefing={r.briefing} today={today} />
          ) : (
            <BriefingMissing key={r.agent.slug} agent={r.agent} error={r.error} />
          ),
        )}
      </div>
    </div>
  );
}
