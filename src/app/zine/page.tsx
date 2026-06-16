import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { ZineStudio } from "@/components/zine-studio";

export const dynamic = "force-dynamic";

export default async function ZinePage() {
  const project = await getActiveProject();
  if (!project.zineStudio) notFound();
  return <ZineStudio projectSlug={project.slug} projectName={project.name} accent={project.theme.accentDark} />;
}
