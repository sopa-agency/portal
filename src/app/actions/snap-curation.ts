"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { brandEnv } from "@/lib/brand-env";
import { HIVE_NODES } from "@/lib/social-publish";
import { getUserbaseClient } from "@/lib/supabase-userbase";
import { listSkatehiveVideos } from "@/app/actions/skatehive-media";
import { buildPostUrl } from "@/lib/skatehive-content";
import { BOOST_LEVELS, type BoostLevel, type CurationSnap } from "@/lib/snap-curation-shared";

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project };
}

const castHashOf = (author: string, permlink: string) => `hive:${author}/${permlink}`;

/** Recent SkateHive snaps for the curation inbox, with any boost status. */
export async function listSnapsForCuration(): Promise<
  { ok: true; snaps: CurationSnap[]; project: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;

  const res = await listSkatehiveVideos();
  if (!res.ok) return res;
  // One card per snap post (a post can yield several video entries → dedupe,
  // keeping the first clip as the thumbnail).
  const seen = new Set<string>();
  const snaps = res.videos
    .filter((v) => v.source === "snap")
    .filter((v) => {
      const k = `${v.author}/${v.permlink}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 40);

  const hashes = snaps.map((s) => castHashOf(s.author, s.permlink));
  const targets = await prisma.trailBoostTarget
    .findMany({ where: { castHash: { in: hashes } } })
    .catch(() => []);
  const byHash = new Map(targets.map((t) => [t.castHash, t]));

  return {
    ok: true,
    project: g.project.name,
    snaps: snaps.map((s) => {
      const t = byHash.get(castHashOf(s.author, s.permlink));
      return {
        id: `${s.author}/${s.permlink}`,
        author: s.author,
        permlink: s.permlink,
        title: s.title,
        votes: s.votes,
        payout: s.payout,
        url: `https://peakd.com/@${s.author}/${s.permlink}`,
        thumbnail: s.url, // IPFS video URL → first frame as reference
        created: s.created,
        boost: t ? { budget: t.budget, released: t.released, status: t.status } : null,
      };
    }),
  };
}

/** Recent top-level blog/magazine posts from the project's Hive community,
 * with any boost status. Same reply/boost actions as snaps (generic Hive post). */
export async function listBlogPostsForCuration(): Promise<
  { ok: true; posts: CurationSnap[]; project: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const community = g.project.hive.community;
  if (!community) return { ok: false, error: "Sem comunidade Hive configurada neste portal." };

  let raw: HiveRankedPost[];
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "bridge.get_ranked_posts", params: { sort: "created", tag: community, limit: 20, observer: "" }, id: 1 }),
      cache: "no-store",
    });
    raw = ((await res.json()) as { result?: HiveRankedPost[] }).result ?? [];
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao buscar posts da Hive." };
  }

  const frontend = g.project.hive.frontend;
  const hashes = raw.map((p) => castHashOf(p.author, p.permlink));
  const targets = await prisma.trailBoostTarget.findMany({ where: { castHash: { in: hashes } } }).catch(() => []);
  const byHash = new Map(targets.map((t) => [t.castHash, t]));

  const posts: CurationSnap[] = raw.map((p) => {
    let meta: { image?: string[] } = {};
    try {
      meta = typeof p.json_metadata === "string" ? JSON.parse(p.json_metadata) : (p.json_metadata ?? {});
    } catch {
      meta = {};
    }
    const t = byHash.get(castHashOf(p.author, p.permlink));
    return {
      id: `${p.author}/${p.permlink}`,
      author: p.author,
      permlink: p.permlink,
      title: p.title || "(sem título)",
      votes: p.stats?.total_votes ?? p.net_votes ?? 0,
      payout: parseFloat(p.pending_payout_value ?? "0") || 0,
      url: buildPostUrl(p.author, p.permlink, frontend),
      thumbnail: meta.image?.[0] ?? "",
      created: p.created ?? "",
      boost: t ? { budget: t.budget, released: t.released, status: t.status } : null,
    };
  });
  return { ok: true, posts, project: g.project.name };
}

