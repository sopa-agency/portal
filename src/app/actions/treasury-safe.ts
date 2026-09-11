"use server";

import { cookies } from "next/headers";
import { encodeFunctionData, getAddress, isAddress, parseUnits, erc20Abi } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getAllProjects } from "@/projects/index";
import { proposeSafeBatch, proposerAddress, type SafeCall } from "@/lib/safe-propose";
import { COMMUNITY_VAULTS } from "@/lib/community-vaults";

/**
 * Mexer no dinheiro de um multisig a partir do tesouro do portal.
 *
 * Nada aqui EXECUTA nada. Um Safe não tem botão de um clique: toda operação
 * vira uma transação PROPOSTA na fila, e as pessoas assinam no app.safe.global
 * — o da SOPA é 2 de 5. É por isso que os botões dizem "Propor", e não
 * "Enviar": um botão que promete execução num 2-de-5 estaria mentindo em todo
 * clique.
 *
 * Quem propõe é o delegate do proposer, o mesmo caminho que o pagamento de
 * bounty já usa.
 */

const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  // Vault V2: puxa `assets` de volta do adaptador para o saldo ocioso do cofre.
  { name: "forceDeallocate", type: "function", stateMutability: "nonpayable", inputs: [{ name: "adapter", type: "address" }, { name: "data", type: "bytes" }, { name: "assets", type: "uint256" }, { name: "onBehalf", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export type Proposta = { ok: true; url: string; safeTxHash: string } | { ok: false; error: string };

/**
 * O que dá para enviar daqui — por SÍMBOLO, resolvido no servidor.
 *
 * Nenhum endereço de token vem do navegador. O relatório do tesouro lista
 * tokens descobertos por indexador, cujo nome é texto controlado por quem
 * criou o contrato; aceitar "envie deste endereço" de um cliente seria assinar
 * uma aprovação para qualquer coisa que alguém conseguisse plantar na lista.
 *
 * ETH nativo e USDC cobrem o que se faz de verdade: pagar alguém e mover
 * caixa. Outro token entra aqui, declarado, quando houver um caso real.
 */
export type TokenEnviavel = "ETH" | "USDC";

const ENVIAVEIS: Record<number, Record<TokenEnviavel, { address: string | null; decimals: number }>> = {
  8453: {
    ETH: { address: null, decimals: 18 },
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  },
  1: {
    ETH: { address: null, decimals: 18 },
    USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  },
};

/**
 * O endereço precisa ser um multisig DECLARADO em algum portal a que esta
 * sessão tem acesso — e a cadeia sai da declaração, não do cliente.
 *
 * Sem isso, o proposer viraria um "proponha qualquer transação para qualquer
 * Safe" atrás de um login. O delegate não assina sozinho (o Safe ainda exige as
 * 2 de 5), mas encher a fila de alguém já é estrago suficiente.
 */
async function autorizar(safe: string): Promise<
  { ok: true; chainId: number; label: string } | { ok: false; error: string }
> {
  if (!isAddress(safe)) return { ok: false, error: "Endereço inválido." };
  if (!proposerAddress()) return { ok: false, error: "Proposer não configurado." };
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const alvo = safe.toLowerCase();
  for (const p of getAllProjects()) {
    const w = p.treasury?.ethWallets.find((x) => x.address.toLowerCase() === alvo && x.safe);
    if (!w?.safe) continue;
    if (!(await verifySession(token, p))) continue;
    return { ok: true, chainId: w.safe.chainId, label: w.label };
  }
  return { ok: false, error: "Esse multisig não é seu, ou não está declarado neste portal." };
}

function quantia(valor: string, decimais: number): bigint | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return parseUnits(valor.trim(), decimais);
  } catch {
    return null;
  }
}

async function propor(safe: string, chainId: number, calls: SafeCall[], origem: string): Promise<Proposta> {
  const r = await proposeSafeBatch({ chainId, safe, calls, origin: origem });
  return r.ok ? { ok: true, url: r.url, safeTxHash: r.safeTxHash } : { ok: false, error: r.error };
}

export async function proporEnvio(args: {
  safe: string;
  token: TokenEnviavel;
  para: string;
  valor: string;
}): Promise<Proposta> {
  const auth = await autorizar(args.safe);
  if (!auth.ok) return auth;
  const spec = ENVIAVEIS[auth.chainId]?.[args.token];
  if (!spec) return { ok: false, error: `Não sei enviar ${args.token} na cadeia ${auth.chainId}.` };
  if (!isAddress(args.para)) return { ok: false, error: "Endereço de destino inválido." };
  const bruto = quantia(args.valor, spec.decimals);
  if (bruto === null) return { ok: false, error: "Quantia inválida." };
  const para = getAddress(args.para);

  const call: SafeCall = spec.address
    ? {
        to: getAddress(spec.address),
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [para, bruto] }),
      }
    : { to: para, data: "0x", value: bruto };

  return propor(args.safe, auth.chainId, [call], "Portal · envio do tesouro");
}

