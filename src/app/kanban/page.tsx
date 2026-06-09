import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/kanban-board";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const project = await getActiveProject();

  if (!project.githubProject) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project.name}
        title="Kanban"
        description="GitHub Project board — track open issues and pull requests by status."
      />
      <KanbanBoard />
    </div>
  );
}
