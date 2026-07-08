import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getActiveProject } from "@/projects";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/kanban-board";
import { AggregatedKanban } from "@/components/aggregated-kanban";
import { KanbanRepoPRs } from "@/components/kanban-repo-prs";
import { fetchAggregatedBoards, fetchOpenPullRequests } from "@/lib/github-project";
import { listBounties } from "@/app/actions/bounty";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const project = await getActiveProject();

  // SOPA hub: aggregate every portal's board into one read-only view.
  if (project.kanbanAggregate) {
    const [{ columns }, who, bountiesRes, prs] = await Promise.all([
      fetchAggregatedBoards(),
      authorize((await cookies()).get(SESSION_COOKIE)?.value, project),
      listBounties(),
      fetchOpenPullRequests(project),
    ]);
    return (
      <div className="flex flex-col gap-6 lg:h-[calc(100dvh-4rem)]">
        <PageHeader
          eyebrow={project.name}
          title="Kanban"
          description="Todas as tarefas de todos os portais, por status."
          actions={project.repos?.length ? <KanbanRepoPRs prs={prs} /> : undefined}
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

  const prs = await fetchOpenPullRequests(project);

  return (
    // Fixed viewport height on lg+ (100dvh minus the shell's md:p-8 padding),
    // matching where the sidebar becomes a fixed side rail. Below lg the page
    // flows under the stacked nav so the board doesn't double-scroll.
    <div className="flex flex-col gap-6 lg:h-[calc(100dvh-4rem)]">
      <PageHeader
        eyebrow={project.name}
        title="Kanban"
        description="GitHub Project board — track open issues and pull requests by status."
        actions={project.repos?.length ? <KanbanRepoPRs prs={prs} /> : undefined}
      />
      <KanbanBoard />
    </div>
  );
}
