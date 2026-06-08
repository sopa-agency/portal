import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const project = await getActiveProject();

  if (!project.analytics) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="GA4 traffic and Search Console performance data."
      />
      <AnalyticsDashboard agentName={project.agent.displayName} />
    </div>
  );
}
