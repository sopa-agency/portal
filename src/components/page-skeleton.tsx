import { Skeleton, SkeletonCard, SkeletonRegion, SkeletonText } from "@/components/skeleton";

/**
 * Route-level loading UI. Every page opens with the same PageHeader block, so
 * that part is shared and only the body below it changes shape.
 *
 * These render from `loading.tsx`, which Next wraps in a Suspense boundary — the
 * shell paints the instant a link is clicked, instead of the app sitting frozen
 * on the old page while a server component finishes its awaits.
 *
 * Match the variant to what the page actually renders. A skeleton that lies
 * about the layout is worse than none: the eye settles on the wrong shape and
 * the real content feels like it jumped.
 */
type Variant = "stats" | "tabs" | "list" | "board";

function Header({ actions = true }: { actions?: boolean }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <Skeleton round className="h-3 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton round className="h-3 w-80 max-w-full" />
      </div>
      {actions && (
        <div className="flex gap-2">
          <Skeleton round className="h-8 w-28" />
          <Skeleton round className="h-8 w-20" />
        </div>
      )}
    </div>
  );
}

function Body({ variant }: { variant: Variant }) {
  if (variant === "stats") {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonCard className="lg:col-span-2">
            <div className="space-y-4">
              <Skeleton round className="h-3 w-32" />
              <Skeleton className="h-48 w-full" />
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <div className="space-y-4">
              <Skeleton round className="h-3 w-24" />
              <SkeletonText lines={6} />
            </div>
          </SkeletonCard>
        </div>
      </div>
    );
  }

  if (variant === "tabs") {
    return (
      <div className="space-y-6">
        {/* The tab strip resolves first in the real page too, so showing it
            here keeps the eye anchored while the panel below fills in. */}
        <div className="flex gap-2">
          {["w-24", "w-20", "w-28", "w-16"].map((w) => (
            <Skeleton key={w} round className={`h-8 ${w}`} />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonCard>
          <div className="space-y-4">
            <Skeleton round className="h-3 w-40" />
            <Skeleton className="h-56 w-full" />
          </div>
        </SkeletonCard>
      </div>
    );
  }

  if (variant === "board") {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="space-y-3">
            <Skeleton round className="h-3 w-24" />
            {Array.from({ length: 3 - (col % 2) }).map((_, i) => (
              <SkeletonCard key={i} className="p-4">
                <div className="space-y-3">
                  <SkeletonText lines={2} />
                  <div className="flex gap-2">
                    <Skeleton round className="h-5 w-14" />
                    <Skeleton round className="h-5 w-10" />
                  </div>
                </div>
              </SkeletonCard>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} className="p-4">
          <div className="flex items-center gap-4">
            <Skeleton round className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton round className="h-3 w-40 max-w-full" />
              <Skeleton round className="h-2.5 w-64 max-w-full" />
            </div>
            <Skeleton round className="hidden h-6 w-20 sm:block" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

export function PageSkeleton({
  variant = "list",
  label = "Carregando",
  actions = true,
}: {
  variant?: Variant;
  label?: string;
  actions?: boolean;
}) {
  return (
    <SkeletonRegion label={`${label}…`} className="space-y-8">
      <Header actions={actions} />
      <Body variant={variant} />
    </SkeletonRegion>
  );
}
