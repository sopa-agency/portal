// Server-only: live social metrics fetcher with in-memory TTL cache and
// DB-backed follower snapshots for 7-day delta computation.
import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";
import { prisma } from "@/lib/prisma";
import { HIVE_NODES } from "@/lib/social-publish";
import { buildPostUrl } from "@/lib/skatehive-content";

export type PostMetric = {
  title?: string;
  url?: string;
  at: string;
  thumbnail?: string;
  engagements: { label: string; value: number }[];
};

export type HighlightItem = {
  label: string;
  value: string;
  /** Week-over-week % change (positive = up, negative = down, null = no prior data) */
  deltaPct?: number | null;
  /** Small caption line, e.g. "86% non-followers" */
  sub?: string;
};

export type ChannelMetrics =
  | {
      ok: true;
      followers: number | null;
      followersDelta7d: number | null;
      /** Account-level highlight stats (e.g. 7-day reach), pre-formatted. */
      highlights?: HighlightItem[];
      posts: PostMetric[];
      fetchedAt: string;
    }
  | {
      ok: false;
      reason: "not-connected" | "error";
      help?: string;
      error?: string;
    };

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

type CacheEntry = { data: ChannelMetrics; expires: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheGet(key: string): ChannelMetrics | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: ChannelMetrics): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// DB snapshot helpers
// ---------------------------------------------------------------------------

const SNAPSHOT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DELTA_WINDOW_MIN_DAYS = 6;
const DELTA_WINDOW_MAX_DAYS = 9;

