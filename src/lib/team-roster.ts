import "server-only";
import { prisma } from "@/lib/prisma";
import { GLOBAL_ALLOWLIST } from "@/lib/auth";
import { getAllProjects } from "@/projects/index";
import { mergeContacts, resolveCrossPortalContacts } from "@/lib/team-messaging";
import type { ProjectConfig, TeamContact } from "@/projects/types";

// Centralized team registry. The single source of truth for "who is on the
// team and how to reach them", reused across areas (Team tab, Reuniões, …).
// Membership comes from the project allowlist (Hive usernames); contacts merge
// the static config with DB rows resolved ACROSS ALL portals (a value entered
// in one portal carries over, current portal wins) — see resolveCrossPortalContacts.

export type RosterMember = {
  username: string;
  avatarUrl: string;
  /**
   * Whether the Hive account actually set a profile picture. images.hive.blog
   * answers 200 with a generic silhouette for accounts that never did, so an
   * <img> can't tell the difference — only the account metadata can.
   */
  hasAvatar: boolean;
  profileUrl: string;
  /** First contact labelled "Email" (validated), or null. */
  email: string | null;
  contacts: TeamContact[];
  /** True for cross-portal admins (GLOBAL_ALLOWLIST) shown in every portal. */
  global: boolean;
};

const _avatarCache = new Map<string, boolean>();
let _avatarCacheExpires = 0;
const AVATAR_TTL_MS = 60 * 60 * 1000;

/**
 * Which of these Hive accounts set a profile picture, batched into one RPC.
 * On any failure every name comes back `true` — showing the account's real
 * avatar when we're unsure beats replacing good photos with initials.
 */
async function fetchHasAvatar(usernames: string[]): Promise<Map<string, boolean>> {
  const now = Date.now();
  if (now > _avatarCacheExpires) {
    _avatarCache.clear();
    _avatarCacheExpires = now + AVATAR_TTL_MS;
  }
  const missing = usernames.filter((u) => !_avatarCache.has(u));
  if (missing.length) {
    try {
      const res = await fetch(process.env.HIVE_API_URL || "https://api.hive.blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "condenser_api.get_accounts",
          params: [missing],
          id: 1,
        }),
        cache: "no-store",
      });
      const json = (await res.json()) as {
        result?: { name: string; posting_json_metadata?: string; json_metadata?: string }[];
      };
      // Accounts the node didn't return stay unknown, so default them to true.
      for (const u of missing) _avatarCache.set(u, true);
      for (const acc of json.result ?? []) {
        let image: string | undefined;
        // Newer clients write posting_json_metadata; older ones json_metadata.
        for (const key of ["posting_json_metadata", "json_metadata"] as const) {
          try {
            const profile = JSON.parse(acc[key] || "{}")?.profile;
            if (profile?.profile_image) { image = String(profile.profile_image); break; }
          } catch {}
        }
        _avatarCache.set(acc.name, !!image?.trim());
      }
    } catch {
      for (const u of missing) _avatarCache.set(u, true);
    }
  }
  return new Map(usernames.map((u) => [u, _avatarCache.get(u) ?? true]));
}

/** Hive serves every avatar from the same path, so the URL needs no lookup —
 *  only the "did they ever set one?" answer does. */
export function hiveAvatarUrl(username: string): string {
  return `https://images.hive.blog/u/${username}/avatar`;
}

/**
 * Whether a single Hive account has a real profile picture.
 *
 * Exists because Hive answers 200 with a generic silhouette for accounts that
 * never set one, so an <img> onError handler cannot tell the two apart — the
 * question has to be asked of the API.
 *
 * Callers on a hot path should persist the answer rather than ask per render.
 */
export async function resolveHasAvatar(username: string): Promise<boolean> {
  return (await fetchHasAvatar([username])).get(username) ?? true;
}

export async function getTeamRoster(project: ProjectConfig): Promise<RosterMember[]> {
  // Membership = the portal's allowlist + cross-portal admins (GLOBAL_ALLOWLIST),
  // so "who's in Team" matches "who has access".
  const globals = GLOBAL_ALLOWLIST.filter((u) => !project.allowlist.includes(u));
  const usernames = [...project.allowlist, ...globals];
  const rows = await prisma.teamMemberContact
    .findMany({ where: { username: { in: usernames } } })
    .catch(() => [] as { projectSlug: string; username: string; label: string; value: string; updatedAt: Date }[]);
  const byUser = resolveCrossPortalContacts(rows, project.slug);
  const frontend = project.hive.frontend ?? "https://peakd.com";
  const globalSet = new Set(globals);
  const hasAvatar = await fetchHasAvatar(usernames);
  return usernames.map((username) => {
    const contacts = mergeContacts(project.teamContacts?.[username] ?? [], byUser.get(username) ?? []);
    const emailRaw = contacts.find((c) => c.label.toLowerCase() === "email")?.value?.trim();
    return {
      username,
      avatarUrl: hiveAvatarUrl(username),
      hasAvatar: hasAvatar.get(username) ?? true,
      profileUrl: `${frontend}/@${username}`,
      email: emailRaw && /@/.test(emailRaw) ? emailRaw.toLowerCase() : null,
      contacts,
      global: globalSet.has(username),
    };
  });
}

/** Roster members that have a usable email (for invites / availability). */
export async function getTeamEmails(project: ProjectConfig): Promise<{ username: string; email: string }[]> {
  const roster = await getTeamRoster(project);
  return roster.flatMap((m) => (m.email ? [{ username: m.username, email: m.email }] : []));
}

/** Portals a username can access: allowlist membership + global admins. */
export function portalsForUser(username: string): { slug: string; name: string }[] {
  const u = username.toLowerCase();
  const isGlobal = GLOBAL_ALLOWLIST.includes(u);
  return getAllProjects()
    .filter((p) => isGlobal || p.allowlist.includes(u))
    .map((p) => ({ slug: p.slug, name: p.name }));
}
