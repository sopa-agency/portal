import "server-only";
import { prisma } from "@/lib/prisma";

// O relógio da urna semanal.
//
// A votação já existia e funcionava — mas só se alguém lembrasse de abrir a
// rodada depois da reunião e de fechá-la antes de aplicar. Nesta casa já foi
// medido o que acontece com o que depende de memória humana: o briefing do
// secretário ficou 50 dias parado e o trail parou em julho. Uma folha de
// pagamento não pode ser a próxima coisa a depender de alguém lembrar.
//
// NÃO PEDE CRON NOVA. A Vercel tem UMA cron aqui (horária) e tudo pendura
// nela — o que importa porque uma cron acima do limite do plano já impediu a
// CRIAÇÃO de deploys neste projeto, sem build vermelho, só um check falhando.
//
// E, de propósito, este relógio NÃO aplica nada na cadeia. Ele abre e fecha a
// urna; transformar voto em dinheiro continua sendo um clique humano. Um erro
// de contagem que vira pagamento sozinho é o tipo de coisa que ninguém vê
// acontecer.

/** Segunda-feira. `getUTCDay()` conta domingo como 0. */
const SEGUNDA = 1;
/** A partir de que hora (BRT) a rodada abre — depois da reunião, não durante. */
const ABRE_BRT = 18;
/** Quanto tempo a urna fica aberta. Dois dias cobrem quem não vota na segunda. */
const JANELA_MS = 48 * 60 * 60 * 1000;
/** Trava contra abrir duas rodadas na mesma semana se a cron rodar de novo. */
const MESMA_SEMANA_MS = 5 * 24 * 60 * 60 * 1000;
/** O fuso da equipe. UTC−3 escrito à mão: uma dependência a menos para uma
 *  regra que muda de valor uma vez por década. */
const BRT_OFFSET_H = -3;

export type ResultadoSemanal = { ran: boolean; reason?: string; abriu?: string; fechou?: string };

function horaBrt(now: Date): { dia: number; hora: number } {
  const t = new Date(now.getTime() + BRT_OFFSET_H * 3600_000);
  return { dia: t.getUTCDay(), hora: t.getUTCHours() };
}

/**
 * Abre a rodada da semana e fecha a que venceu.
 *
 * O endereço do split NÃO é configurado aqui: ele é herdado da última rodada do
 * projeto. Isso é deliberado — a automação REPETE o que um humano montou uma
 * vez, e nunca inventa em qual contrato o dinheiro do time vai ser dividido.
 * Sem rodada anterior, não faz nada e diz por quê.
 */
export async function rodadaSemanalIfDue(now: Date = new Date(), projectSlug = "sopa"): Promise<ResultadoSemanal> {
  const ultima = await prisma.splitVoteRound
    .findFirst({ where: { projectSlug }, orderBy: { openedAt: "desc" } })
    .catch(() => null);
  if (!ultima) return { ran: false, reason: "nenhuma rodada anterior — a primeira é aberta à mão, com o split escolhido por alguém" };

  // 1. Fechar o que venceu. Vem antes de abrir para que a semana nunca tenha
  //    duas urnas abertas ao mesmo tempo.
  if (ultima.status === "open" && now.getTime() - ultima.openedAt.getTime() >= JANELA_MS) {
    await prisma.splitVoteRound.update({ where: { id: ultima.id }, data: { status: "closed", closedAt: now } });
    return { ran: true, fechou: ultima.id };
  }

  // 2. Abrir a da semana, se for a hora e se a anterior já estiver fechada.
  const { dia, hora } = horaBrt(now);
  if (dia !== SEGUNDA || hora < ABRE_BRT) return { ran: false, reason: "fora da janela de abertura (segunda, a partir das 18h BRT)" };
  if (ultima.status === "open") return { ran: false, reason: "a rodada anterior ainda está aberta" };
  if (now.getTime() - ultima.openedAt.getTime() < MESMA_SEMANA_MS) return { ran: false, reason: "já houve rodada nesta semana" };

  const semana = new Date(now.getTime() + BRT_OFFSET_H * 3600_000).toISOString().slice(0, 10);
  const nova = await prisma.splitVoteRound.create({
    data: {
      projectSlug,
      label: `Semana de ${semana}`,
      splitAddress: ultima.splitAddress,
      chain: ultima.chain,
      openedBy: "cron",
      status: "open",
    },
  });
  return { ran: true, abriu: nova.id };
}
