import "server-only";
import { prisma } from "@/lib/prisma";
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
};

export async function getTeamRoster(project: ProjectConfig): Promise<RosterMember[]> {
  const rows = await prisma.teamMemberContact
    .findMany({ where: { username: { in: project.allowlist } } })
    .catch(() => [] as { projectSlug: string; username: string; label: string; value: string; updatedAt: Date }[]);
  const byUser = resolveCrossPortalContacts(rows, project.slug);
  const frontend = project.hive.frontend ?? "https://peakd.com";
  return project.allowlist.map((username) => {
    const contacts = mergeContacts(project.teamContacts?.[username] ?? [], byUser.get(username) ?? []);
    const emailRaw = contacts.find((c) => c.label.toLowerCase() === "email")?.value?.trim();
    return {
      username,
      avatarUrl: `https://images.hive.blog/u/${username}/avatar`,
      profileUrl: `${frontend}/@${username}`,
      email: emailRaw && /@/.test(emailRaw) ? emailRaw.toLowerCase() : null,
      contacts,
    };
  });
}

/** Roster members that have a usable email (for invites / availability). */
export async function getTeamEmails(project: ProjectConfig): Promise<{ username: string; email: string }[]> {
  const roster = await getTeamRoster(project);
  return roster.flatMap((m) => (m.email ? [{ username: m.username, email: m.email }] : []));
}
