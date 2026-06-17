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
  profileUrl: string;
  /** First contact labelled "Email" (validated), or null. */
  email: string | null;
  contacts: TeamContact[];
  /** True for cross-portal admins (GLOBAL_ALLOWLIST) shown in every portal. */
  global: boolean;
};

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
  return usernames.map((username) => {
    const contacts = mergeContacts(project.teamContacts?.[username] ?? [], byUser.get(username) ?? []);
    const emailRaw = contacts.find((c) => c.label.toLowerCase() === "email")?.value?.trim();
    return {
      username,
      avatarUrl: `https://images.hive.blog/u/${username}/avatar`,
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
