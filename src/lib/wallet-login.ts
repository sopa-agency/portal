import "server-only";

// Quem pode entrar por carteira — e por que isto não lê a página Team.
//
// Os endereços dos membros já estão cadastrados em `TeamMemberContact` com o
// rótulo "Wallet". Seria natural usar aquilo como credencial e não usamos, por
// um motivo concreto: aquele campo é editável por QUALQUER membro do portal —
// está escrito no próprio team-admin.ts, "editar o valor do contato — que
// qualquer membro do portal pode fazer". Um login que lesse dali permitiria a
// um membro pôr o próprio endereço no cadastro de um admin e entrar como ele.
// Isso é escalada de privilégio, e nenhuma conveniência paga esse preço.
//
// Então existe esta tabela, que só se escreve de propósito: a primeira leva
// veio de uma semente única e auditada (scripts/create-wallet-login.cjs), e daí
// em diante cada endereço entra à mão e precisa ser DESBLOQUEADO num segundo
// gesto. Dois gestos porque adicionar é digitar e desbloquear é dizer "sim,
// esta pessoa entra por aqui" — um clique distraído não vira acesso.

import { prisma } from "@/lib/prisma";

export type WalletLookup =
  | { state: "ok"; username: string }
  /** Endereço conhecido, mas ainda não desbloqueado. */
  | { state: "locked"; username: string }
  /** Endereço que ninguém cadastrou. */
  | { state: "unknown" }
  /** O banco não respondeu. NÃO é o mesmo que "não está na lista", e por isso
   *  não compartilha estado com `unknown`: negar acesso por indisponibilidade é
   *  correto, mas dizer "você não está na lista" seria mentira. */
  | { state: "unread"; reason: string };

export async function lookupWalletLogin(address: string): Promise<WalletLookup> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { state: "unknown" };
  try {
    const row = await prisma.walletLogin.findUnique({ where: { address: addr } });
    if (!row) return { state: "unknown" };
    return row.enabled ? { state: "ok", username: row.username } : { state: "locked", username: row.username };
  } catch (e) {
    return { state: "unread", reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function markWalletLogin(address: string): Promise<void> {
  await prisma.walletLogin
    .update({ where: { address: address.trim().toLowerCase() }, data: { lastLoginAt: new Date() } })
    .catch(() => {});
}

export type WalletLoginRow = {
  address: string;
  username: string;
  enabled: boolean;
  source: string;
  addedBy: string;
  lastLoginAt: Date | null;
};

export async function listWalletLogins(): Promise<WalletLoginRow[]> {
  return prisma.walletLogin
    .findMany({ orderBy: [{ username: "asc" }] })
    .then((rs) =>
      rs.map((r) => ({
        address: r.address,
        username: r.username,
        enabled: r.enabled,
        source: r.source,
        addedBy: r.addedBy,
        lastLoginAt: r.lastLoginAt,
      })),
    )
    .catch(() => []);
}
