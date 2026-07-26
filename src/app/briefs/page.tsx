import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listBriefs } from "@/app/actions/sopa-briefs";
import { SopaBriefs } from "@/components/sopa-briefs";

export const dynamic = "force-dynamic";

export default async function BriefsPage() {
  const project = await getActiveProject();
  if (!project.briefs || project.slug !== "sopa") notFound();

  const res = await listBriefs();
  if (!res.ok) notFound();

  return <SopaBriefs initial={res.briefs} />;
}
