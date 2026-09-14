"use server";

import { getAddress, isAddress } from "viem";
import { autorizarSafe } from "@/lib/safe-authz";
import { proposerAddress } from "@/lib/safe-propose";
import { safeTxService } from "@/lib/safe-tx";
import { ARBITRUM, hasArbitrumDelegate } from "@/lib/mor-bridge";

/**
 * Registrar o proposer do portal como delegate de um Safe no serviço da
 * Arbitrum — a partir do navegador, com a carteira de um dono.
 *
 * O registro é por rede: o proposer já é delegate na mainnet e na Base, e
 * sem o da Arbitrum a ponte do MOR não tem por onde entrar na fila. Não é
 * transação: é uma assinatura EIP-712 de um DONO do Safe naquela rede, que o
 * serviço confere contra os donos on-chain. A chave nunca sai da carteira de
 * quem assina; o portal só monta a mensagem e entrega a assinatura ao serviço.
 *
 * O `totp` é a hora inteira atual: o serviço aceita a hora corrente e a
 * anterior, então a assinatura morre sozinha em no máximo duas horas.
 */

const LABEL = "SOPA PROPOSER";

export type DelegateTypedData = {
  domain: { name: string; version: string; chainId: number };
  types: {
    EIP712Domain: { name: string; type: string }[];
    Delegate: { name: string; type: string }[];
  };
  primaryType: "Delegate";
  message: { delegateAddress: string; totp: number };
};

export async function arbitrumDelegateTypedData(args: { safe: string }): Promise<
  { ok: true; delegate: string; totp: number; typedData: DelegateTypedData } | { ok: false; error: string }
> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  const delegate = proposerAddress();
  if (!delegate) return { ok: false, error: "Proposer não configurado." };
  const totp = Math.floor(Date.now() / 1000 / 3600);
  return {
    ok: true,
    delegate,
    totp,
    typedData: {
      domain: { name: "Safe Transaction Service", version: "1.0", chainId: ARBITRUM },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        Delegate: [
          { name: "delegateAddress", type: "address" },
          { name: "totp", type: "uint256" },
        ],
      },
      primaryType: "Delegate",
      message: { delegateAddress: delegate, totp },
    },
  };
}

export async function registerArbitrumDelegate(args: {
  safe: string;
  delegator: string;
  signature: string;
  totp: number;
}): Promise<{ ok: true; registered: boolean } | { ok: false; error: string; notOwner?: boolean }> {
  const auth = await autorizarSafe(args.safe);
  if (!auth.ok) return auth;
  if (!isAddress(args.delegator)) return { ok: false, error: "Carteira inválida." };
  if (!/^0x[0-9a-fA-F]{130}$/.test(args.signature)) return { ok: false, error: "Assinatura inválida." };
  const delegate = proposerAddress();
  if (!delegate) return { ok: false, error: "Proposer não configurado." };
  // O totp que a pessoa assinou tem de ser o de agora (ou da hora anterior):
  // qualquer outro o serviço recusa, e aqui a gente recusa antes.
  const agora = Math.floor(Date.now() / 1000 / 3600);
  if (args.totp !== agora && args.totp !== agora - 1) return { ok: false, error: "A assinatura venceu. Assina de novo." };

  const safe = getAddress(args.safe);
  const delegator = getAddress(args.delegator);
  try {
    const r = await fetch(`${safeTxService(ARBITRUM)}/api/v2/delegates/`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ safe, delegate, delegator, label: LABEL, signature: args.signature }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 300);
      // O serviço confere quem assinou contra os donos do Safe na Arbitrum. A
      // carteira certa na Base pode não ser dona lá: os Safes da Arbitrum estão
      // na configuração do dia zero.
      const notOwner = /owner|not.*allowed|invalid.*signature|delegator/i.test(body);
      return { ok: false, error: `Safe API HTTP ${r.status}: ${body}`, notOwner };
    }
    const registered = (await hasArbitrumDelegate(safe)) ?? true;
    return { ok: true, registered };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "Falha ao registrar." };
  }
}