/**
 * Depositar no cofre: aprovar e depositar na MESMA transação.
 *
 * Em duas transações separadas a aprovação pode ficar pendurada sozinha na fila
 * — um Safe com allowance concedida e nada depositado é pior que não ter
 * começado, porque parece feito.
 */
export async function proporStake(args: { safe: string; vaultKey: string; valor: string }): Promise<Proposta> {
  const auth = await autorizar(args.safe);
  if (!auth.ok) return auth;
  const cofre = COMMUNITY_VAULTS.find((v) => v.key === args.vaultKey);
  if (!cofre) return { ok: false, error: "Cofre desconhecido." };
  if (cofre.chainId !== auth.chainId)
    return { ok: false, error: `O cofre está na cadeia ${cofre.chainId} e o multisig na ${auth.chainId}.` };
  const bruto = quantia(args.valor, cofre.assetDecimals);
  if (bruto === null) return { ok: false, error: "Quantia inválida." };

  const safe = getAddress(args.safe);
  const vault = getAddress(cofre.address);
  return propor(
    args.safe,
    auth.chainId,
    [
      { to: getAddress(cofre.asset), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, bruto] }) },
      { to: vault, data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [bruto, safe] }) },
    ],
    "Portal · stake no cofre",
  );
}

/**
 * Sacar do cofre: puxar do adaptador e SÓ ENTÃO sacar, na mesma transação.
 *
 * Este cofre é Vault V2 e mantém zero ocioso — `maxWithdraw` lê 0 porque a
 * liquidez está toda no adaptador da Moonwell. Um `withdraw` sozinho reverte
 * com erro de contrato pelado, e quem clicou não tem como saber por quê.
 */
export async function proporUnstake(args: { safe: string; vaultKey: string; valor: string }): Promise<Proposta> {
  const auth = await autorizar(args.safe);
  if (!auth.ok) return auth;
  const cofre = COMMUNITY_VAULTS.find((v) => v.key === args.vaultKey);
  if (!cofre) return { ok: false, error: "Cofre desconhecido." };
  if (cofre.chainId !== auth.chainId)
    return { ok: false, error: `O cofre está na cadeia ${cofre.chainId} e o multisig na ${auth.chainId}.` };
  const bruto = quantia(args.valor, cofre.assetDecimals);
  if (bruto === null) return { ok: false, error: "Quantia inválida." };

  const safe = getAddress(args.safe);
  const vault = getAddress(cofre.address);
  const calls: SafeCall[] = [];
  if (cofre.liquidityAdapter) {
    calls.push({
      to: vault,
      data: encodeFunctionData({
        abi: VAULT_ABI,
        functionName: "forceDeallocate",
        args: [getAddress(cofre.liquidityAdapter), "0x", bruto, safe],
      }),
    });
  }
  calls.push({
    to: vault,
    data: encodeFunctionData({ abi: VAULT_ABI, functionName: "withdraw", args: [bruto, safe, safe] }),
  });
  return propor(args.safe, auth.chainId, calls, "Portal · unstake do cofre");
}
