import "server-only";

// ---------------------------------------------------------------------------
// Outreach audience resolution — shared by the controlled email-delivery
// actions (src/app/actions/outreach.ts).
//
// Recipients come from the GLOBAL Supabase userbase (SkateHive app accounts with
// a linked email); subscription state is the opt-out NewsletterPref model in our
// Neon db. On top of that, "inactive" is derived from Hive activity: there is no
// engagement signal in the userbase itself (`status` is ~100% "active",
// `onboarding_step` always 0), so we read condenser_api.get_accounts.last_post
// (last post OR comment). A recipient is inactive when they have no Hive handle
// (email-only signup → never posted), their handle isn't a Hive account, or their
// last activity is older than the cutoff (never-posted accounts report 1970).
// ---------------------------------------------------------------------------

export const INACTIVE_CUTOFF_DAYS = 90;

export type OutreachAudienceMode = "inactive" | "all_subscribed";
export type OutreachRecipient = { email: string; handle: string | null };

/** Subscribed userbase pool (email + real Hive handle), opt-outs removed. */
export async function resolveSubscribedPool(): Promise<OutreachRecipient[]> {
  const { listUsersWithEmail } = await import("@/app/actions/userbase");
  const res = await listUsersWithEmail();
  if (!res.ok) throw new Error(res.error);

  const seen = new Map<string, OutreachRecipient>();
  for (const u of res.users) {
    const email = u.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.set(email, { email, handle: u.handle });
  }

  const { prisma } = await import("@/lib/prisma");
  const optedOut = await prisma.newsletterPref.findMany({
    where: { subscribed: false },
    select: { email: true },
  });
  for (const { email } of optedOut) seen.delete(email.toLowerCase());
  return [...seen.values()];
}

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
        out.set(acc.name.toLowerCase(), Number.isFinite(ms) ? ms : 0);
      }
    } catch {
      // A failed batch leaves those handles unknown → treated as inactive below.
    }
  }
  return out;
}

/** True when a handle has NO Hive activity within the cutoff (or none at all). */
function isInactive(handle: string | null, lastActivity: Map<string, number>, cutoff: number): boolean {
  if (!handle) return true; // email-only signup → never posted
  const last = lastActivity.get(handle.toLowerCase());
  if (last === undefined) return true; // not a resolvable Hive account
  return last < cutoff; // last post/comment older than the cutoff (1970 = never)
}

/**
 * Resolve the outreach audience. `all_subscribed` = the full opt-in pool;
 * `inactive` = that pool filtered to dormant Hive accounts (the win-back target).
 * Returns { pool, audience } so callers can show "N of M".
 */
export async function resolveOutreachAudience(
  mode: OutreachAudienceMode,
): Promise<{ pool: OutreachRecipient[]; audience: OutreachRecipient[] }> {
  const pool = await resolveSubscribedPool();
  if (mode === "all_subscribed") return { pool, audience: pool };

  const handles = pool.map((r) => r.handle).filter((h): h is string => !!h);
  const lastActivity = await hiveLastActivity(handles);
  const cutoff = Date.now() - INACTIVE_CUTOFF_DAYS * 86_400_000;
  const audience = pool.filter((r) => isInactive(r.handle, lastActivity, cutoff));
  return { pool, audience };
}
