import { Skeleton, SkeletonRegion } from "@/components/skeleton";

/**
 * The wait shape for the Kanban.
 *
 * The board loads in two hops — the route's `loading.tsx` paints while the
 * server component awaits, then `KanbanBoard` mounts and fetches `/api/kanban`
 * client-side — so two skeletons run back to back. Drawing them with the same
 * component is what makes that read as one continuous wait instead of the page
 * loading twice: shared shape, no reflow at the handoff.
 *
 * Boxes match the real board (`min-w-64 flex-1 basis-80` columns inside a
 * horizontal scroller, meta bar above), not a generic card grid.
 *
 * @param label Announced to screen readers; the ellipsis is added here so both
 *   callers say the same thing and the wait isn't announced twice.
 */
export function KanbanBoardSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={`${label}…`} className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Meta bar: filters on the left, board actions on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-7 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-36" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto pb-2">
        <div className="flex h-full min-h-64 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex h-full min-h-64 min-w-64 flex-1 basis-80 flex-col rounded-xl border border-border bg-surface/60 p-2"
            >
              <Skeleton round className="m-1 mb-3 h-4 w-24" />
              {/* Uneven column heights: a board is never four equal stacks, and
                  four identical ones read as a grid the real board then breaks. */}
              <div className="space-y-2">
                <div className="skeleton-shimmer h-20 rounded-xl" aria-hidden="true" />
                <div className="skeleton-shimmer h-14 rounded-xl" aria-hidden="true" />
                {i % 2 === 0 && <div className="skeleton-shimmer h-20 rounded-xl" aria-hidden="true" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