async function computeDeltaAndMaybeSnapshot(
  projectSlug: string,
  platform: string,
  followers: number,
): Promise<number | null> {
  try {
    // 1. Compute delta from the nearest snapshot ~7 days ago.
    const now = new Date();
    const windowStart = new Date(now.getTime() - DELTA_WINDOW_MAX_DAYS * 86400_000);
    const windowEnd = new Date(now.getTime() - DELTA_WINDOW_MIN_DAYS * 86400_000);

    const oldSnapshot = await prisma.socialMetricSnapshot.findFirst({
      where: {
        projectSlug,
        platform,
        capturedAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { capturedAt: "desc" },
    });

    const delta = oldSnapshot != null ? followers - oldSnapshot.followers : null;

    // 2. Maybe write a new snapshot (at most once per 6h).
    const latestSnapshot = await prisma.socialMetricSnapshot.findFirst({
      where: { projectSlug, platform },
      orderBy: { capturedAt: "desc" },
    });

    const shouldWrite =
      !latestSnapshot ||
      now.getTime() - latestSnapshot.capturedAt.getTime() > SNAPSHOT_MIN_INTERVAL_MS;

    if (shouldWrite) {
      await prisma.socialMetricSnapshot.create({
        data: { projectSlug, platform, followers },
      });
    }

    return delta;
  } catch {
    // DB unavailable — skip gracefully, return null delta.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      abort.signal.addEventListener("abort", () => reject(new Error("Request timed out"))),
    ),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Hive
// ---------------------------------------------------------------------------

type RawHivePost = {
  title?: string;
  permlink?: string;
  author?: string;
  created?: string;
  children?: number;
  stats?: { total_votes?: number };
  active_votes?: unknown[];
  pending_payout_value?: string;
  payout?: number;
  json_metadata?: string;
};

function mapHivePosts(rawPosts: RawHivePost[] | undefined, fallbackAuthor: string, project: ProjectConfig): PostMetric[] {
  return (rawPosts ?? []).map((p) => {
    const payout =
      (p.payout ?? 0) > 0
        ? p.payout!
        : parseFloat(p.pending_payout_value ?? "0") || 0;
    const votes = p.stats?.total_votes ?? (p.active_votes?.length ?? 0);
    const comments = p.children ?? 0;
    // Link via the project's official frontend (skatehive.app for the
    // SkateHive/Gnars/Reelflip portals), not the universal peakd fallback.
    const url = buildPostUrl(p.author ?? fallbackAuthor, p.permlink ?? "", project.hive.frontend);

    // Best-effort thumbnail from json_metadata
    let thumbnail: string | undefined;
    try {
      if (p.json_metadata) {
        const meta = JSON.parse(p.json_metadata) as { image?: string[] };
        if (Array.isArray(meta.image) && meta.image[0]) {
          thumbnail = meta.image[0];
        }
      }
    } catch {
      // ignore parse errors
    }

    return {
      title: p.title ?? undefined,
      url,
      at: p.created ?? new Date().toISOString(),
      thumbnail,
      engagements: [
        { label: "HBD", value: Math.round(payout * 100) / 100 },
        { label: "votes", value: votes },
        { label: "comments", value: comments },
      ],
    };
  });
}

// Community stats (bridge.get_community) — the "Hive status" for portals whose
// presence is the COMMUNITY (e.g. SkateHive) rather than a single @account.
async function fetchHiveCommunityMetrics(
  client: { call(api: string, method: string, params: unknown): Promise<unknown> },
  community: string,
  project: ProjectConfig,
): Promise<ChannelMetrics> {
  const c = (await withTimeout(
    client.call("bridge", "get_community", { name: community, observer: "" }),
    8000,
  )) as { subscribers?: number; num_authors?: number; num_pending?: number; sum_pending?: number };

  const subscribers = c.subscribers ?? 0;
  const followersDelta7d = await computeDeltaAndMaybeSnapshot(project.slug, "hive", subscribers);

  const highlights: HighlightItem[] = [
    { label: "Autores ativos", value: String(c.num_authors ?? 0) },
    { label: "Posts pendentes", value: String(c.num_pending ?? 0) },
    { label: "Recompensas pendentes", value: `$${Math.round(c.sum_pending ?? 0)}`, sub: "HBD" },
  ];

  const rawPosts = (await withTimeout(
    client.call("bridge", "get_ranked_posts", { sort: "created", tag: community, limit: 5, observer: "" }),
    8000,
  )) as RawHivePost[];

  return {
    ok: true,
    followers: subscribers,
    followersDelta7d,
    highlights,
    posts: mapHivePosts(rawPosts, project.hive.account, project),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchHiveMetrics(
  account: string,
  project: ProjectConfig,
): Promise<ChannelMetrics> {
  const { Client } = await import("@hiveio/dhive");
  const client = new Client(HIVE_NODES);

  // SkateHive-style portals surface COMMUNITY stats instead of @account followers.
  if (project.hive.communityStats && project.hive.community) {
    return fetchHiveCommunityMetrics(client, project.hive.community, project);
  }

  // Followers
  const followData = (await withTimeout(
    client.call("condenser_api", "get_follow_count", [account]),
    8000,
  )) as { follower_count: number };
  const followers: number = followData.follower_count;

  // Follower delta + snapshot
  const followersDelta7d = await computeDeltaAndMaybeSnapshot(
    project.slug,
    "hive",
    followers,
  );

  // Recent posts
  const rawPosts = (await withTimeout(
    client.call("bridge", "get_account_posts", { sort: "posts", account, limit: 5 }),
    8000,
  )) as RawHivePost[];

  return {
    ok: true,
    followers,
    followersDelta7d,
    posts: mapHivePosts(rawPosts, account, project),
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Farcaster
// ---------------------------------------------------------------------------

async function fetchFarcasterMetrics(
  username: string,
  project: ProjectConfig,
): Promise<ChannelMetrics> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "not-connected",
      help: "Set NEYNAR_API_KEY to enable Farcaster metrics.",
    };
  }

  const userRes = await withTimeout(
    fetch(
      `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(username)}`,
      {
        headers: { "x-api-key": apiKey, accept: "application/json" },
        cache: "no-store",
      },
    ),
    8000,
  );

  if (!userRes.ok) {
    const txt = await userRes.text().catch(() => "");
    throw new Error(`Neynar user lookup HTTP ${userRes.status}: ${txt.slice(0, 200)}`);
  }

  const userData = (await userRes.json()) as {
    user: {
      fid: number;
      follower_count: number;
      following_count?: number;
      power_badge?: boolean;
      score?: number;
      experimental?: { neynar_user_score?: number };
      verified_addresses?: { eth_addresses?: string[]; sol_addresses?: string[] };
    };
  };
  const u = userData.user;
  const { fid, follower_count } = u;

  const followersDelta7d = await computeDeltaAndMaybeSnapshot(
    project.slug,
    "farcaster",
    follower_count,
  );

  // Account highlights pulled straight from the user object (no extra calls).
  const score = u.score ?? u.experimental?.neynar_user_score;
  const verifiedCount =
    (u.verified_addresses?.eth_addresses?.length ?? 0) + (u.verified_addresses?.sol_addresses?.length ?? 0);
  const highlights: HighlightItem[] = [
    { label: "Seguindo", value: compact(u.following_count ?? 0) },
    { label: "Power Badge", value: u.power_badge ? "✓ ativo" : "—" },
  ];
  if (score != null) highlights.push({ label: "Neynar score", value: score.toFixed(2) });
  if (verifiedCount > 0) highlights.push({ label: "Endereços verif.", value: String(verifiedCount) });

  // Recent casts
  const feedRes = await withTimeout(
    fetch(
      `https://api.neynar.com/v2/farcaster/feed/user/casts?fid=${fid}&limit=5`,
      {
        headers: { "x-api-key": apiKey, accept: "application/json" },
        cache: "no-store",
      },
    ),
    8000,
  );

  let posts: PostMetric[] = [];
  if (feedRes.ok) {
    const feedData = (await feedRes.json()) as {
      casts: Array<{
        hash: string;
        text?: string;
        timestamp?: string;
        reactions?: { likes_count?: number; recasts_count?: number };
        replies?: { count?: number };
        embeds?: Array<{
          url?: string;
          metadata?: { content_type?: string };
        }>;
      }>;
    };
    posts = (feedData.casts ?? []).map((c) => {
      // Best-effort thumbnail from embeds
      let thumbnail: string | undefined;
      try {
        if (Array.isArray(c.embeds)) {
          for (const embed of c.embeds) {
            const url = embed.url ?? "";
            const ct = embed.metadata?.content_type ?? "";
            if (ct.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url)) {
              thumbnail = url;
              break;
            }
          }
        }
      } catch {
        // ignore
      }

      return {
        title: (c.text ?? "").slice(0, 80) || undefined,
        url: `https://warpcast.com/${username}/${c.hash.slice(0, 10)}`,
        at: c.timestamp ?? new Date().toISOString(),
        thumbnail,
        engagements: [
          { label: "likes", value: c.reactions?.likes_count ?? 0 },
          { label: "recasts", value: c.reactions?.recasts_count ?? 0 },
          { label: "replies", value: c.replies?.count ?? 0 },
        ],
      };
    });
  }

  // Average engagement across the recent casts we already fetched.
  if (posts.length > 0) {
    const total = posts.reduce(
      (s, p) => s + p.engagements.reduce((a, e) => a + (typeof e.value === "number" ? e.value : 0), 0),
      0,
    );
    highlights.push({ label: "Engaj. médio", value: compact(Math.round(total / posts.length)), sub: "por cast" });
  }

  return {
    ok: true,
    followers: follower_count,
    followersDelta7d,
    highlights,
    posts,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

async function fetchInstagramMetrics(
  project: ProjectConfig,
): Promise<ChannelMetrics> {
  // Identity credentials: never fall back across brands (see brand-env.ts).
  const token = brandEnv(project, "INSTAGRAM_ACCESS_TOKEN");
  const igid = brandEnv(project, "INSTAGRAM_BUSINESS_ACCOUNT_ID");

  if (!token || !igid) {
    return {
      ok: false,
      reason: "not-connected",
      help: "Add INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID (Meta app + IG business account) to .env.local",
    };
  }

  const accountRes = await withTimeout(
    fetch(
      `https://graph.facebook.com/v21.0/${igid}?fields=followers_count,media_count&access_token=${token}`,
      { cache: "no-store" },
    ),
    8000,
  );
  if (!accountRes.ok) {
    const txt = await accountRes.text().catch(() => "");
    throw new Error(`Instagram Graph API HTTP ${accountRes.status}: ${txt.slice(0, 200)}`);
  }
  const accountData = (await accountRes.json()) as { followers_count: number };
  const followers = accountData.followers_count;

  const followersDelta7d = await computeDeltaAndMaybeSnapshot(
    project.slug,
    "instagram",
    followers,
  );

  // Account-level 7-day insights with WoW deltas. Best-effort.
  let highlights: HighlightItem[] | undefined;
  try {
    const now = Math.floor(Date.now() / 1000);
    const curSince = now - 7 * 86400;
    const curUntil = now;
    const prevSince = now - 14 * 86400;
    const prevUntil = now - 7 * 86400;

    const insightMetrics = "reach,views,accounts_engaged,profile_views";

    // Current 7d + previous 7d in parallel
    const [curRes, prevRes] = await Promise.all([
      withTimeout(
        fetch(
          `https://graph.facebook.com/v21.0/${igid}/insights?metric=${insightMetrics}&period=day&metric_type=total_value&since=${curSince}&until=${curUntil}&access_token=${token}`,
          { cache: "no-store" },
        ),
        8000,
      ),
      withTimeout(
        fetch(
          `https://graph.facebook.com/v21.0/${igid}/insights?metric=${insightMetrics}&period=day&metric_type=total_value&since=${prevSince}&until=${prevUntil}&access_token=${token}`,
          { cache: "no-store" },
        ),
        8000,
      ),
    ]);

    type InsightsResponse = {
      data: Array<{ name: string; total_value?: { value?: number } }>;
    };

    const curData = curRes.ok ? ((await curRes.json()) as InsightsResponse) : null;
    const prevData = prevRes.ok ? ((await prevRes.json()) as InsightsResponse) : null;

    const curByName = new Map(
      (curData?.data ?? []).map((d) => [d.name, d.total_value?.value ?? 0]),
    );
    const prevByName = new Map(
      (prevData?.data ?? []).map((d) => [d.name, d.total_value?.value ?? 0]),
    );

    const highlightDefs: Array<{ metric: string; label: string }> = [
      { metric: "reach", label: "Reach 7d" },
      { metric: "views", label: "Views 7d" },
      { metric: "accounts_engaged", label: "Engaged 7d" },
      { metric: "profile_views", label: "Profile views 7d" },
    ];

    const items: HighlightItem[] = [];
    for (const { metric, label } of highlightDefs) {
      if (!curByName.has(metric)) continue;
      const cur = curByName.get(metric)!;
      const prev = prevByName.get(metric) ?? 0;
      const deltaPct =
        prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
      items.push({ label, value: compact(cur), deltaPct });
    }

    if (items.length > 0) {
      highlights = items;
    }

    // Non-follower reach breakdown — best-effort, separate call
    try {
      const nfRes = await withTimeout(
        fetch(
          `https://graph.facebook.com/v21.0/${igid}/insights?metric=reach&period=day&metric_type=total_value&breakdown=follow_type&since=${curSince}&until=${curUntil}&access_token=${token}`,
          { cache: "no-store" },
        ),
        8000,
      );
      if (nfRes.ok) {
        const nfData = (await nfRes.json()) as {
          data: Array<{
            name: string;
            total_value?: {
              value?: number;
              breakdowns?: Array<{
                results: Array<{ dimension_values: string[]; value: number }>;
              }>;
            };
          }>;
        };
        const breakdownResults =
          nfData.data?.[0]?.total_value?.breakdowns?.[0]?.results;
        if (Array.isArray(breakdownResults)) {
          let nonFollower = 0;
          let totalReach = 0;
          for (const r of breakdownResults) {
            totalReach += r.value;
            if (r.dimension_values.includes("NON_FOLLOWER")) {
              nonFollower = r.value;
            }
          }
          if (totalReach > 0) {
            const pct = Math.round((nonFollower / totalReach) * 100);
            highlights = highlights ?? [];
            highlights.push({
              label: "Non-follower reach 7d",
              value: compact(nonFollower),
              sub: `${pct}% of reach`,
            });
          }
        }
      }
    } catch {
      // non-follower breakdown is optional — skip silently
    }

    // Extra account metrics — total interactions + saves (7d WoW). Separate call
    // so a pruned metric can't wipe the core highlights above.
    try {
      const extra = "total_interactions,saves";
      const [eCurRes, ePrevRes] = await Promise.all([
        withTimeout(fetch(`https://graph.facebook.com/v21.0/${igid}/insights?metric=${extra}&period=day&metric_type=total_value&since=${curSince}&until=${curUntil}&access_token=${token}`, { cache: "no-store" }), 8000),
        withTimeout(fetch(`https://graph.facebook.com/v21.0/${igid}/insights?metric=${extra}&period=day&metric_type=total_value&since=${prevSince}&until=${prevUntil}&access_token=${token}`, { cache: "no-store" }), 8000),
      ]);
      const eCur = eCurRes.ok ? ((await eCurRes.json()) as InsightsResponse) : null;
      const ePrev = ePrevRes.ok ? ((await ePrevRes.json()) as InsightsResponse) : null;
      const ecMap = new Map((eCur?.data ?? []).map((d) => [d.name, d.total_value?.value ?? 0]));
      const epMap = new Map((ePrev?.data ?? []).map((d) => [d.name, d.total_value?.value ?? 0]));
      for (const { metric, label } of [
        { metric: "total_interactions", label: "Interações 7d" },
        { metric: "saves", label: "Salvos 7d" },
      ]) {
        if (!ecMap.has(metric)) continue;
        const cur = ecMap.get(metric)!;
        const prev = epMap.get(metric) ?? 0;
        highlights = highlights ?? [];
        highlights.push({ label, value: compact(cur), deltaPct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null });
      }
    } catch {
      // extra metrics optional — skip silently
    }

    // Reach by format (reels vs feed vs stories), 7d — best-effort.
    try {
      const fRes = await withTimeout(
        fetch(`https://graph.facebook.com/v21.0/${igid}/insights?metric=reach&period=day&metric_type=total_value&breakdown=media_product_type&since=${curSince}&until=${curUntil}&access_token=${token}`, { cache: "no-store" }),
        8000,
      );
      if (fRes.ok) {
        const fData = (await fRes.json()) as {
          data: Array<{ total_value?: { breakdowns?: Array<{ results: Array<{ dimension_values: string[]; value: number }> }> } }>;
        };
        const results = fData.data?.[0]?.total_value?.breakdowns?.[0]?.results;
        if (Array.isArray(results)) {
          const fmt: Record<string, string> = { REELS: "Reach reels", FEED: "Reach feed", STORY: "Reach stories", CAROUSEL_CONTAINER: "Reach carrossel" };
          for (const r of results) {
            const lbl = fmt[r.dimension_values?.[0] ?? ""];
            if (lbl && r.value > 0) {
              highlights = highlights ?? [];
              highlights.push({ label: lbl, value: compact(r.value) });
            }
          }
        }
      }
    } catch {
      // reach-by-format optional — skip silently
    }
  } catch {
    // insights scope/availability optional — skip silently, leave highlights undefined
  }

  // Recent media (incl. thumbnails)
  const mediaRes = await withTimeout(
    fetch(
      `https://graph.facebook.com/v21.0/${igid}/media?fields=caption,permalink,timestamp,thumbnail_url,media_url,media_type,media_product_type,like_count,comments_count&limit=5&access_token=${token}`,
      { cache: "no-store" },
    ),
    8000,
  );

  let posts: PostMetric[] = [];
  if (mediaRes.ok) {
    const mediaData = (await mediaRes.json()) as {
      data: Array<{
        id: string;
        caption?: string;
        permalink?: string;
        timestamp?: string;
        thumbnail_url?: string;
        media_url?: string;
        media_type?: string;
        media_product_type?: string;
        like_count?: number;
        comments_count?: number;
      }>;
    };
    posts = await Promise.all(
      (mediaData.data ?? []).map(async (m) => {
        const isReel = m.media_product_type === "REELS";
        const thumbnail = m.thumbnail_url ?? m.media_url ?? undefined;

        const engagements: { label: string; value: number }[] = [];
        // Per-post insights (reach/views/saved/shares/interactions + reel avg watch). Best-effort.
        try {
          const metrics = isReel
            ? "views,reach,saved,shares,total_interactions,ig_reels_avg_watch_time"
            : "views,reach,saved,shares,total_interactions";
          const r = await withTimeout(
            fetch(
              `https://graph.facebook.com/v21.0/${m.id}/insights?metric=${metrics}&access_token=${token}`,
              { cache: "no-store" },
            ),
            8000,
          );
          if (r.ok) {
            const j = (await r.json()) as {
              data: Array<{ name: string; values?: { value?: number }[] }>;
            };
            const v = new Map(j.data?.map((d) => [d.name, d.values?.[0]?.value ?? 0]));
            // Build in order: views, reach, likes, comments, saved, shares, interactions, avg watch
            if (v.has("views")) engagements.push({ label: "views", value: v.get("views")! });
            if (v.has("reach")) engagements.push({ label: "reach", value: v.get("reach")! });
            engagements.push({ label: "likes", value: m.like_count ?? 0 });
            engagements.push({ label: "comments", value: m.comments_count ?? 0 });
            if (v.has("saved")) engagements.push({ label: "saved", value: v.get("saved")! });
            if (v.has("shares")) engagements.push({ label: "shares", value: v.get("shares")! });
            if (v.has("total_interactions"))
              engagements.push({ label: "interactions", value: v.get("total_interactions")! });
            if (isReel && v.has("ig_reels_avg_watch_time")) {
              engagements.push({
                label: "avg watch (s)",
                value: Math.round((v.get("ig_reels_avg_watch_time")! / 1000) * 10) / 10,
              });
            }
          }
        } catch {
          // fall through to basic likes/comments
        }
        if (engagements.length === 0) {
          engagements.push(
            { label: "likes", value: m.like_count ?? 0 },
            { label: "comments", value: m.comments_count ?? 0 },
          );
        }
        return {
          title: (m.caption ?? "").slice(0, 80) || undefined,
          url: m.permalink ?? undefined,
          at: m.timestamp ?? new Date().toISOString(),
          thumbnail,
          engagements,
        };
      }),
    );
  }

  return {
    ok: true,
    followers,
    followersDelta7d,
    highlights: highlights && highlights.length > 0 ? highlights : undefined,
    posts,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Facebook (Page) — same Meta system-user token as Instagram. The page is
// auto-discovered via /me/accounts (every project token sees exactly its own
// page); set ${PREFIX}_FACEBOOK_PAGE_ID only if a token ever sees several.
// ---------------------------------------------------------------------------

async function fetchFacebookMetrics(project: ProjectConfig): Promise<ChannelMetrics> {
  const prefix = project.agent.gatewayEnvPrefix;
  // Identity credential: never falls back across brands (see brand-env.ts).
  const token = brandEnv(project, "INSTAGRAM_ACCESS_TOKEN");

  if (!token) {
    return {
      ok: false,
      reason: "not-connected",
      help: `Facebook reads use the same Meta token as Instagram — set ${prefix}_INSTAGRAM_ACCESS_TOKEN first`,
    };
  }

  // Page + per-page access token (page endpoints want the page token, not the
  // system-user token).
  const accountsRes = await withTimeout(
    fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,followers_count,fan_count,access_token&access_token=${token}`,
      { cache: "no-store" },
    ),
    8000,
  );
  if (!accountsRes.ok) {
    const txt = await accountsRes.text().catch(() => "");
    throw new Error(`Facebook Graph API HTTP ${accountsRes.status}: ${txt.slice(0, 200)}`);
  }
  const accounts = (await accountsRes.json()) as {
    data: Array<{
      id: string;
      name: string;
      followers_count?: number;
      fan_count?: number;
      access_token?: string;
    }>;
  };
  const wantedId = process.env[`${prefix}_FACEBOOK_PAGE_ID`];
  const page = wantedId
    ? accounts.data?.find((p) => p.id === wantedId)
    : accounts.data?.[0];
  if (!page) {
    return {
      ok: false,
      reason: "not-connected",
      help: `The ${prefix} Meta token sees no Facebook Page — assign the page to the system user and regenerate the token`,
    };
  }
  const pageToken = page.access_token ?? token;
  const followers = page.followers_count ?? page.fan_count ?? null;

  const followersDelta7d =
    followers != null
      ? await computeDeltaAndMaybeSnapshot(project.slug, "facebook", followers)
      : null;

  // Page-level 7-day insights with WoW deltas. Page insights metrics get
  // pruned by Meta regularly — strictly best-effort.
  let highlights: HighlightItem[] | undefined;
  try {
    const now = Math.floor(Date.now() / 1000);
    const windows = [
      { since: now - 7 * 86400, until: now },
      { since: now - 14 * 86400, until: now - 7 * 86400 },
    ];
    const metrics = "page_impressions_unique,page_post_engagements";
    const [cur, prev] = await Promise.all(
      windows.map(async (w) => {
        const r = await withTimeout(
          fetch(
            `https://graph.facebook.com/v21.0/${page.id}/insights?metric=${metrics}&period=day&since=${w.since}&until=${w.until}&access_token=${pageToken}`,
            { cache: "no-store" },
          ),
          8000,
        );
        if (!r.ok) return null;
        const j = (await r.json()) as {
          data: Array<{ name: string; values?: { value?: number }[] }>;
        };
        return new Map(
          (j.data ?? []).map((d) => [
            d.name,
            (d.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0),
          ]),
        );
      }),
    );
    if (cur) {
      const defs = [
        { metric: "page_impressions_unique", label: "Reach 7d" },
        { metric: "page_post_engagements", label: "Engaged 7d" },
      ];
      const items: HighlightItem[] = [];
      for (const { metric, label } of defs) {
        if (!cur.has(metric)) continue;
        const c = cur.get(metric)!;
        const p = prev?.get(metric) ?? 0;
        items.push({
          label,
          value: compact(c),
          deltaPct: p > 0 ? Math.round(((c - p) / p) * 100) : null,
        });
      }
      if (items.length > 0) highlights = items;
    }
  } catch {
    // insights optional — skip silently
  }

  // Extra page metrics — new follows, page views, video views (7d). Separate
  // call so a pruned metric can't wipe the core highlights above.
  try {
    const now2 = Math.floor(Date.now() / 1000);
    const since2 = now2 - 7 * 86400;
    const metrics2 = "page_fan_adds,page_views_total,page_video_views";
    const r = await withTimeout(
      fetch(`https://graph.facebook.com/v21.0/${page.id}/insights?metric=${metrics2}&period=day&since=${since2}&until=${now2}&access_token=${pageToken}`, { cache: "no-store" }),
      8000,
    );
    if (r.ok) {
      const j = (await r.json()) as { data: Array<{ name: string; values?: { value?: number }[] }> };
      const m = new Map((j.data ?? []).map((d) => [d.name, (d.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0)]));
      for (const { metric, label } of [
        { metric: "page_fan_adds", label: "Novos seg. 7d" },
        { metric: "page_views_total", label: "Visitas 7d" },
        { metric: "page_video_views", label: "Video views 7d" },
      ]) {
        if (!m.has(metric)) continue;
        highlights = highlights ?? [];
        highlights.push({ label, value: compact(m.get(metric)!) });
      }
    }
  } catch {
    // extra page metrics optional — skip silently
  }

  // Recent page posts with basic engagement counts.
  let posts: PostMetric[] = [];
  try {
    const postsRes = await withTimeout(
      fetch(
        `https://graph.facebook.com/v21.0/${page.id}/posts?fields=message,permalink_url,created_time,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)&limit=5&access_token=${pageToken}`,
        { cache: "no-store" },
      ),
      8000,
    );
    if (postsRes.ok) {
      const j = (await postsRes.json()) as {
        data: Array<{
          message?: string;
          permalink_url?: string;
          created_time?: string;
          full_picture?: string;
          shares?: { count?: number };
          reactions?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } };
        }>;
      };
      posts = (j.data ?? []).map((p) => ({
        title: (p.message ?? "").slice(0, 80) || undefined,
        url: p.permalink_url,
        at: p.created_time ?? new Date().toISOString(),
        thumbnail: p.full_picture,
        engagements: [
          { label: "reactions", value: p.reactions?.summary?.total_count ?? 0 },
          { label: "comments", value: p.comments?.summary?.total_count ?? 0 },
          { label: "shares", value: p.shares?.count ?? 0 },
        ],
      }));
    }
  } catch {
    // posts optional — page-level numbers still render
  }

  return {
    ok: true,
    followers,
    followersDelta7d,
    highlights,
    posts,
    fetchedAt: new Date().toISOString(),
  };
}

