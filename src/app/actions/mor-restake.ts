"use server";

import { createPublicClient, http, fallback, encodeFunctionData, getAddress, erc20Abi } from "viem";
import { proposeSafeBatch } from "@/lib/safe-propose";
import { autorizarSafe } from "@/lib/safe-authz";
import { SOPA_SAFE } from "@/lib/superfluid";
import { PIPELINE, TOKENS, pipelineAbis, warehouseId } from "@/lib/mor-pipeline";

const BASE = 8453;
const client = createPublicClient({
  transport: fallback(["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"].map((u) => http(u))),
});

// BuildersV4.deposit(subnetId, amount) — the exact stake call the working
// SopaStakePanel uses. Approve target is the builders contract itself (NOT a
// separate Distributor — that's the Ethereum Morpheus-Capital track, different).
const buildersDeposit = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "subnetId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Propõe o stake do MOR de um Safe na Base no subnet da Gnars, como UM batch:
 * saque do crédito no Warehouse (se houver) → approve → deposit. Entra na
 * fila do Safe para os donos assinarem (2 de 5 na Base). Sem chave quente,
 * sem execução automática — o botão só monta e propõe.
 *
 * Começou só com o Safe da SOPA. Em 14/09/2026 o Vlad pediu o mesmo botão
 * para a SkateHive, no mesmo subnet: o MOR que chega pela ponte fica no
 * Safe da Base e o destino dos dois é o subnet da Gnars. A autorização é a
 * mesma do enviar e do claim — Safe declarado num projeto que a sessão
 * acessa — e o Safe tem de ser da Base, que é onde os Builders vivem.
 *
 * Cada depósito retrava a posição INTEIRA do Safe no subnet por 7 dias.
 */
export async function proposeMorRestake(args?: { safe?: string }): Promise<
  { ok: true; url: string; amount: string } | { ok: false; error: string }
> {
  const alvo = args?.safe ?? SOPA_SAFE;
  const auth = await autorizarSafe(alvo);
  if (!auth.ok) return auth;
  if (auth.chainId !== BASE) return { ok: false, error: `${auth.label} não é um Safe da Base; o subnet dos Builders vive lá.` };

  const safe = getAddress(alvo);
  const mor = getAddress(TOKENS.mor.address);
  const builders = getAddress(PIPELINE.builders);
  try {
    // Saldos crus (wei), para a quantia da tx ser exata: crédito no Warehouse + MOR na carteira.
    const [whCredit, walletMor] = await Promise.all([
      client.readContract({ address: getAddress(PIPELINE.warehouse), abi: pipelineAbis.warehouse as never, functionName: "balanceOf", args: [safe, warehouseId(mor)] }) as Promise<bigint>,
      client.readContract({ address: mor, abi: pipelineAbis.erc20 as never, functionName: "balanceOf", args: [safe] }) as Promise<bigint>,
    ]);
    const wh = whCredit > BigInt(1) ? whCredit : BigInt(0); // o Warehouse deixa 1 wei
    const amount = wh + walletMor;
    if (amount < BigInt("1000000000000000")) return { ok: false, error: `Nada para stakear (menos de 0,001 MOR em ${auth.label}).` };

    const calls = [
      // O saque do Warehouse é permissionless; no batch, uma assinatura cobre o stake inteiro.
      // Só entra quando há crédito: a SkateHive não passa pelo split, então não tem.
      ...(wh > BigInt(0)
        ? [{ to: getAddress(PIPELINE.warehouse), data: encodeFunctionData({ abi: pipelineAbis.warehouse, functionName: "withdraw", args: [safe, mor] }) }]
        : []),
      { to: mor, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [builders, amount] }) },
      { to: builders, data: encodeFunctionData({ abi: buildersDeposit, functionName: "deposit", args: [PIPELINE.subnetId, amount] }) },
    ];
    const res = await proposeSafeBatch({
      chainId: BASE,
      safe,
      origin: `${auth.label}: stake de ${(Number(amount) / 1e18).toFixed(4)} MOR no subnet da Gnars${wh > BigInt(0) ? " (withdraw + approve + deposit)" : " (approve + deposit)"}`,
      calls,
    });
    if (!res.ok) return res;
    return { ok: true, url: res.url, amount: (Number(amount) / 1e18).toFixed(4) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor o stake." };
  }
}
