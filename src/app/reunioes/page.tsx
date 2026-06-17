import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listMeetings } from "@/app/actions/meetings";
import { listSharedCalendars } from "@/app/actions/shared-calendars";
import { MeetingsCalendar } from "@/components/meetings-calendar";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const project = await getActiveProject();
  if (!project.meetings) notFound();
  const [mRes, cRes] = await Promise.all([
    listMeetings().catch(() => null),
    listSharedCalendars().catch(() => null),
  ]);
  return (
    <MeetingsCalendar
      initialMeetings={mRes?.ok ? mRes.meetings : []}
      initialCalendars={cRes?.ok ? cRes.calendars : []}
      accent={project.theme.accentDark}
    />
  );
}
