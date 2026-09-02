"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import { apurar, elegiveis, validarCedula, vetorParaContrato, type Cedula } from "@/lib/split-vote";
import { getSplitDistributeConfig } from "@/lib/splits";
import { JANELA_MS } from "@/lib/split-vote-weekly";
import { calcularMerito, PONTOS_DE_MERITO, type Merito } from "@/lib/merit";
import { type Reading } from "@/lib/reading";

async function porta() {
  const project = await getActiveProject();
  const who = await authorize((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project, who };
}

export type EstadoRodada = {
  round: { id: string; label: string; status: string; splitAddress: string; chain: string; openedAt: string } | null;
  /** Quando a urna fecha sozinha. null se já fechou — o relógio mora no
   *  servidor, então o cliente não precisa repetir a constante das 48h. */
  fechaEm: string | null;
  elegiveis: { address: string; username: string | null; shareAtual: number }[];
  /** Você pode votar nesta rodada? E já votou? */
  souElegivel: boolean;
  meuEndereco: string | null;
  meuVoto: Record<string, number> | null;
  resultado: Awaited<ReturnType<typeof apurar>> | null;
  vetor: ReturnType<typeof vetorParaContrato>;
  souAdmin: boolean;
  /**
   * A parte DURA da cédula: pontos que vêm de receita medida, não de opinião.
   *
   * Vem como Reading porque o cálculo atravessa indexador e RPC: mérito que não
   * pôde ser medido NÃO é mérito zero, e a tela precisa poder dizer a diferença
   * antes de alguém concluir que ninguém trouxe nada.
   */
  merito: Reading<Merito>;
  pontosDeMerito: number;
  /**
   * Quem já votou e quem falta, disponível TAMBÉM com a rodada aberta.
   *
   * O resultado só aparece depois de fechar — ver ao vivo viraria corrida. Mas
   * a PARTICIPAÇÃO não é resultado: saber que faltam três pessoas é o que
   * permite decidir a hora de fechar, e não diz nada sobre o que ninguém votou.
   */
  jaVotaram: { address: string; username: string | null }[];
  faltamVotar: { address: string; username: string | null }[];
};

/**
 * O estado da rodada aberta.
 *
 * Devolve erro NOMEADO quando a leitura do split falha, em vez de uma lista
 * vazia de elegíveis: "ninguém pode votar" e "não consegui ler o contrato" são
 * coisas diferentes, e a segunda não pode se disfarçar da primeira numa tela
 * que decide pagamento.
 */
export async function estadoRodada(): Promise<{ ok: true; estado: EstadoRodada } | { ok: false; error: string }> {
  const g = await porta();
  if (!g.ok) return g;

  const round = await prisma.splitVoteRound
    .findFirst({ where: { projectSlug: g.project.slug }, orderBy: { openedAt: "desc" } })
    .catch(() => null);

  if (!round) {
    return {
      ok: true,
      estado: {
        round: null, fechaEm: null, elegiveis: [], souElegivel: false, meuEndereco: null,
        merito: await calcularMerito(), pontosDeMerito: PONTOS_DE_MERITO,
        jaVotaram: [], faltamVotar: [],
        meuVoto: null, resultado: null, vetor: null, souAdmin: g.who.role === "admin",
      },
    };
  }

  const els = await elegiveis(round.splitAddress, round.chain);
  if (!els) return { ok: false, error: "Não consegui ler o split na cadeia — isso não quer dizer que não haja destinatários." };

  const meu = els.find((e) => e.username?.toLowerCase() === g.who.username.toLowerCase()) ?? null;
  const cedula = meu
    ? await prisma.splitVoteBallot.findUnique({ where: { roundId_voter: { roundId: round.id, voter: g.who.username.toLowerCase() } } }).catch(() => null)
    : null;

  const resultado = await apurar(round.id, els);

  return {
    ok: true,
    estado: {
      round: {
        id: round.id, label: round.label, status: round.status,
        splitAddress: round.splitAddress, chain: round.chain,
        openedAt: round.openedAt.toISOString(),
      },
      fechaEm: round.status === "open" ? new Date(round.openedAt.getTime() + JANELA_MS).toISOString() : null,
      elegiveis: els.map((e) => ({ address: e.address, username: e.username, shareAtual: e.shareAtual })),
      souElegivel: !!meu,
      meuEndereco: meu?.address ?? null,
      meuVoto: (cedula?.points as Record<string, number>) ?? null,
      // O resultado só aparece com a rodada FECHADA. Ver ao vivo transformaria a
      // votação numa corrida: quem vota por último ajusta para mover a média.
      resultado: round.status === "closed" ? resultado : null,
      vetor: round.status === "closed" ? vetorParaContrato(resultado.linhas) : null,
      souAdmin: g.who.role === "admin",
      merito: await calcularMerito(),
      pontosDeMerito: PONTOS_DE_MERITO,
      jaVotaram: resultado.quemVotou,
      faltamVotar: resultado.abstiveram,
    },
  };
}

export async function votar(roundId: string, cedula: Cedula[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await porta();
  if (!g.ok) return g;

  const round = await prisma.splitVoteRound.findUnique({ where: { id: roundId } }).catch(() => null);
  if (!round) return { ok: false, error: "Rodada não encontrada." };
  if (round.status !== "open") return { ok: false, error: "Esta rodada já foi fechada." };

  const els = await elegiveis(round.splitAddress, round.chain);
  if (!els) return { ok: false, error: "Não consegui ler o split na cadeia. Tente de novo." };

  const meu = els.find((e) => e.username?.toLowerCase() === g.who.username.toLowerCase());
  if (!meu) return { ok: false, error: "Você não está no split desta rodada, então não vota nela." };

  const v = validarCedula(cedula, meu.address, els.map((e) => e.address));
  if (!v.ok) return { ok: false, error: v.erro };

  const voter = g.who.username.toLowerCase();
  await prisma.splitVoteBallot.upsert({
    where: { roundId_voter: { roundId, voter } },
    create: { roundId, voter, points: v.limpa as unknown as object },
    update: { points: v.limpa as unknown as object },
  });
  return { ok: true };
}

export async function abrirRodada(label: string, splitAddress: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await porta();
  if (!g.ok) return g;
  if (g.who.role !== "admin") return { ok: false, error: "Só um admin abre rodada." };
  if (!/^0x[a-fA-F0-9]{40}$/.test(splitAddress.trim())) return { ok: false, error: "Endereço de split inválido." };

  // Uma rodada aberta por vez. Duas urnas simultâneas para o mesmo split são
  // dois resultados válidos e nenhuma regra para escolher entre eles.
  const aberta = await prisma.splitVoteRound.findFirst({ where: { projectSlug: g.project.slug, status: "open" } }).catch(() => null);
  if (aberta) return { ok: false, error: `A rodada "${aberta.label}" ainda está aberta. Feche ela antes.` };

  await prisma.splitVoteRound.create({
    data: { projectSlug: g.project.slug, label: label.trim() || new Date().toLocaleDateString("pt-BR"), splitAddress: splitAddress.trim(), openedBy: g.who.username },
  });
  return { ok: true };
}

export async function fecharRodada(roundId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await porta();
  if (!g.ok) return g;
  if (g.who.role !== "admin") return { ok: false, error: "Só um admin fecha rodada." };
  await prisma.splitVoteRound.update({ where: { id: roundId }, data: { status: "closed", closedAt: new Date() } }).catch(() => null);
  return { ok: true };
}

/**
 * O vetor pronto para assinar, com o incentivo PRESERVADO.
 *
 * `vetorParaContrato` devolve destinatários e alocações — e só. Mas
 * `updateSplit` recebe a struct inteira, e o quarto campo é o
 * `distributionIncentive`: a fatia que paga quem dispara a distribuição. Este
 * split hoje tem **6**. Montar a struct com zero (o default de quem esquece do
 * campo) apagaria esse incentivo sem erro nenhum na tela — a transação passaria,
 * as proporções ficariam certas, e ninguém mais teria motivo para clicar em
 * Recolher. Por isso o número é LIDO da cadeia agora e devolvido junto.
 *
 * Só depois de a rodada estar FECHADA: aplicar uma apuração que ainda pode mudar
 * é transformar um voto em dinheiro antes de a urna terminar.
 */
export async function vetorParaAplicar(roundId: string): Promise<
  | { ok: true; splitAddress: string; chain: string; recipients: string[]; allocations: string[]; totalAllocation: string; distributionIncentive: number }
  | { ok: false; error: string }
> {
  const g = await porta();
  if (!g.ok) return g;
  if (g.who.role !== "admin") return { ok: false, error: "Só quem administra a rodada aplica o resultado." };

  const round = await prisma.splitVoteRound.findUnique({ where: { id: roundId } }).catch(() => null);
  if (!round) return { ok: false, error: "Rodada não encontrada." };
  if (round.projectSlug !== g.project.slug) return { ok: false, error: "Essa rodada é de outro portal." };
  if (round.status !== "closed") return { ok: false, error: "Feche a rodada antes de aplicar — apuração aberta ainda pode mudar." };

  const els = await elegiveis(round.splitAddress, round.chain);
  if (!els) return { ok: false, error: "Não consegui ler o split na cadeia agora. Isso não quer dizer que ele esteja vazio — tenta de novo." };

  const resultado = await apurar(round.id, els);
  const vetor = vetorParaContrato(resultado.linhas);
  if (!vetor) return { ok: false, error: "Ninguém recebeu voto: não há vetor para aplicar." };

  // A struct viva, só para herdar o incentivo. Sem ela não dá para montar o
  // updateSplit sem apagar um campo que ninguém está olhando.
  const atual = await getSplitDistributeConfig(round.splitAddress, round.chain);
  if (!atual) return { ok: false, error: "Não consegui ler a configuração atual do split — sem ela eu apagaria o incentivo de distribuição." };

  return {
    ok: true,
    splitAddress: round.splitAddress,
    chain: round.chain,
    recipients: vetor.recipients,
    // Strings porque BigInt não atravessa server action; o cliente remonta.
    allocations: vetor.allocations.map((a) => String(a)),
    totalAllocation: String(vetor.totalAllocation),
    distributionIncentive: atual.distributionIncentive,
  };
}

/**
 * Reabre uma rodada fechada, sem perder as cédulas.
 *
 * Fechar cedo acontece — e antes disso a única saída era abrir OUTRA rodada,
 * o que jogaria fora os votos já dados e faria todo mundo votar de novo. As
 * cédulas ficam onde estão: reabrir é desfazer o fechamento, não recomeçar.
 */
export async function reabrirRodada(roundId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await porta();
  if (!g.ok) return g;
  if (g.who.role !== "admin") return { ok: false, error: "Só quem administra reabre uma rodada." };
  const round = await prisma.splitVoteRound.findUnique({ where: { id: roundId } }).catch(() => null);
  if (!round) return { ok: false, error: "Rodada não encontrada." };
  if (round.projectSlug !== g.project.slug) return { ok: false, error: "Essa rodada é de outro portal." };
  if (round.status === "open") return { ok: false, error: "Essa rodada já está aberta." };
  await prisma.splitVoteRound.update({ where: { id: roundId }, data: { status: "open", closedAt: null } });
  return { ok: true };
}
