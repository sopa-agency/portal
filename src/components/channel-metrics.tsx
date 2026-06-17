"use client";

import { useEffect, useState } from "react";
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  PlugZap,
  Eye,
  Target,
  Heart,
  MessageCircle,
  Repeat2,
  MessageSquare,
  Bookmark,
  Share2,
  Clock,
  Coins,
  ArrowBigUp,
  Activity,
  ImageIcon,
  Film,
  Megaphone,
} from "lucide-react";
import type { ChannelMetrics } from "@/lib/social-metrics";

// Meta Business Suite target for boosting/promoting a post. Facebook permalinks
// open the post itself inside Business Suite (admin view has "Boost post");
// Instagram (and anything else) opens Business Suite's published-posts list,
// where the post can be selected and boosted.
function metaSuiteBoostUrl(url?: string): string {
  if (url && /(^|\.)facebook\.com/.test(url)) {
    return url.replace(/^https?:\/\/(www\.|web\.|m\.|business\.)?facebook\.com/, "https://business.facebook.com");
  }
  return "https://business.facebook.com/latest/posts/published_posts";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelativeDate(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

function formatEngagementValue(label: string, value: number): string {
  if (label === "HBD") return value.toFixed(2);
  if (label === "avg watch (s)") return `${value}s`;
  return formatNumber(value);
}

/** Map known engagement labels to a lucide icon component */
function EngagementIcon({ label }: { label: string }) {
  const cls = "h-3.5 w-3.5 shrink-0 text-foreground-subtle";
  switch (label.toLowerCase()) {
    case "views":
      return <Eye className={cls} />;
    case "reach":
      return <Target className={cls} />;
    case "likes":
      return <Heart className={cls} />;
    case "comments":
      return <MessageCircle className={cls} />;
    case "recasts":
      return <Repeat2 className={cls} />;
    case "replies":
      return <MessageSquare className={cls} />;
    case "saved":
      return <Bookmark className={cls} />;
    case "shares":
      return <Share2 className={cls} />;
    case "avg watch (s)":
      return <Clock className={cls} />;
    case "hbd":
      return <Coins className={cls} />;
    case "votes":
      return <ArrowBigUp className={cls} />;
    case "interactions":
      return <Activity className={cls} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Post thumbnail
// ---------------------------------------------------------------------------

function PostThumbnail({
  src,
  isReel,
}: {
  src?: string;
  isReel?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated">
        {isReel ? (
          <Film className="h-5 w-5 text-foreground-faint" />
        ) : (
          <ImageIcon className="h-5 w-5 text-foreground-faint" />
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}

// ---------------------------------------------------------------------------
// WoW badge — week-over-week % change
// ---------------------------------------------------------------------------

function WoWBadge({ pct }: { pct?: number | null }) {
  if (pct === undefined || pct === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-foreground-faint">
        — WoW
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-success">
        ▲{pct}% WoW
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-danger">
        ▼{Math.abs(pct)}% WoW
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-foreground-faint">
      — WoW
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MetricsSkeleton() {
  return (
    <div className="animate-pulse space-y-4 rounded-2xl border border-border bg-surface p-5">
      {/* KPI card row skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-surface-elevated px-4 py-3"
          >
            <div className="h-2.5 w-14 rounded bg-border-strong" />
            <div className="mt-2 h-7 w-20 rounded bg-border-strong" />
            <div className="mt-1 h-2 w-12 rounded bg-border-strong" />
          </div>
        ))}
      </div>

      {/* Recent posts skeleton */}
      <div className="space-y-2">
        <div className="h-2.5 w-24 rounded bg-border-strong" />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-surface-elevated px-4 py-3"
          >
            <div className="flex items-center gap-3">
              {/* Thumbnail placeholder */}
              <div className="h-14 w-14 shrink-0 rounded-lg bg-border-strong" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-4">
                  <div className="h-3 w-1/2 rounded bg-border-strong" />
                  <div className="h-3 w-10 rounded bg-border-strong" />
                </div>
                <div className="mt-2 flex gap-4">
                  <div className="h-2.5 w-12 rounded bg-border-strong" />
                  <div className="h-2.5 w-12 rounded bg-border-strong" />
                  <div className="h-2.5 w-12 rounded bg-border-strong" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not-connected card
// ---------------------------------------------------------------------------

function NotConnected({ help }: { help?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-surface px-5 py-5">
      <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-foreground-faint" />
      <div>
        <p className="text-sm font-medium text-foreground-muted">Not connected</p>
        {help && (
          <p className="mt-1 text-xs leading-5 text-foreground-subtle">{help}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------

function MetricsError({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-3">
      <p className="text-sm text-danger">
        Metrics unavailable{message ? `: ${message}` : "."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delta badge — used inside the Followers KPI card
// ---------------------------------------------------------------------------

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-foreground-faint">
        <Minus className="h-3 w-3" />
        — 7d
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-foreground-subtle">
        <Minus className="h-3 w-3" />
        +0 / 7d
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-success">
        <TrendingUp className="h-3 w-3" />
        +{formatNumber(delta)} / 7d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-danger">
      <TrendingDown className="h-3 w-3" />
      {formatNumber(delta)} / 7d
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI stat-card row
// ---------------------------------------------------------------------------

type KpiCard = {
  label: string;
  value: string;
  isFollowers?: boolean;
  deltaPct?: number | null;
  sub?: string;
};

function KpiCardGrid({
  cards,
  followersDelta,
}: {
  cards: KpiCard[];
  followersDelta: number | null;
}) {
  // Choose column count: 1 card → don't stretch, use max-w; 2 → cols-2; 3-4 → cols-2 sm:cols-4
  const count = cards.length;
  const gridClass =
    count === 1
      ? "flex"
      : count === 2
        ? "grid grid-cols-2 gap-3"
        : "grid grid-cols-2 gap-3 sm:grid-cols-4";

  return (
    <div className={gridClass}>
      {cards.map((card) => (
        <div
          key={card.label}
          className={[
            "rounded-xl border border-border bg-surface-elevated px-4 py-3",
            count === 1 ? "w-48" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
            {card.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {card.value}
          </p>
          {card.isFollowers ? (
            <div className="mt-1">
              <DeltaBadge delta={followersDelta} />
            </div>
          ) : (
            <div className="mt-1 flex flex-col gap-0.5">
              {"deltaPct" in card && <WoWBadge pct={card.deltaPct} />}
              {card.sub && (
                <span className="text-[10px] text-foreground-subtle">{card.sub}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent posts section
// ---------------------------------------------------------------------------

function RecentPosts({
  posts,
}: {
  posts: Extract<ChannelMetrics, { ok: true }>["posts"];
}) {
  if (posts.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
        Recent posts
      </p>
      <ul className="space-y-1.5">
        {posts.map((post, i) => (
          <li
            key={i}
            className="rounded-xl border border-border bg-surface-elevated px-4 py-3 transition-colors hover:border-border-strong"
          >
            <div className="flex items-start gap-3">
              {/* Thumbnail */}
              <PostThumbnail src={post.thumbnail} />

              {/* Content — flex-1 */}
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                {/* Rank badge */}
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-border text-[10px] font-semibold tabular-nums text-foreground-subtle">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {post.url ? (
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-accent"
                    >
                      <span className="truncate">
                        {post.title?.slice(0, 70) || "Post"}
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-foreground-subtle" />
                    </a>
                  ) : (
                    <p className="truncate text-sm font-medium text-foreground">
                      {post.title?.slice(0, 70) || "Post"}
                    </p>
                  )}

                  {/* Engagement metrics row */}
                  {post.engagements.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {post.engagements.map((e) => (
                        <span
                          key={e.label}
                          className="inline-flex items-center gap-1 text-xs tabular-nums text-foreground-muted"
                        >
                          <EngagementIcon label={e.label} />
                          {formatEngagementValue(e.label, e.value)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Boost / promote in Meta Business Suite (IG + FB only) */}
                  {post.url && /(facebook|instagram)\.com/.test(post.url) && (
                    <a
                      href={metaSuiteBoostUrl(post.url)}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir no Meta Business Suite para impulsionar"
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-bg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
                    >
                      <Megaphone className="h-3 w-3" /> Promover
                    </a>
                  )}
                </div>
              </div>

              {/* Relative date */}
              <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-foreground-subtle">
                {formatRelativeDate(post.at)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live metrics layout
// ---------------------------------------------------------------------------

function LiveMetrics({ data }: { data: Extract<ChannelMetrics, { ok: true }> }) {
  // Build KPI card list: Followers always first, then highlights
  const kpiCards: KpiCard[] = [
    {
      label: "Followers",
      value: data.followers !== null ? formatNumber(data.followers) : "—",
      isFollowers: true,
    },
    ...(data.highlights ?? []).map((h) => ({
      label: h.label,
      value: h.value,
      deltaPct: h.deltaPct,
      sub: h.sub,
    })),
  ];

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface p-5">
      {/* KPI cards */}
      <KpiCardGrid cards={kpiCards} followersDelta={data.followersDelta7d} />

      {/* Recent posts */}
      <RecentPosts posts={data.posts} />

      {/* Footer */}
      <p className="text-[10px] tabular-nums text-foreground-faint">
        Updated {formatRelativeDate(data.fetchedAt)} · cached 10 min
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function ChannelMetrics({ platform }: { platform: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "done"; data: ChannelMetrics }
    | { status: "fetch-error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/socials/metrics?platform=${encodeURIComponent(platform)}`)
      .then(async (res) => {
        const json = (await res.json()) as ChannelMetrics;
        if (!cancelled) setState({ status: "done", data: json });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: "fetch-error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  if (state.status === "loading") return <MetricsSkeleton />;
  if (state.status === "fetch-error") return <MetricsError message={state.message} />;

  const { data } = state;
  if (!data.ok && data.reason === "not-connected") return <NotConnected help={data.help} />;
  if (!data.ok) return <MetricsError message={data.error} />;
  return <LiveMetrics data={data} />;
}
