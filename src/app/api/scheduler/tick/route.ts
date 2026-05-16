// Scheduler tick endpoint. The PM2 worker calls this on every poll so we can
// reuse one process for both job claiming and scheduled publishing. Hive and
// Farcaster server actions are invoked from inside the Next runtime where they
// already have access to env vars and the Prisma singleton.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  publishTweetToFarcaster,
  publishTweetToHive,
  type SchedulablePlatform,
  type TweetStateMap,
} from "@/app/actions/repo-to-social";

export const dynamic = "force-dynamic";

const SHARED_SECRET = process.env.SCHEDULER_TICK_SECRET;
const MAX_PER_TICK = 5;

function authorized(req: Request): boolean {
  if (!SHARED_SECRET) return true;
  const header = req.headers.get("x-scheduler-secret");
  return header === SHARED_SECRET;
}

type DueItem = {
  runId: string;
  tweetIndex: number;
  platform: SchedulablePlatform;
};

async function findDueItems(now: number): Promise<DueItem[]> {
  const runs = await prisma.repoToSocialRun.findMany({
    where: { tweetStates: { not: undefined } },
    select: { id: true, tweetStates: true },
  });

  const due: DueItem[] = [];
  for (const r of runs) {
    const states =
      r.tweetStates && typeof r.tweetStates === "object" && !Array.isArray(r.tweetStates)
        ? (r.tweetStates as unknown as TweetStateMap)
        : null;
    if (!states) continue;
    for (const [key, entry] of Object.entries(states)) {
      const scheduled = entry.scheduledFor;
      if (!scheduled) continue;
      for (const p of ["hive", "farcaster"] as const) {
        const whenISO = scheduled[p];
        if (!whenISO) continue;
        if (entry.publishedTo?.[p]) continue;
        const t = Date.parse(whenISO);
        if (Number.isNaN(t) || t > now) continue;
        due.push({ runId: r.id, tweetIndex: Number(key), platform: p });
      }
    }
  }
  return due;
}

async function clearScheduled(
  runId: string,
  tweetIndex: number,
  platform: SchedulablePlatform,
) {
  const run = await prisma.repoToSocialRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const states =
    run.tweetStates && typeof run.tweetStates === "object" && !Array.isArray(run.tweetStates)
      ? (run.tweetStates as unknown as TweetStateMap)
      : {};
  const key = String(tweetIndex);
  const entry = states[key];
  if (!entry?.scheduledFor?.[platform]) return;
  const nextScheduled = { ...entry.scheduledFor };
  delete nextScheduled[platform];
  const nextEntry = { ...entry };
  if (Object.keys(nextScheduled).length === 0) {
    delete nextEntry.scheduledFor;
  } else {
    nextEntry.scheduledFor = nextScheduled;
  }
  const next = { ...states, [key]: nextEntry };
  await prisma.repoToSocialRun.update({
    where: { id: runId },
    data: { tweetStates: next as unknown as object },
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const due = (await findDueItems(now)).slice(0, MAX_PER_TICK);

  const results: Array<{
    runId: string;
    tweetIndex: number;
    platform: SchedulablePlatform;
    ok: boolean;
    error?: string;
  }> = [];

  for (const item of due) {
    try {
      const result =
        item.platform === "hive"
          ? await publishTweetToHive(item.runId, item.tweetIndex)
          : await publishTweetToFarcaster(item.runId, item.tweetIndex);
      // publishTweetTo* already records publishedTo via recordPublish, but the
      // scheduledFor entry is still hanging around — clear it so the UI flips.
      if (result.ok) await clearScheduled(item.runId, item.tweetIndex, item.platform);
      results.push({ ...item, ok: result.ok, error: result.error });
    } catch (err) {
      results.push({
        ...item,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ checkedAt: new Date(now).toISOString(), processed: results });
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await findDueItems(Date.now());
  return NextResponse.json({ pendingDue: due.length });
}
