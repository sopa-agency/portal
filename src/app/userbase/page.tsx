export const dynamic = "force-dynamic";

import { PageHeader } from "@/components/page-header";
import { UserbaseTable } from "@/components/userbase-table";
import { listUsersWithEmail } from "@/app/actions/userbase";

export default async function UserbasePage() {
  const result = await listUsersWithEmail();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Userbase"
        title="Users with email"
        description="SkateHive accounts that have linked an email (via the magic-link sign-in). Use this list for email-blast outreach."
        status={result.ok ? `${result.total} total` : undefined}
      />

      {result.ok ? (
        <UserbaseTable users={result.users} />
      ) : (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-5 py-4 text-sm text-amber-200">
          <p className="font-medium text-warning">Userbase unavailable</p>
          <p className="mt-1 text-foreground-muted">{result.error}</p>
        </div>
      )}
    </div>
  );
}
