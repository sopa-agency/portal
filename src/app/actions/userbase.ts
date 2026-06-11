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
  /** Instagram handle from userbase_identities (type "instagram") — used for cross-posting/collabs. */
  instagram: string | null;
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
    .select("user_id, type, handle")
    .in("user_id", userIds);

  if (identityError) {
    return { ok: false, error: identityError.message || "Failed to query identities" };
  }

  const identitiesCountByUser = new Map<string, number>();
  const instagramByUser = new Map<string, string>();
  for (const row of identityRows ?? []) {
    const uid = row.user_id as string;
    identitiesCountByUser.set(uid, (identitiesCountByUser.get(uid) ?? 0) + 1);
    if (row.type === "instagram" && row.handle) instagramByUser.set(uid, row.handle as string);
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
        instagram: instagramByUser.get(id) ?? null,
      };
    })
    .sort((a, b) => (a.emailLinkedAt < b.emailLinkedAt ? 1 : -1));

  return { ok: true, users, total: users.length };
}

// ---------------------------------------------------------------------------
// Editing — portal users can attach an Instagram handle to a userbase account
// (powers IG cross-posting / collab tagging). Stored as a userbase_identities
// row (type "instagram"), the same convention skatehive3.0 already uses.
// ---------------------------------------------------------------------------

async function editGate(): Promise<string> {
  const { cookies } = await import("next/headers");
  const { SESSION_COOKIE, verifySession } = await import("@/lib/auth");
  const { getActiveProject } = await import("@/projects/index");
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) throw new Error("Unauthorized");
  return session.username;
}

export async function setUserbaseInstagram(
  userId: string,
  handle: string,
): Promise<{ ok: true; instagram: string | null } | { ok: false; error: string }> {
  try {
    await editGate();
    const client = getUserbaseClient();
    if (!client) return { ok: false, error: "Supabase userbase not configured." };

    const clean = handle
      .trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "")
      .trim()
      .toLowerCase();
    if (clean && !/^[a-z0-9._]{1,30}$/.test(clean)) {
      return { ok: false, error: "Invalid Instagram handle." };
    }

    const { data: existing, error: findError } = await client
      .from("userbase_identities")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "instagram")
      .maybeSingle();
    if (findError) return { ok: false, error: findError.message };

    if (!clean) {
      if (existing) {
        const { error } = await client.from("userbase_identities").delete().eq("id", existing.id);
        if (error) return { ok: false, error: error.message };
      }
      return { ok: true, instagram: null };
    }

    if (existing) {
      const { error } = await client
        .from("userbase_identities")
        .update({ handle: clean })
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await client
        .from("userbase_identities")
        .insert({ user_id: userId, type: "instagram", handle: clean, is_primary: false });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, instagram: clean };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// User detail card — full database row + identities, and on-demand Hive /
// Farcaster profile lookups for the card's tabs.
// ---------------------------------------------------------------------------

export type UserbaseIdentity = {
  type: string;
  handle: string | null;
  address: string | null;
  externalId: string | null;
  isPrimary: boolean;
  verifiedAt: string | null;
};

export type UserbaseUserDetail = {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  location: string | null;
  status: string | null;
  onboardingStep: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  emails: { email: string; linkedAt: string }[];
  identities: UserbaseIdentity[];
};

