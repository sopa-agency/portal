/**
 * Loading placeholders.
 *
 * Two rules keep these from looking like a second, worse UI:
 *  - a placeholder occupies the same box the real content will, so nothing
 *    jumps when the data lands;
 *  - one shimmer, one speed, everywhere — mismatched pulses read as jank.
 *
 * The shimmer keyframe lives in globals.css so both themes drive it from their
 * own tokens instead of a hardcoded grey.
 */

type SkeletonProps = {
  className?: string;
  /**
   * Fully rounded: pills for text lines and chips, circles for avatars.
   * It is a prop and not a `rounded-full` in `className` on purpose — both are
   * plain utilities, so the winner is decided by their order in the generated
   * stylesheet, and `rounded-lg` happens to win. Passing it here picks exactly
   * one radius and leaves nothing to chance.
   */
  round?: boolean;
};

export function Skeleton({ className = "", round }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton-shimmer ${round ? "rounded-full" : "rounded-lg"} ${className}`}
    />
  );
}

/** A run of text lines, last one short so it reads as a paragraph, not a block. */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          round
          className={`h-3 ${i === lines - 1 ? "w-2/5" : i % 2 ? "w-4/5" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** Surface + border matching the real cards, so the swap is a fill, not a reflow. */
export function SkeletonCard({ className = "", children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>
      {children ?? (
        <div className="space-y-3">
          <Skeleton round className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton round className="h-2.5 w-16" />
        </div>
      )}
    </div>
  );
}

/**
 * Announces the wait to screen readers once, instead of leaving them with a
 * silent page. The shimmer itself is aria-hidden — it carries no information.
 */
export function SkeletonRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
