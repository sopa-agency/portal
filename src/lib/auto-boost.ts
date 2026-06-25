import { prisma } from "@/lib/prisma";
import { listSkatehiveVideos } from "@/app/actions/skatehive-media";
import { queueBoost, castHashOf } from "@/lib/boost-core";

// Auto-boost rule: when the operator account (default @xvlad) upvotes a SkateHive
// snap or community blog post, automatically queue a MEDIUM boost. Runs from the
// hourly cron. Idempotent + "only going forward": the first run records the
// posts already liked as seen-but-not-boosted, so only NEW likes get boosted.

const TRIGGER = (process.env.AUTO_BOOST_VOTE_ACCOUNT || "xvlad").toLowerCase();
const SKATEHIVE_COMMUNITY = "hive-173115";
const INIT = "__init__";

type RankedPost = { author: string; permlink: string; net_votes?: number; active_votes?: { voter?: string }[] };

async function recentBlogWithVoters(): Promise<{ author: string; permlink: string; voters: string[] }[]> {
  const res = await fetch("https://api.hive.blog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "bridge.get_ranked_posts",
      params: { sort: "created", tag: SKATEHIVE_COMMUNITY, limit: 20, observer: "" },
      id: 1,
    }),
    cache: "no-store",
  });
  const raw = ((await res.json()) as { result?: RankedPost[] }).result ?? [];
  return raw.map((p) => ({
    author: p.author,
    permlink: p.permlink,
    voters: (p.active_votes ?? []).map((v) => v.voter).filter((v): v is string => !!v),
  }));
}

export async function autoBoostFromVotes(): Promise<{
  ok: boolean;
  firstRun: boolean;
  boosted: { castHash: string; kind: string }[];
  scanned: number;
  error?: string;
}> {
  try {
    const initRow = await prisma.autoBoostSeen.findUnique({ where: { castHash: INIT } }).catch(() => null);
    const firstRun = !initRow;

    const liked = (voters: string[]) => voters.some((v) => v.toLowerCase() === TRIGGER);
    const candidates: { author: string; permlink: string; kind: "snap" | "blog" }[] = [];

    // Snaps (deduped per post).
    const snapRes = await listSkatehiveVideos(null, { force: false });
    let snapScanned = 0;
    if (snapRes.ok) {
      const seen = new Set<string>();
      for (const v of snapRes.videos) {
        if (v.source !== "snap") continue;
        const key = `${v.author}/${v.permlink}`;
        if (seen.has(key)) continue;
        seen.add(key);
        snapScanned++;
        if (liked(v.voters)) candidates.push({ author: v.author, permlink: v.permlink, kind: "snap" });
      }
    }

    // Community blog posts.
    const blog = await recentBlogWithVoters().catch(() => []);
    for (const p of blog) {
      if (liked(p.voters)) candidates.push({ author: p.author, permlink: p.permlink, kind: "blog" });
    }

    const boosted: { castHash: string; kind: string }[] = [];
    for (const c of candidates) {
      const castHash = castHashOf(c.author, c.permlink);
      const already = await prisma.autoBoostSeen.findUnique({ where: { castHash } }).catch(() => null);
      if (already) continue; // handled in a previous run

      const target = await prisma.trailBoostTarget.findUnique({ where: { castHash } }).catch(() => null);
      const hasActiveBoost = target?.status === "active";

      let didBoost = false;
      // First run = backfill: record current likes as seen WITHOUT boosting.
      if (!firstRun && !hasActiveBoost) {
        const r = await queueBoost({ author: c.author, permlink: c.permlink, level: "medium", kind: c.kind });
        didBoost = r.ok;
        if (r.ok) boosted.push({ castHash, kind: c.kind });
      }
      await prisma.autoBoostSeen
        .create({ data: { castHash, kind: c.kind, boosted: didBoost, voter: TRIGGER } })
        .catch(() => {});
    }

    if (firstRun) {
      await prisma.autoBoostSeen.create({ data: { castHash: INIT, kind: "init", voter: TRIGGER } }).catch(() => {});
    }

    return { ok: true, firstRun, boosted, scanned: snapScanned + blog.length };
  } catch (err) {
    return { ok: false, firstRun: false, boosted: [], scanned: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
