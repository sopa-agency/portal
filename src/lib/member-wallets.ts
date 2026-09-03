import "server-only";
import { prisma } from "@/lib/prisma";
import { todosOsApelidos } from "@/lib/member-identity";

/**
 * Toda carteira que a gente conhece de cada pessoa, de qualquer origem.
 *
 * As carteiras viviam em dois lugares que nunca se falaram:
 *   · `TeamMemberContact` label "Wallet" — o campo do perfil, UMA por portal
 *     por login (`@@unique([projectSlug, username, label])`)
 *   · `WalletLogin` — chaveado por endereço, então já aceitava várias
 *
 * A apuração do split lia só o primeiro. Consequência: uma segunda carteira só
 * podia existir como login, e login não votava nem recebia crédito de mérito —
 * o dinheiro chegava no endereço e a pessoa aparecia como "sem cadastro".
 *
 * Não morde hoje (medido em 03/09/2026: 11 carteiras em contatos, 10 de login,
 * zero só-login, ninguém com duas). Mas morde no dia em que alguém aparecer
 * com a segunda — que é exatamente o dia em que ninguém vai estar olhando.
 *
 * Tudo passa pelos apelidos: carteira cadastrada sob `highlander22` é carteira
 * do `keepkey`. Ver member-identity.ts.
 */
export type MapaCarteiras = {
  /** endereço em minúsculas → nome canônico da pessoa */
  porEndereco: Map<string, string>;
  /** nome canônico → todos os endereços dela */
  porPessoa: Map<string, string[]>;
};

export async function carteirasConhecidas(): Promise<MapaCarteiras> {
  const [contatos, logins, apelidos] = await Promise.all([
    prisma.teamMemberContact
      .findMany({ where: { label: "Wallet" }, select: { username: true, value: true } })
      .catch(() => [] as { username: string; value: string }[]),
    prisma.walletLogin.findMany({ select: { address: true, username: true } }).catch(() => [] as { address: string; username: string }[]),
    todosOsApelidos().catch(() => new Map<string, string>()),
  ]);
  const canon = (u: string) => apelidos.get(u.trim().toLowerCase()) ?? u.trim().toLowerCase();

  const porEndereco = new Map<string, string>();
  // Contatos primeiro e login por cima NÃO: o contato é o que a pessoa
  // declarou no perfil, e ele ganha quando os dois discordam. Um login pode
  // ter sido cadastrado por um admin; o perfil é a palavra dela.
  for (const l of logins) porEndereco.set(l.address.trim().toLowerCase(), canon(l.username));
  for (const c of contatos) {
    const addr = c.value.trim().toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(addr)) porEndereco.set(addr, canon(c.username));
  }

  const porPessoa = new Map<string, string[]>();
  for (const [addr, quem] of porEndereco) {
    if (!porPessoa.has(quem)) porPessoa.set(quem, []);
    porPessoa.get(quem)!.push(addr);
  }
  return { porEndereco, porPessoa };
}
