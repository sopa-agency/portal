import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/kanban-board";
import { AggregatedKanban } from "@/components/aggregated-kanban";
import { fetchAggregatedBoards } from "@/lib/github-project";
import { listBounties } from "@/app/actions/bounty";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const project = await getActiveProject();

  // SOPA hub: aggregate every portal's board into one read-only view.
  if (project.kanbanAggregate) {
    const [{ columns }, who, bountiesRes] = await Promise.all([
      fetchAggregatedBoards(),
      authorize((await cookies()).get(SESSION_COOKIE)?.value, project),
      listBounties(),
    ]);
    return (
      <div className="flex flex-col gap-6 md:h-[calc(100dvh-4rem)]">
        <PageHeader
          eyebrow={project.name}
          title="Kanban"
          description="Todas as tarefas de todos os portais, por status (somente leitura)."
        />
        <AggregatedKanban
          columns={columns}
          bounties={bountiesRes.ok ? bountiesRes.bounties : []}
          canManage={!!who?.global}
        />
      </div>
    );
  }

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
