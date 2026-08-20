import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects/index";
import { PageHeader } from "@/components/page-header";
import { TikTokQueue } from "@/components/tiktok-queue";
import { listTikTokQueue, getTikTokAccount } from "@/app/actions/tiktok";
import { tiktokClientCreds } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

export default async function TikTokPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const project = await getActiveProject();
  if (!project.tiktok) notFound();

  const params = await searchParams;
  const [queue, account] = await Promise.all([listTikTokQueue(), getTikTokAccount()]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="TikTok"
        title="TikTok"
        description="Fila de curadoria: sobe o vídeo, o time revisa e aprova, e o post entra no calendário. Só o que foi aprovado publica."
      />
      <TikTokQueue
        rows={queue.ok ? queue.rows : []}
        loadError={queue.ok ? null : queue.error}
        account={account}
        credsConfigured={!!tiktokClientCreds(project)}
        envPrefix={project.agent.gatewayEnvPrefix}
        justConnected={params.connected === "1"}
        connectError={params.error ?? null}
      />
    </div>
  );
}
