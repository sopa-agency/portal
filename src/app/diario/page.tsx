import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import { DailyReport } from "@/components/daily-report";

// A atividade vem do GitHub a cada visita — um relatório de hoje não pode ser
// montado sobre a foto de ontem.
export const dynamic = "force-dynamic";

export default async function DiarioPage() {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  // O relatório é assinado por quem escreve, então não há versão anônima desta
  // página: sem sessão não há de quem seja o dia.
  if (!session) redirect(`/login?next=${encodeURIComponent("/diario")}`);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Diário"
        title="O que você fez hoje"
        description="Uma linha por coisa. O portal traz o que já está registrado — commits e cards do dia — e você decide o que entra."
      />
      <DailyReport username={session.username} />
    </div>
  );
}
