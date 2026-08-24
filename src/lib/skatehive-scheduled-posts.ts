import "server-only";

// ---------------------------------------------------------------------------
// External trigger for SkateHive's scheduled posts (skatehive3.0 PR #135).
//
// SkateHive's processor does NOT fire itself on the cadence it needs — it waits
// to be poked. This portal's hourly cron is the poke. If this stops working,
// scheduled posts simply never publish: the user sees a post queued, the time
// passes, and nothing happens and nothing errors. That is the whole reason the
// failure handling below is loud instead of tidy.
//
// Contract, documented in the processor itself:
//   POST https://skatehive.app/api/userbase/hive/scheduled-posts/process
//   Authorization: Bearer <SkateHive's CRON_SECRET>
//   body: { "source": "<=40 chars" }
//
// The secret is SKATEHIVE's, not ours. Do NOT reuse process.env.CRON_SECRET —
// that one authenticates Vercel → this portal. This one authenticates this
// portal → SkateHive. Same name over there, different value, different system.
// ---------------------------------------------------------------------------

const DEFAULT_URL = "https://skatehive.app/api/userbase/hive/scheduled-posts/process";

/** Broadcasting to Hive can be slow; this runs last in the tick, so a long wait
 *  costs nothing that already ran. */
const TIMEOUT_MS = Number(process.env.SKATEHIVE_SCHEDULED_TIMEOUT_MS ?? 60_000);

export type SkatehiveDispatch =
  | { ok: true; status: number; response: string }
  | { ok: false; reason: "not_configured" | "http" | "network"; detail: string; status?: number };

/**
 * Poke SkateHive's scheduled-post processor.
 *
 * Deliberately NOT gated behind the per-hour SchedulerLease claim. Two reasons:
 *  1. The claim can be won by the OTHER deployment carrying this cron (the
 *     sunset marketing-portal), whose code does not have this dispatch. Gating
 *     would mean: the other side claims the hour, we skip, nobody pokes, and
 *     the scheduled post silently misses its slot.
 *  2. It doesn't need the claim. The processor claims each row itself
 *     ("PREMISE: there are TWO trigger sources") and keeps its own heartbeat,
 *     so being poked twice in an hour is safe by design.
 *
 * Never throws: the caller is the cron, and a SkateHive outage must not take
 * down auto-boost, snapshots or the publisher with it.
 */
export async function dispatchSkatehiveScheduledPosts(source = "sopa-portal-hourly"): Promise<SkatehiveDispatch> {
  const url = (process.env.SKATEHIVE_SCHEDULED_POSTS_URL ?? DEFAULT_URL).replace(/\/+$/, "");
  const secret = process.env.SKATEHIVE_CRON_SECRET?.trim();

  // Missing config is the SILENT-INERTNESS case, so it screams like a failure
  // rather than returning a tidy "skipped". A feature that is deployed but can
  // never run is worse than one that is visibly broken.
  if (!secret) {
    const detail =
      "SKATEHIVE_CRON_SECRET is not set — SkateHive scheduled posts are NOT being processed by this portal. " +
      "Every post a user schedules will sit in the queue past its time and publish nothing, with no error shown to them. " +
      "Set it in Vercel → Settings → Environment Variables (Production) to SkateHive's CRON_SECRET.";
    console.error(`[skatehive-scheduled] NOT CONFIGURED — ${detail}`);
    return { ok: false, reason: "not_configured", detail };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: source.slice(0, 40) }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[skatehive-scheduled] DISPATCH FAILED (network) — ${url}: ${detail}. Due posts did NOT publish this hour.`);
    return { ok: false, reason: "network", detail };
  }

  // The processor puts the ran/skipped detail in the RESPONSE BODY, not in its
  // stdout — so log the body verbatim or the information is simply lost.
  const body = (await res.text().catch(() => "")).slice(0, 600);

  if (!res.ok) {
    console.error(
      `[skatehive-scheduled] DISPATCH FAILED (HTTP ${res.status}) — ${url}: ${body}. Due posts did NOT publish this hour.` +
        (res.status === 401 ? " 401 means SKATEHIVE_CRON_SECRET does not match SkateHive's CRON_SECRET." : ""),
    );
    return { ok: false, reason: "http", detail: body, status: res.status };
  }

  console.log(`[skatehive-scheduled] ok (HTTP ${res.status}) — ${body}`);
  return { ok: true, status: res.status, response: body };
}
