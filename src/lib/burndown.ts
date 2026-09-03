import "server-only";
import { ok, unread, type Reading } from "@/lib/reading";

/**
 * BurnDownWallStreet — o estado do projeto, lido em vez de escrito à mão.
 *
 * A tela é sobre um produto que ainda NÃO existe na cadeia: fase 0, mockup
 * funcional, nenhum programa deployado. Um painel assim é onde é mais fácil
 * mentir, porque não há nada contradizendo o texto. Então o pouco que dá para
 * ler de verdade — quando o repo se mexeu pela última vez, se o mockup está de
 * pé — é lido AGORA, e o que não dá para ler diz que não deu.
 */

export const BURNDOWN = {
  repo: "sktbrd/burndownwallstreet",
  mockup: "https://burndownwallstreet.vercel.app",
  /** 7,50% da Doppler, não renunciável. O resto é o teto honesto. */
  dopplerFeeBps: 750,
} as const;

export const TETO_HONESTO = (10_000 - BURNDOWN.dopplerFeeBps) / 100; // 92,5

export type EstadoRepo = { ultimoPush: string; privado: boolean; branchPadrao: string };

/** Quando o repo se mexeu pela última vez. É a única medida de vida que existe hoje. */
export async function lerRepo(): Promise<Reading<EstadoRepo>> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return unread("sem GITHUB_TOKEN no servidor");
  try {
    const r = await fetch(`https://api.github.com/repos/${BURNDOWN.repo}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      next: { revalidate: 300, tags: ["burndown"] },
    });
    if (!r.ok) return unread(`GitHub respondeu ${r.status}`);
    const j = (await r.json()) as { pushed_at: string; private: boolean; default_branch: string };
    return ok({ ultimoPush: j.pushed_at, privado: j.private, branchPadrao: j.default_branch });
  } catch (e) {
    return unread(e instanceof Error ? e.message : "a chamada não respondeu");
  }
}

/**
 * O mockup está de pé?
 *
 * Uma resposta ruim NÃO vira "fora do ar": vira leitura que não deu. A diferença
 * importa porque este painel existe para dizer o que é verdade sobre um produto
 * que ninguém consegue conferir sozinho ainda.
 */
export async function lerMockup(): Promise<Reading<{ status: number }>> {
  try {
    const r = await fetch(BURNDOWN.mockup, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300, tags: ["burndown"] },
    });
    return ok({ status: r.status });
  } catch (e) {
    return unread(e instanceof Error ? e.message : "não respondeu");
  }
}
