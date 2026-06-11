"use server";

import { getUserbaseClient } from "@/lib/supabase-userbase";

export type UserbaseEmailUser = {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string | null;
  onboardingStep: number | null;
  email: string;
  emailLinkedAt: string;
  createdAt: string | null;
  identitiesCount: number;
};

export type UserbaseEmailListResult =
  | { ok: true; users: UserbaseEmailUser[]; total: number }
  | { ok: false; error: string };

export async function listUsersWithEmail(): Promise<UserbaseEmailListResult> {
  const client = getUserbaseClient();
  if (!client) {
    return {
      ok: false,
      error:
        "Supabase userbase not configured. Set SUPABASE_USERBASE_URL and SUPABASE_USERBASE_SERVICE_ROLE_KEY in .env.local.",
    };
  }

  const { data: authRows, error: authError } = await client
    .from("userbase_auth_methods")
    .select("user_id, identifier, created_at")
    .eq("type", "email_magic")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (authError) {
    return { ok: false, error: authError.message || "Failed to query auth methods" };
  }
  if (!authRows || authRows.length === 0) {
    return { ok: true, users: [], total: 0 };
  }

  // Dedupe by user_id, keep most-recent email per user (rows are already DESC by created_at).
  const emailByUser = new Map<string, { email: string; emailLinkedAt: string }>();
  for (const row of authRows) {
    if (!row.user_id || !row.identifier) continue;
    if (emailByUser.has(row.user_id)) continue;
    emailByUser.set(row.user_id, {
      email: row.identifier as string,
      emailLinkedAt: row.created_at as string,
    });
  }

  const userIds = Array.from(emailByUser.keys());

  const { data: userRows, error: userError } = await client
    .from("userbase_users")
    .select("id, handle, display_name, avatar_url, status, onboarding_step, created_at")
    .in("id", userIds);

  if (userError) {
    return { ok: false, error: userError.message || "Failed to query users" };
  }

  const { data: identityRows, error: identityError } = await client
    .from("userbase_identities")
    .select("user_id")
    .in("user_id", userIds);

  if (identityError) {
    return { ok: false, error: identityError.message || "Failed to query identities" };
  }

  const identitiesCountByUser = new Map<string, number>();
  for (const row of identityRows ?? []) {
    const uid = row.user_id as string;
    identitiesCountByUser.set(uid, (identitiesCountByUser.get(uid) ?? 0) + 1);
  }

  const usersById = new Map<string, NonNullable<typeof userRows>[number]>();
  for (const u of userRows ?? []) usersById.set(u.id as string, u);

  const users: UserbaseEmailUser[] = userIds
    .map((id) => {
      const u = usersById.get(id);
      const email = emailByUser.get(id)!;
      return {
        id,
        handle: (u?.handle as string | null) ?? null,
        displayName: (u?.display_name as string | null) ?? null,
        avatarUrl: (u?.avatar_url as string | null) ?? null,
        status: (u?.status as string | null) ?? null,
        onboardingStep: (u?.onboarding_step as number | null) ?? null,
        email: email.email,
        emailLinkedAt: email.emailLinkedAt,
        createdAt: (u?.created_at as string | null) ?? null,
        identitiesCount: identitiesCountByUser.get(id) ?? 0,
      };
    })
    .sort((a, b) => (a.emailLinkedAt < b.emailLinkedAt ? 1 : -1));

  return { ok: true, users, total: users.length };
}

// ---------------------------------------------------------------------------
// Paragraph (paragraph.com) — subscriber sync for the newsletter publication.
// ---------------------------------------------------------------------------

export type ParagraphSyncStatus =
  | {
      ok: true;
      configured: true;
      publication: string;
      paragraphCount: number;
      userbaseEmails: number;
      missing: number;
      /** Lowercased emails currently subscribed on Paragraph — drives the per-user badge. */
      subscribedEmails: string[];
    }
  | { ok: true; configured: false }
  | { ok: false; error: string };

/** Compare the userbase email list against Paragraph's subscriber list. */
export async function getParagraphSyncStatus(): Promise<ParagraphSyncStatus> {
  try {
    const { getActiveProject } = await import("@/projects/index");
    const project = await getActiveProject();
    const { paragraphApiKey, getPublication, getSubscriberCount, listAllSubscribers } = await import("@/lib/paragraph");
    const apiKey = paragraphApiKey(project);
    if (!apiKey) return { ok: true, configured: false };

    const [pub, list, local] = await Promise.all([
      getPublication(apiKey),
      listAllSubscribers(apiKey),
      listUsersWithEmail(),
    ]);
    if (!local.ok) return { ok: false, error: local.error };

    const onParagraph = new Set(list.map((s) => s.email?.toLowerCase()).filter(Boolean));
    const { prisma } = await import("@/lib/prisma");
    const optedOut = new Set(
      (await prisma.newsletterPref.findMany({ where: { subscribed: false }, select: { email: true } })).map((r) =>
        r.email.toLowerCase(),
      ),
    );
    const eligible = [...new Set(local.users.map((u) => u.email.toLowerCase()))].filter((e) => !optedOut.has(e));
    const missing = eligible.filter((e) => !onParagraph.has(e)).length;

    return {
      ok: true,
      configured: true,
      publication: pub.name,
      paragraphCount: await getSubscriberCount(pub.id),
      userbaseEmails: eligible.length,
      missing,
      subscribedEmails: [...onParagraph] as string[],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Push userbase emails that aren't on Paragraph yet (opt-outs excluded). */
export async function syncUserbaseToParagraph(): Promise<
  { ok: true; added: number } | { ok: false; error: string }
> {
  try {
    const { getActiveProject } = await import("@/projects/index");
    const project = await getActiveProject();
    const { paragraphApiKey, listAllSubscribers, addSubscriber } = await import("@/lib/paragraph");
    const apiKey = paragraphApiKey(project);
    if (!apiKey) return { ok: false, error: "Paragraph API key not configured for this project." };

    const [list, local] = await Promise.all([listAllSubscribers(apiKey), listUsersWithEmail()]);
    if (!local.ok) return { ok: false, error: local.error };

    const onParagraph = new Set(list.map((s) => s.email?.toLowerCase()).filter(Boolean));
    const { prisma } = await import("@/lib/prisma");
    const optedOut = new Set(
      (await prisma.newsletterPref.findMany({ where: { subscribed: false }, select: { email: true } })).map((r) =>
        r.email.toLowerCase(),
      ),
    );

    const seen = new Set<string>();
    let added = 0;
    for (const u of local.users) {
      const email = u.email.trim().toLowerCase();
      if (!email || seen.has(email) || optedOut.has(email) || onParagraph.has(email)) continue;
      seen.add(email);
      await addSubscriber(apiKey, { email, createdAt: new Date(u.emailLinkedAt).getTime() });
      added++;
      await new Promise((r) => setTimeout(r, 120)); // stay under their rate limit
    }
    return { ok: true, added };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
