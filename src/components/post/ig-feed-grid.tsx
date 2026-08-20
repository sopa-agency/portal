"use client";

import { Images, Film, Clock } from "lucide-react";

export type FeedCell = {
  id: string;
  thumb: string | null;
  isVideo: boolean;
  isCarousel: boolean;
  isReel: boolean;
  status?: "scheduled" | "published" | "draft";
  /** Highlight ring (e.g. the post being composed). */
  highlight?: boolean;
};

/**
 * Instagram profile feed grid — 3 columns, square cells, newest first. Shared by
 * the Post Creator's "grid" preview (how the post sits in the feed) and the
 * calendar's feed view (the whole scheduled/published feed).
 */
export function IgFeedGrid({
  cells,
  onOpen,
  className = "",
}: {
  cells: FeedCell[];
  onOpen?: (id: string) => void;
  className?: string;
}) {
  if (cells.length === 0) {
    return <p className={`py-8 text-center text-xs text-foreground-faint ${className}`}>Sem posts no feed ainda.</p>;
  }
  return (
    <div className={`grid grid-cols-3 gap-0.5 ${className}`}>
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen?.(c.id)}
          disabled={!onOpen}
          className={`group relative aspect-square overflow-hidden bg-surface-elevated ${onOpen ? "cursor-pointer" : "cursor-default"} ${c.highlight ? "ring-2 ring-inset ring-accent" : ""}`}
          title={c.status === "scheduled" ? "Agendado" : c.status === "published" ? "Publicado" : undefined}
        >
          {c.thumb ? (
            c.isVideo ? (
              // #t=0.1 makes the browser seek + paint the first frame as a poster
              // (remote/IPFS videos otherwise render blank with just preload=metadata).
              <video
                src={c.thumb.includes("#t=") ? c.thumb : `${c.thumb}#t=0.1`}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={c.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-foreground-faint">
              <Images className="h-5 w-5 opacity-40" />
            </div>
          )}

          {/* type indicator (top-right) */}
          {(c.isCarousel || c.isReel || c.isVideo) && (
            <span className="absolute right-1 top-1 text-white drop-shadow">
              {c.isReel || c.isVideo ? <Film className="h-3.5 w-3.5" /> : <Images className="h-3.5 w-3.5" />}
            </span>
          )}
          {/* scheduled badge (bottom-left) */}
          {c.status === "scheduled" && (
            <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold text-white">
              <Clock className="h-2.5 w-2.5" /> agendado
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
