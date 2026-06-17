import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { prisma } from "@/lib/prisma";
import { listMeetings } from "@/app/actions/meetings";
import { listSharedCalendars } from "@/app/actions/shared-calendars";
import { MeetingsCalendar } from "@/components/meetings-calendar";

export const dynamic = "force-dynamic";

export default async function ReunioesPage() {
  const project = await getActiveProject();
  if (!project.meetings) notFound();
  const [mRes, cRes, contacts] = await Promise.all([
    listMeetings().catch(() => null),
    listSharedCalendars().catch(() => null),
    prisma.teamMemberContact.findMany({ where: { projectSlug: project.slug, label: "Email" }, select: { value: true } }).catch(() => []),
  ]);
  const teamEmails = [...new Set(contacts.map((c) => c.value.trim()).filter((v) => /@/.test(v)))].sort();
  return (
    <MeetingsCalendar
      initialMeetings={mRes?.ok ? mRes.meetings : []}
      initialCalendars={cRes?.ok ? cRes.calendars : []}
      teamEmails={teamEmails}
      accent={project.theme.accentDark}
    />
  );
}
