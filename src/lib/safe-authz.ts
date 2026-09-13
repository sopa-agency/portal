import "server-only";

import { cookies } from "next/headers";
import { isAddress } from "viem";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getAllProjects } from "@/projects/index";
import { proposerAddress } from "@/lib/safe-propose";

/**
 * Quem pode PROPOR num multisig a partir do portal.
 *
 * A regra é uma só, e vale para enviar, stakear e reclamar o MOR da capital:
 * o Safe tem de estar DECLARADO (`safe` na carteira de algum projeto) e a
 * sessão tem de ter acesso a esse projeto. Nada é executado — propor só
 * enfileira e os donos assinam (2 de 5) — mas encher a fila de alguém já é
 * estrago suficiente para exigir as duas coisas.
 *
 * Morava dentro da ação de enviar; saiu para cá quando o claim da capital
 * passou a valer para mais de um Safe. Duas cópias da mesma regra é o jeito
 * mais rápido de elas divergirem.
 */
export async function autorizarSafe(safe: string): Promise<
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
