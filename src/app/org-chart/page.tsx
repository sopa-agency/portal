import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listBoard } from "@/app/actions/sopa-boards";
import { SopaOrgChart } from "@/components/sopa-org-chart";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const project = await getActiveProject();
  if (!project.orgChart || project.slug !== "sopa") notFound();
  const cards = await listBoard("orgchart");
  return <SopaOrgChart initial={cards} />;
}