type HiveRankedPost = {
  author: string;
  permlink: string;
  title?: string;
  created?: string;
  net_votes?: number;
  stats?: { total_votes?: number };
  pending_payout_value?: string;
  json_metadata?: string | { image?: string[] };
};

/** Reply to a snap as this portal's Hive account (HITL — never automatic). */
export async function replyToSnap(
  author: string,
  permlink: string,
  body: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const text = body.trim();
  if (!text) return { ok: false, error: "Resposta vazia." };

  const account = brandEnv(g.project, "HIVE_POSTING_ACCOUNT");
  const key = brandEnv(g.project, "HIVE_POSTING_KEY");
  if (!account || !key) return { ok: false, error: "Hive não conectado neste portal (falta posting key)." };

  const childPermlink = `re-${permlink}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 255);
  try {
    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);
    await client.broadcast.sendOperations(
      [
        [
          "comment",
          {
            parent_author: author,
            parent_permlink: permlink,
            author: account,
            permlink: childPermlink,
            title: "",
            body: text,
            json_metadata: JSON.stringify({ app: `Marketing Portal ${g.project.name}`, tags: [g.project.hive.community ?? "hive"] }),
          },
        ] as never,
      ],
      PrivateKey.fromString(key),
    );
    return { ok: true, url: `https://peakd.com/@${account}/${childPermlink}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao comentar no Hive." };
  }
}

// ---------------------------------------------------------------------------
// Boost — queue a subset of the SkateHive userbase to upvote this snap. The
// existing Pool B worker (trail-userbase-boost) drains the queue proportionally
// to real upvote growth, spaced with random pauses (organic pacing).
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHT = Math.max(1, Math.min(10000, Number(process.env.TRAIL_BOOST_WEIGHT ?? 1000)));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function boostSnap(
  author: string,
  permlink: string,
  level: BoostLevel,
  baselineVotes = 0,
): Promise<{ ok: true; queued: number; budget: number } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;

  const lvl = BOOST_LEVELS.find((l) => l.value === level) ?? BOOST_LEVELS[0];
  const castHash = castHashOf(author, permlink);

  const existing = await prisma.trailBoostTarget.findUnique({ where: { castHash } }).catch(() => null);
  if (existing && existing.status === "active") {
    return { ok: false, error: "Esse snap já está sendo impulsionado." };
  }

  const ub = getUserbaseClient();
  if (!ub) return { ok: false, error: "Userbase não configurada (SUPABASE_USERBASE_URL)." };

  // Consent-aware voter pool (opted-in only), with each voter's own weight.
  let rows: { hive_username: string; trail_vote_weight?: number | null }[] = [];
  const filtered = await ub
    .from("userbase_hive_keys")
    .select("hive_username, trail_vote_weight")
    .or("trail_opt_out.is.null,trail_opt_out.eq.false")
    .limit(2000);
  if (filtered.error) {
    const all = await ub.from("userbase_hive_keys").select("hive_username").limit(2000);
    rows = (all.data ?? []) as typeof rows;
  } else {
    rows = (filtered.data ?? []) as typeof rows;
  }

  const pick = shuffle(rows.filter((r) => r.hive_username)).slice(0, lvl.voters);
  if (!pick.length) return { ok: false, error: "Nenhuma conta da userbase disponível para boost." };

  await prisma.trailUserbaseBoost.createMany({
    data: pick.map((r) => ({
      castHash,
      hiveUsername: r.hive_username,
      weight: typeof r.trail_vote_weight === "number" ? r.trail_vote_weight : DEFAULT_WEIGHT,
      status: "pending",
    })),
    skipDuplicates: true,
  });

  await prisma.trailBoostTarget.upsert({
    where: { castHash },
    create: { castHash, baselineVotes: Math.max(0, baselineVotes), budget: pick.length, released: 0, status: "active" },
    update: { budget: pick.length, baselineVotes: Math.max(0, baselineVotes), status: "active" },
  });

  return { ok: true, queued: pick.length, budget: pick.length };
}
