import { notFound } from "next/navigation";
import { getActiveProject, getAllProjects } from "@/projects";
import { listMeetings } from "@/app/actions/meetings";
import { listSharedCalendars } from "@/app/actions/shared-calendars";
import { getTeamRoster } from "@/lib/team-roster";
import { MeetingsCalendar } from "@/components/meetings-calendar";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const project = await getActiveProject();
  if (!project.meetings) notFound();

  // Every meeting belongs to a project → load each project's roster so the
  // invite picker can scope attendees to the selected project's members.
  const all = getAllProjects();
  const rosters = await Promise.all(all.map((p) => getTeamRoster(p).catch(() => [])));
  const normGh = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/^@/, "").replace(/\/.*$/, "");
  const projects = all.map((p, i) => ({
    slug: p.slug,
    name: p.name,
    members: rosters[i].map((m) => ({
      username: m.username,
      email: m.email,
      avatarUrl: m.avatarUrl,
      github: (() => { const g = m.contacts.find((c) => c.label === "GitHub")?.value; return g ? normGh(g) : null; })(),
    })),
  }));

  const [mRes, cRes] = await Promise.all([
    listMeetings().catch(() => null),
    listSharedCalendars().catch(() => null),
  ]);
  return (
    <MeetingsCalendar
      initialMeetings={mRes?.ok ? mRes.meetings : []}
      initialCalendars={cRes?.ok ? cRes.calendars : []}
      projects={projects}
      defaultProject={project.slug}
      accent={project.theme.accentDark}
    />
  );
}
