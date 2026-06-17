import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listMeetings } from "@/app/actions/meetings";
import { listSharedCalendars } from "@/app/actions/shared-calendars";
import { getTeamRoster } from "@/lib/team-roster";
import { MeetingsCalendar } from "@/components/meetings-calendar";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const project = await getActiveProject();
  if (!project.meetings) notFound();
  const [mRes, cRes, roster] = await Promise.all([
    listMeetings().catch(() => null),
    listSharedCalendars().catch(() => null),
    getTeamRoster(project).catch(() => []),
  ]);
  // Centralized team registry → the invite picker (members + their email).
  const teamRoster = roster.map((m) => ({ username: m.username, email: m.email, avatarUrl: m.avatarUrl }));
  return (
    <MeetingsCalendar
      initialMeetings={mRes?.ok ? mRes.meetings : []}
      initialCalendars={cRes?.ok ? cRes.calendars : []}
      teamRoster={teamRoster}
      accent={project.theme.accentDark}
    />
  );
}