// Compact number formatting for highlight stats (1234 -> "1.2K").
function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// X
// ---------------------------------------------------------------------------

function fetchXMetrics(): ChannelMetrics {
  return {
    ok: false,
    reason: "not-connected",
    help: "X API requires a paid bearer token (set X_BEARER_TOKEN) — metrics unavailable for now",
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function fetchChannelMetrics(
  platform: string,
  account: string | undefined,
  project: ProjectConfig,
): Promise<ChannelMetrics> {
  const key = `${project.slug}:${platform.toLowerCase()}:${account ?? ""}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let result: ChannelMetrics;
  try {
    switch (platform.toLowerCase()) {
      case "hive":
        if (!account) {
          result = { ok: false, reason: "error", error: "No Hive account configured" };
        } else {
          result = await fetchHiveMetrics(account, project);
        }
        break;
      case "farcaster":
        if (!account) {
          result = { ok: false, reason: "error", error: "No Farcaster username configured" };
        } else {
          result = await fetchFarcasterMetrics(account, project);
        }
        break;
      case "instagram":
        result = await fetchInstagramMetrics(project);
        break;
      case "facebook":
        result = await fetchFacebookMetrics(project);
        break;
      case "x":
        result = fetchXMetrics();
        break;
      default:
        result = {
          ok: false,
          reason: "not-connected",
          help: `No metrics integration available for platform "${platform}"`,
        };
    }
  } catch (err) {
    result = {
      ok: false,
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  cacheSet(key, result);
  return result;
}
