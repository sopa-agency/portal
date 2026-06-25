export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { UserbaseTable } from "@/components/userbase-table";
import { listUserbaseUsersPage, getParagraphSyncStatus, listThirdwebUsers, isGlobalAdmin } from "@/app/actions/userbase";
import { ParagraphSyncCard } from "@/components/paragraph-sync-card";
import { ThirdwebUserbaseTable } from "@/components/thirdweb-userbase-table";
import { getActiveProject } from "@/projects";

export default async function UserbasePage() {
  const project = await getActiveProject();
  const projectName = project.name;

  const [page, paragraphStatus, thirdweb, canDelete] = await Promise.all([
    listUserbaseUsersPage(),
    getParagraphSyncStatus(),
    listThirdwebUsers(),
    isGlobalAdmin(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Userbase"
        title="Users"
        description={`Every ${projectName} app account — email-linked or wallet/Hive-only. Search and scroll load from the server.`}
        status={page.ok ? `${page.total} total` : undefined}
      />

      <ParagraphSyncCard initial={paragraphStatus} />

      {/* Thirdweb (gnars.com) userbase — only on portals with the secret key. */}
      {thirdweb.configured && thirdweb.ok && <ThirdwebUserbaseTable users={thirdweb.users} />}
      {thirdweb.configured && !thirdweb.ok && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-3 text-sm text-foreground-muted">
          Thirdweb userbase unavailable: {thirdweb.error}
        </div>
      )}

      {page.ok ? (
        <UserbaseTable
          initialUsers={page.users}
          initialCursor={page.nextCursor}
          initialTotal={page.total}
          canDelete={canDelete}
          subscribedEmails={
            paragraphStatus.ok && paragraphStatus.configured ? paragraphStatus.subscribedEmails : undefined
          }
          subscriptionPartial={paragraphStatus.ok && paragraphStatus.configured && paragraphStatus.partial}
        />
      ) : (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 px-5 py-4 text-sm">
          <p className="font-medium text-warning">Userbase unavailable</p>
          <p className="mt-1 text-foreground-muted">{page.error}</p>
        </div>
      )}
    </div>
  );
}