export async function getUserbaseUserDetail(
  userId: string,
): Promise<{ ok: true; user: UserbaseUserDetail } | { ok: false; error: string }> {
  try {
    await editGate();
    const client = getUserbaseClient();
    if (!client) return { ok: false, error: "Supabase userbase not configured." };

    const [userRes, identRes, emailRes] = await Promise.all([
      client.from("userbase_users").select("*").eq("id", userId).maybeSingle(),
      client
        .from("userbase_identities")
        .select("type, handle, address, external_id, is_primary, verified_at")
        .eq("user_id", userId)
        .order("type"),
      client
        .from("userbase_auth_methods")
        .select("identifier, created_at")
        .eq("user_id", userId)
        .eq("type", "email_magic")
        .order("created_at", { ascending: false }),
    ]);
    if (userRes.error) return { ok: false, error: userRes.error.message };
    if (!userRes.data) return { ok: false, error: "User not found." };
    const u = userRes.data;

    return {
      ok: true,
      user: {
        id: u.id,
        handle: u.handle ?? null,
        displayName: u.display_name ?? null,
        avatarUrl: u.avatar_url ?? null,
        coverUrl: u.cover_url ?? null,
        bio: u.bio ?? null,
        location: u.location ?? null,
        status: u.status ?? null,
        onboardingStep: u.onboarding_step ?? null,
        createdAt: u.created_at ?? null,
        updatedAt: u.updated_at ?? null,
        emails: (emailRes.data ?? []).map((r) => ({ email: r.identifier as string, linkedAt: r.created_at as string })),
        identities: (identRes.data ?? []).map((r) => ({
          type: r.type as string,
          handle: (r.handle as string | null) ?? null,
          address: (r.address as string | null) ?? null,
          externalId: (r.external_id as string | null) ?? null,
          isPrimary: !!r.is_primary,
          verifiedAt: (r.verified_at as string | null) ?? null,
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type HiveInfo = {
  username: string;
  about: string | null;
  location: string | null;
  reputation: number | null;
  postCount: number | null;
  followers: number | null;
  following: number | null;
  created: string | null;
};

export async function getHiveInfo(
  username: string,
): Promise<{ ok: true; info: HiveInfo } | { ok: false; error: string }> {
  try {
    await editGate();
    const res = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "bridge.get_profile",
        params: { account: username.toLowerCase() },
        id: 1,
      }),
      cache: "no-store",
    });
    const json = (await res.json()) as {
      result?: {
        name: string;
        created: string;
        post_count: number;
        reputation: number;
        stats?: { followers?: number; following?: number };
        metadata?: { profile?: { about?: string; location?: string } };
      };
      error?: { message?: string };
    };
    if (!json.result) return { ok: false, error: json.error?.message ?? `Hive account @${username} not found.` };
    const r = json.result;
    return {
      ok: true,
      info: {
        username: r.name,
        about: r.metadata?.profile?.about ?? null,
        location: r.metadata?.profile?.location ?? null,
        reputation: r.reputation ?? null,
        postCount: r.post_count ?? null,
        followers: r.stats?.followers ?? null,
        following: r.stats?.following ?? null,
        created: r.created ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type FarcasterInfo = {
  fid: number;
  username: string;
  displayName: string | null;
  pfpUrl: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
};

export async function getFarcasterInfo(
  fid: string,
): Promise<{ ok: true; info: FarcasterInfo } | { ok: false; error: string }> {
  try {
    await editGate();
    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) return { ok: false, error: "NEYNAR_API_KEY not set." };
    if (!/^\d+$/.test(fid.trim())) return { ok: false, error: "Invalid fid." };
    const res = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid.trim()}`, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    });
    const json = (await res.json()) as {
      users?: Array<{
        fid: number;
        username: string;
        display_name?: string;
        pfp_url?: string;
        profile?: { bio?: { text?: string } };
        follower_count?: number;
        following_count?: number;
      }>;
    };
    const u = json.users?.[0];
    if (!u) return { ok: false, error: `Farcaster user fid ${fid} not found.` };
    return {
      ok: true,
      info: {
        fid: u.fid,
        username: u.username,
        displayName: u.display_name ?? null,
        pfpUrl: u.pfp_url ?? null,
        bio: u.profile?.bio?.text ?? null,
        followers: u.follower_count ?? null,
        following: u.following_count ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
      /**
       * True when Paragraph's list API returned fewer subscribers than its own
       * count endpoint — their alpha cursor can't paginate past null-createdAt
       * rows (bug reported), so "missing"/badges UNDERCOUNT in that state.
       */
      partial: boolean;
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

    const [pub, listing, local] = await Promise.all([
      getPublication(apiKey),
      listAllSubscribers(apiKey),
      listUsersWithEmail(),
    ]);
    if (!local.ok) return { ok: false, error: local.error };

    const onParagraph = new Set(listing.items.map((s) => s.email?.toLowerCase()).filter(Boolean));
    const { prisma } = await import("@/lib/prisma");
    const prefs = await prisma.newsletterPref.findMany({ select: { email: true, subscribed: true } });
    const optedOut = new Set(prefs.filter((p) => !p.subscribed).map((p) => p.email.toLowerCase()));
    // Known opt-ins (checkbox/sync) supplement the list when Paragraph's
    // pagination can't enumerate everyone (see `partial`).
    const optedIn = prefs.filter((p) => p.subscribed).map((p) => p.email.toLowerCase());
    const eligible = [...new Set(local.users.map((u) => u.email.toLowerCase()))].filter((e) => !optedOut.has(e));
    const missing = eligible.filter((e) => !onParagraph.has(e)).length;
    const paragraphCount = await getSubscriberCount(pub.id);

    return {
      ok: true,
      configured: true,
      publication: pub.name,
      paragraphCount,
      userbaseEmails: eligible.length,
      missing,
      subscribedEmails: [...new Set([...onParagraph, ...optedIn])] as string[],
      partial: !listing.complete,
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

    const [listing, local] = await Promise.all([listAllSubscribers(apiKey), listUsersWithEmail()]);
    if (!local.ok) return { ok: false, error: local.error };

    const onParagraph = new Set(listing.items.map((s) => s.email?.toLowerCase()).filter(Boolean));
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
