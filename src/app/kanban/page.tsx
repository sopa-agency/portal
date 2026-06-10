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
    // Fixed viewport height on md+ (100dvh minus the shell's md:p-8 padding)
    // so the board fills the screen and columns scroll internally.
    <div className="flex flex-col gap-6 md:h-[calc(100dvh-4rem)]">
      <PageHeader
        eyebrow={project.name}
        title="Kanban"
        description="GitHub Project board — track open issues and pull requests by status."
      />
      <KanbanBoard />
    </div>
  );
}
