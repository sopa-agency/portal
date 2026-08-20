import "server-only";
import { prisma } from "@/lib/prisma";

// Briefing recipient emails live in the PRIVATE database, never in code — they
// are PII (team members' personal addresses) and must not ship in the repo,
// least of all a public one. Stored as TeamMemberContact rows with the
// "briefing-email" label (public:false by default, so they never leak).
export async function getTeamEmails(projectSlug: string): Promise<string[]> {
  const rows = await prisma.teamMemberContact.findMany({
    where: { projectSlug, label: "briefing-email" },
    select: { value: true },
    orderBy: { value: "asc" },
  });
  return rows.map((r) => r.value);
}
