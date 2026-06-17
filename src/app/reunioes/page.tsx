import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listMeetings } from "@/app/actions/meetings";
import { MeetingsCalendar } from "@/components/meetings-calendar";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const project = await getActiveProject();
  if (!project.meetings) notFound();
  const res = await listMeetings().catch(() => null);
  const meetings = res?.ok ? res.meetings : [];
  return <MeetingsCalendar initialMeetings={meetings} accent={project.theme.accentDark} />;
}
