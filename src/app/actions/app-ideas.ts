"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";
import { STATUSES, type IdeaStatus } from "@/lib/app-idea-options";

// ---------------------------------------------------------------------------
// Lado de LEITURA dos pedidos de app. As linhas são escritas por /api/app-idea
// (anônimo, aberto pra internet); tudo aqui é SOPA-only e exige sessão — o
// oposto exato do escritor. Mesma divisão de sopa-briefs.ts.
// ---------------------------------------------------------------------------

export type AppIdeaRow = {
  id: string;
  name: string;
  contact: string;
  kind: string;
  audience: string;
  existing: string;
  urgency: string;
  budget: string;
  pitch: string;
  successCriteria: string;
  references: string;
  status: string;
  createdAt: string;
};

async function gate() {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false as const, error: "Pedidos de app só existem no portal da SOPA." };
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Unauthorized." };
  return { ok: true as const, project, who };
}

/** Novos primeiro, e dentro de cada estado o mais recente no topo. */
export async function listAppIdeas(): Promise<{ ok: true; ideas: AppIdeaRow[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;

  // O erro do banco sobe como erro. Uma lista vazia aqui afirmaria "ninguém
  // pediu nada", que é notícia diferente de "não consegui ler".
  try {
    const rows = await prisma.appIdea.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return {
      ok: true,
      ideas: rows.map((r) => ({
        id: r.id,
        name: r.name,
        contact: r.contact,
        kind: r.kind,
        audience: r.audience,
        existing: r.existing,
        urgency: r.urgency,
        budget: r.budget,
        pitch: r.pitch,
        successCriteria: r.successCriteria,
        references: r.references,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch {
    return { ok: false, error: "Não consegui ler os pedidos de app." };
  }
}

/** Move um pedido na triagem. Nada é apagado: arquivar é um estado. */
export async function setAppIdeaStatus(
  id: string,
  status: IdeaStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  if (!STATUSES.includes(status)) return { ok: false, error: "Estado inválido." };

  try {
    await prisma.appIdea.update({ where: { id }, data: { status } });
    revalidatePath("/briefs");
    return { ok: true };
  } catch {
    return { ok: false, error: "Falha ao atualizar o pedido." };
  }
}
