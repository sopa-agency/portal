/**
 * "Live" marker for data that is read on every load rather than stored.
 *
 * It sits where the treasury header used to repeat the total the hero card
 * already shows in full size. The number was the loudest thing on the page
 * twice over; this says the one thing the hero cannot — that what you are
 * looking at was fetched just now.
 */
export function LiveBadge({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
    >
      {/* The ring is drawn by .live-dot's ::after, so the solid dot keeps its
          own size and only the halo scales. */}
      <span className="live-dot relative inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
