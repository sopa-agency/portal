export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { UserbaseTable } from "@/components/userbase-table";
import { listUsersWithEmail, getParagraphSyncStatus } from "@/app/actions/userbase";
import { ParagraphSyncCard } from "@/components/paragraph-sync-card";
import { getActiveProject } from "@/projects";

export default async function UserbasePage() {
  const project = await getActiveProject();
  if (project.hiddenRoutes?.includes("/userbase")) notFound();

  const [result, paragraphStatus] = await Promise.all([listUsersWithEmail(), getParagraphSyncStatus()]);
  const projectName = project.name;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Userbase"
        title="Users with email"
        description={`${projectName} accounts that have linked an email (via the magic-link sign-in). Use this list for email-blast outreach.`}
        status={result.ok ? `${result.total} total` : undefined}
      />

      <ParagraphSyncCard initial={paragraphStatus} />

      {result.ok ? (
        <UserbaseTable
          users={result.users}
          subscribedEmails={
            paragraphStatus.ok && paragraphStatus.configured ? paragraphStatus.subscribedEmails : undefined
          }
        />
      ) : (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-sm text-amber-200">
          <p className="font-medium text-warning">Userbase unavailable</p>
          <p className="mt-1 text-foreground-muted">{result.error}</p>
        </div>
      )}
    </div>
  );
}
