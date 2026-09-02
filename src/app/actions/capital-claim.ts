"use server";

import { cookies } from "next/headers";
import { getAddress } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { proposeSafeTx, proposerAddress } from "@/lib/safe-propose";
import { SOPA_SAFE } from "@/lib/superfluid";
import { MORPHEUS_POOLS, claimCalldata, probeClaimFee, readCapitalPosition } from "@/lib/morpheus-capital";
import { isOk } from "@/lib/reading";

const MAINNET = 1;

// A taxa medida vale para o bloco de agora. Entre propor e os donos assinarem
// passam horas, e ela anda com o gás. 1,5× é a folga — sobre US$ 0,13, custa
// centavos; sem ela, a assinatura chega e a transação reverte por um fio.
const MARGEM = { num: BigInt(3), den: BigInt(2) };

/** Saldo de ETH do Safe na mainnet — o msg.value sai daqui, não do bolso de quem assina. */
async function ethBalance(addr: string): Promise<bigint | null> {
  for (const rpc of ["https://gateway.tenderly.co/public/mainnet", "https://ethereum-rpc.publicnode.com"]) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
      });
      const j = (await r.json()) as { result?: string };
      if (j.result) return BigInt(j.result);
    } catch {
      // próximo RPC
    }
  }
  return null;
}

const eth = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

/**
 * Propõe o claim do MOR da capital: uma transação no Safe da SOPA, na MAINNET.
 *
 * O receiver é o próprio Safe, sempre. `claim` aceita qualquer endereço, e
 * apontá-lo para o topSplit da Base entregaria metade do rendimento do capital
 * da SOPA a quem não o aportou — a decisão está escrita em `morpheus-capital.ts`
 * e é reafirmada aqui porque este é o único lugar que a executa.
 *
 * Nada sai sem as assinaturas dos donos: isto só monta e enfileira.
 */
export async function proposeCapitalClaim(): Promise<
  { ok: true; url: string; mor: string; feeEth: string } | { ok: false; error: string }
> {
  const project = await getActiveProject();
  if (project.slug !== "sopa") return { ok: false, error: "O claim da capital é só da SOPA." };
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Não autorizado." };
  if (!proposerAddress()) return { ok: false, error: "Proposer (SAFE_PROPOSER_PRIVATE_KEY) não configurado." };

  const safe = getAddress(SOPA_SAFE);
  try {
    const pos = await readCapitalPosition(safe);
    // Sem leitura não se propõe: um claim montado às cegas pode estar travado,
    // vazio, ou os dois — e o revert só apareceria na cara de quem assina.
    if (!isOk(pos)) return { ok: false, error: "Não consegui ler a posição na Morpheus agora. Tenta de novo." };
    const p = pos.value;
    if (p.deposited <= 0) return { ok: false, error: "Não há posição na capital da Morpheus." };
    if (p.pendingMor <= 0) return { ok: false, error: "Ainda não há MOR acumulado para reclamar." };
    if (p.claimOpensAt && p.claimOpensAt.getTime() > Date.now()) {
      return { ok: false, error: `O claim ainda está travado até ${p.claimOpensAt.toLocaleDateString("pt-BR")}.` };
    }

    const fee = await probeClaimFee(safe, safe);
    if (!isOk(fee)) {
      return { ok: false, error: fee.state === "insufficient" ? fee.note : fee.reason };
    }
    const value = (fee.value * MARGEM.num) / MARGEM.den;

    // O ETH é do Safe. Avisar ANTES é a diferença entre "faltam 0,00002 ETH no
    // Safe" e uma transação enfileirada que reverte na hora de executar.
    const saldo = await ethBalance(safe);
    if (saldo != null && saldo < value) {
      return { ok: false, error: `O Safe tem ${eth(saldo)} ETH na mainnet e a ponte custa ${eth(value)}. Manda um pouco de ETH pro Safe antes.` };
    }

    const res = await proposeSafeTx({
      chainId: MAINNET,
      safe,
      to: MORPHEUS_POOLS.usdc,
      data: claimCalldata(safe),
      value,
      origin: "SOPA: claim do MOR da capital (mintado na Arbitrum)",
    });
    if (!res.ok) return res;
    return { ok: true, url: res.url, mor: p.pendingMor.toFixed(4), feeEth: eth(value) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 220) : "Falha ao propor o claim." };
  }
}
