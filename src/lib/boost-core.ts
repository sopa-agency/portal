import { prisma } from "@/lib/prisma";
import { getUserbaseClient } from "@/lib/supabase-userbase";
import { boostLevelsFor, type BoostLevel, type BoostKind } from "@/lib/snap-curation-shared";

export const castHashOf = (author: string, permlink: string) => `hive:${author}/${permlink}`;

const DEFAULT_WEIGHT = Math.max(1, Math.min(10000, Number(process.env.TRAIL_BOOST_WEIGHT ?? 1000)));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Queue a boost (consent-aware userbase voter pool) for a Hive post. This is the
 * session-less core shared by the `boostSnap` server action (UI) and the cron
 * auto-boost rule. It only ENQUEUES rows in trailUserbaseBoost + records a
 * TrailBoostTarget; the trail-userbase-boost worker casts the actual votes.
 *
 * Idempotent: if the post already has an active boost target it returns without
 * re-queuing, so calling twice is safe.
 */
export async function queueBoost(args: {
  author: string;
  permlink: string;
  level: BoostLevel;
  baselineVotes?: number;
  kind?: BoostKind;
  /** "organic" paces the release to real upvote growth; "direct" releases over
   *  random intervals regardless of likes. */
  mode?: "organic" | "direct";
}): Promise<{ ok: true; queued: number; budget: number } | { ok: false; error: string }> {
  const { author, permlink, level, baselineVotes = 0, kind = "snap", mode = "organic" } = args;
  const levels = boostLevelsFor(kind);
  const lvl = levels.find((l) => l.value === level) ?? levels[0];
  const castHash = castHashOf(author, permlink);

  const existing = await prisma.trailBoostTarget.findUnique({ where: { castHash } }).catch(() => null);
  if (existing && existing.status === "active") {
    return { ok: false, error: "Esse post já está sendo impulsionado." };
  }

  const ub = getUserbaseClient();
  if (!ub) return { ok: false, error: "Userbase não configurada (SUPABASE_USERBASE_URL)." };

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
    create: { castHash, baselineVotes: Math.max(0, baselineVotes), budget: pick.length, released: 0, status: "active", mode },
    update: { budget: pick.length, baselineVotes: Math.max(0, baselineVotes), status: "active", mode },
  });

  return { ok: true, queued: pick.length, budget: pick.length };
}
