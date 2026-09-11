/**
 * Para onde um endereço da tesouraria aponta quando alguém clica nele.
 *
 * São dois destinos, e a escolha não é estética:
 *
 * - **Safe** → `app.safe.global`. É lá que um multisig lê como multisig:
 *   donos, threshold, fila de assinaturas. Um explorador de carteira mostra
 *   saldo e esconde exatamente o que importa num Safe.
 * - **EOA** → `app.zerion.io`. Carteira comum é saldo e posições, e é isso
 *   que a Zerion faz bem.
 *
 * Vive num módulo só porque estava em CINCO cópias — três caminhos diferentes
 * (`home`, `balances`, `transactions/queue`) e dois deles com o prefixo de
 * cadeia escrito inline como `chainId === 1 ? "eth" : "base"`. Cópia divergente
 * de URL é como o link do 0xSplits ficou apontando para o host errado sem
 * ninguém notar.
 *
 * Sem `server-only`: quem monta esses links é tanto componente de servidor
 * (multisig-budget) quanto de cliente (treasury-views).
 */

/**
 * O apelido de cadeia que o app.safe.global usa na URL (EIP-3770).
 *
 * Devolve `null` numa cadeia que não conhecemos em vez de chutar. O padrão
 * antigo era `chainId === 1 ? "eth" : "base"`, que transforma QUALQUER cadeia
 * desconhecida num link de Base — um link que abre, mostra outra rede e não
 * avisa que está errado.
 */
export function safeChainShortName(chainId: number): string | null {
  switch (chainId) {
    case 1: return "eth";
    case 8453: return "base";
    case 10: return "oeth";
    case 42161: return "arb1";
    case 137: return "matic";
    case 100: return "gno";
    case 56: return "bnb";
    case 43114: return "avax";
    default: return null;
  }
}

export type SafeAppPage = "home" | "balances" | "queue";

const CAMINHO: Record<SafeAppPage, string> = {
  home: "home",
  balances: "balances",
  queue: "transactions/queue",
};

/** A página de um Safe no app.safe.global. `null` em cadeia desconhecida. */
export function safeAppUrl(address: string, chainId: number, page: SafeAppPage = "home"): string | null {
  const rede = safeChainShortName(chainId);
  if (!rede) return null;
  return `https://app.safe.global/${CAMINHO[page]}?safe=${rede}:${address}`;
}

/** A página de uma carteira comum na Zerion. */
export function zerionWalletUrl(address: string): string {
  return `https://app.zerion.io/${address}/overview`;
}
