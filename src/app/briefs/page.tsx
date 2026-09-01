import { notFound } from "next/navigation";
import { getActiveProject } from "@/projects";
import { listBriefs } from "@/app/actions/sopa-briefs";
import { listAppIdeas } from "@/app/actions/app-ideas";
import { SopaBriefs } from "@/components/sopa-briefs";
import { AppIdeasInbox } from "@/components/app-ideas-inbox";

export const dynamic = "force-dynamic";

export default async function BriefsPage() {
  const project = await getActiveProject();
  if (!project.briefs || project.slug !== "sopa") notFound();

  const [res, ideas] = await Promise.all([listBriefs(), listAppIdeas()]);
  if (!res.ok) notFound();

  return (
    <>
      <SopaBriefs initial={res.briefs} />
      {/* Mesma caixa de entrada, outro remetente: os pedidos de app entram na
          mesma página de triagem em vez de ganharem rota própria. Uma segunda
          fila em outro lugar é uma fila que ninguém abre. */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-10">
        <AppIdeasInbox
          initial={ideas.ok ? ideas.ideas : []}
          error={ideas.ok ? undefined : ideas.error}
        />
      </div>
    </>
  );
}
