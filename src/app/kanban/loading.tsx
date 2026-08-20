import { PageHeader } from "@/components/page-header";
import { KanbanBoardSkeleton } from "@/components/kanban-skeleton";

/**
 * Mirrors the page's own frame instead of the generic PageSkeleton: the title
 * here is a constant, so it renders for real and never swaps, and the body is
 * the same skeleton KanbanBoard shows while it fetches — the two waits become
 * one. The board's actions live in its meta bar, not the header, so nothing is
 * reserved up here.
 *
 * The label is the pt string verbatim (`kanban.loadingBoard`) rather than a
 * lookup: a fallback has to render synchronously, so it can't await the locale
 * cookie, and every other loading.tsx makes the same trade. Keep the two in
 * sync — a screen reader hearing two different texts is this bug, out loud.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-4rem)]">
      <PageHeader compact title="Kanban" />
      <KanbanBoardSkeleton label="Carregando o Kanban" />
    </div>
  );
}
