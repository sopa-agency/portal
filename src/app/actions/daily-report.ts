"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { atividadeDoDia, type AtividadeDoDia, type AtividadeItem } from "@/lib/daily-activity";

/**
 * O relatório diário: a pessoa conta o que fez, e o portal ajuda mostrando o
 * que já sabe.
 *
 * Escrever só pelo próprio nome. O relatório é uma declaração de quem assina —
 * deixar alguém gravar em nome de outro transformaria a coisa toda em algo que
 * não dá para acreditar.
 */

export type Relatorio = {
  dia: string;
  body: string;
  items: AtividadeItem[];
  atualizadoEm: string | null;
};

async function quem() {
  const project = await getActiveProject();
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  return s?.username ?? null;
}

/** `YYYY-MM-DD` → meia-noite UTC, que é como o Postgres guarda um `DATE`. */
function dataDoDia(diaIso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaIso)) return null;
  const d = new Date(`${diaIso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function carregarDia(
  diaIso: string,
): Promise<{ ok: true; relatorio: Relatorio | null; atividade: AtividadeDoDia } | { ok: false; error: string }> {
  const username = await quem();
  if (!username) return { ok: false, error: "Entre no portal para escrever o seu relatório." };
  const day = dataDoDia(diaIso);
  if (!day) return { ok: false, error: "Data inválida." };

  // A atividade é melhor-esforço: ela ajuda a escrever, não é o relatório. Uma
  // falha do GitHub não pode impedir alguém de contar o dia à mão.
  const [linha, atividade] = await Promise.all([
    prisma.dailyReport.findUnique({ where: { username_day: { username, day } } }).catch(() => null),
    atividadeDoDia(username, diaIso).catch(
      (e): AtividadeDoDia => ({ commits: [], cards: [], logins: [], erros: [String(e)] }),
    ),
  ]);

  return {
    ok: true,
    atividade,
    relatorio: linha
      ? {
          dia: diaIso,
          body: linha.body,
          items: (linha.items as AtividadeItem[]) ?? [],
          atualizadoEm: linha.updatedAt.toISOString(),
        }
      : null,
  };
}

export async function salvarDia(args: {
  dia: string;
  body: string;
  items: AtividadeItem[];
}): Promise<{ ok: true; atualizadoEm: string } | { ok: false; error: string }> {
  const username = await quem();
  if (!username) return { ok: false, error: "Entre no portal para escrever o seu relatório." };
  const day = dataDoDia(args.dia);
  if (!day) return { ok: false, error: "Data inválida." };

  const body = args.body.trim();
  if (!body) return { ok: false, error: "Escreva alguma coisa antes de enviar." };
  if (body.length > 8000) return { ok: false, error: "Passou de 8.000 caracteres." };

  // Só as referências que a pessoa de fato trouxe para o texto, e só os campos
  // que servem para agregar depois — sem carregar o rascunho inteiro.
  const items = (args.items ?? [])
    .slice(0, 100)
    .map((i) => ({ kind: i.kind, ref: i.ref, label: i.label, url: i.url, origem: i.origem, ts: i.ts }));

  const linha = await prisma.dailyReport.upsert({
    where: { username_day: { username, day } },
    create: { username, day, body, items },
    update: { body, items },
  });
  return { ok: true, atualizadoEm: linha.updatedAt.toISOString() };
}

/** Os últimos dias em que esta pessoa escreveu — para a tela mostrar a série. */
export async function meusDias(limite = 14): Promise<{ dia: string; chars: number }[]> {
  const username = await quem();
  if (!username) return [];
  const linhas = await prisma.dailyReport
    .findMany({ where: { username }, orderBy: { day: "desc" }, take: limite, select: { day: true, body: true } })
    .catch(() => []);
  return linhas.map((l) => ({ dia: l.day.toISOString().slice(0, 10), chars: l.body.length }));
}
