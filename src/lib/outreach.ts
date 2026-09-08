import "server-only";

// ---------------------------------------------------------------------------
// Outreach audience resolution — shared by the controlled email-delivery
// actions (src/app/actions/outreach.ts).
//
// Recipients come from the GLOBAL Supabase userbase (SkateHive app accounts with
// a linked email); subscription state is the opt-out NewsletterPref model in our
// Neon db. The userbase has no engagement signal of its own (`status` is ~100%
// "active", `onboarding_step` always 0), so activity comes from Hive:
// condenser_api.get_accounts.last_post (last post OR comment; 1970 = never).
//
// "Inactive" is NOT one group. Measured on 2026-09-08 the subscribed pool was
// 251 emails: 53 handles with no Hive account, 101 accounts that never posted,
// 74 that posted and went quiet for 90+ days, 6 quiet for 30-90 days, 17
// active. A win-back ("we noticed you left") only makes sense for the third
// group, so the audience is resolved per SEGMENT and each campaign targets one.
// ---------------------------------------------------------------------------

import { INACTIVE_CUTOFF_DAYS, type OutreachAudienceMode } from "@/lib/outreach-modes";

export { INACTIVE_CUTOFF_DAYS, OUTREACH_MODE_LABELS, type OutreachAudienceMode } from "@/lib/outreach-modes";

export type OutreachRecipient = {
  email: string;
  handle: string | null;
  displayName: string | null;
  /** Last post/comment epoch ms; 0 = never; null = unknown (no Hive account). */
  lastActivityAt: number | null;
};

/** Subscribed userbase pool (email + real Hive handle), opt-outs removed. */
export async function resolveSubscribedPool(): Promise<OutreachRecipient[]> {
  const { listUsersWithEmail } = await import("@/app/actions/userbase");
  const res = await listUsersWithEmail();
  if (!res.ok) throw new Error(res.error);

  const seen = new Map<string, OutreachRecipient>();
  for (const u of res.users) {
    const email = u.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.set(email, { email, handle: u.handle, displayName: u.displayName, lastActivityAt: null });
  }

  const { prisma } = await import("@/lib/prisma");
  const optedOut = await prisma.newsletterPref.findMany({
    where: { subscribed: false },
    select: { email: true },
  });
  for (const { email } of optedOut) seen.delete(email.toLowerCase());
  return [...seen.values()];
}

// Hive reports "never posted" as 1970-01-01; anything before this is "never".
const NEVER_POSTED_BEFORE = Date.parse("2000-01-01T00:00:00Z");

/** account (lowercased) → last_post epoch ms, batched via condenser_api. */
export async function hiveLastActivity(accounts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(accounts.map((a) => a.toLowerCase()).filter(Boolean))];
  const CHUNK = 100;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const batch = uniq.slice(i, i + CHUNK);
    try {
      const res = await fetch("https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [batch], id: 1 }),
        cache: "no-store",
      });
      const json = (await res.json()) as { result?: { name: string; last_post?: string }[] };
      for (const acc of json.result ?? []) {
        // Hive returns UTC without a timezone suffix — force UTC parsing.
        const ms = acc.last_post ? Date.parse(`${acc.last_post}Z`) : 0;
        out.set(acc.name.toLowerCase(), Number.isFinite(ms) && ms >= NEVER_POSTED_BEFORE ? ms : 0);
      }
    } catch {
      // A failed batch leaves those handles unknown → treated as "no Hive account".
    }
  }
  return out;
}

export type LastRootPost = { title: string; url: string; createdAt: number };

/**
 * The account's most recent root post (not comment): title + link + date, for
 * the "your last post was …" line. null when the account only ever commented
 * or the API is down — the email copy has to read well without it.
 */
export async function hiveLastRootPost(account: string, frontend: string): Promise<LastRootPost | null> {
  try {
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "bridge.get_account_posts",
        params: { sort: "posts", account: account.toLowerCase(), limit: 1 },
        id: 1,
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: { title?: string; author?: string; permlink?: string; created?: string }[] };
    const post = json.result?.[0];
    if (!post?.author || !post.permlink) return null;
    const createdAt = post.created ? Date.parse(`${post.created}Z`) : NaN;
    if (!Number.isFinite(createdAt)) return null;
    return {
      title: (post.title ?? "").trim() || post.permlink,
      url: `${frontend.replace(/\/$/, "")}/@${post.author}/${post.permlink}`,
      createdAt,
    };
  } catch {
    return null;
  }
}

function segmentOf(r: OutreachRecipient, cutoff: number): Exclude<OutreachAudienceMode, "all_subscribed"> | "active" {
  if (!r.handle || r.lastActivityAt === null) return "no_hive";
  if (r.lastActivityAt === 0) return "never_posted";
  return r.lastActivityAt < cutoff ? "lapsed" : "active";
}

/**
 * Resolve the outreach audience for one segment. Returns { pool, audience } so
 * callers can show "N of M". The lapsed segment comes back most-recently-quiet
 * first, so the small warm-up batches reach the people most likely to return.
 */
export async function resolveOutreachAudience(
  mode: OutreachAudienceMode,
): Promise<{ pool: OutreachRecipient[]; audience: OutreachRecipient[] }> {
  const pool = await resolveSubscribedPool();
  if (mode === "all_subscribed") return { pool, audience: pool };

  const handles = pool.map((r) => r.handle).filter((h): h is string => !!h);
  const lastActivity = await hiveLastActivity(handles);
  for (const r of pool) {
    const last = r.handle ? lastActivity.get(r.handle.toLowerCase()) : undefined;
    r.lastActivityAt = last === undefined ? null : last;
  }

  const cutoff = Date.now() - INACTIVE_CUTOFF_DAYS * 86_400_000;
  const audience = pool.filter((r) => segmentOf(r, cutoff) === mode);
  if (mode === "lapsed") audience.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  return { pool, audience };
}
