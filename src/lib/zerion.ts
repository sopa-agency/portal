import "server-only";
import { sanitizeTokenLabel, labelLooksHostile, SYMBOL_MAX } from "@/lib/token-label";

// ---------------------------------------------------------------------------
// Leitor multi-rede via Zerion.
//
// Por que existe: ler um endereço em N redes por RPC custa N leituras. O split
// novo do swaps.pro vive em OITO redes — o fan-out por RPC seria oito vezes o
// tráfego por endereço, por página carregada. A Zerion devolve as posições de
// todas as redes numa chamada só. Uma requisição, não oito.
//
// A chave é write-only na Vercel: só o runtime a enxerga. Nada aqui imprime,
// loga ou grava a chave — só o resultado.
//
// REGRA QUE NÃO PODE CAIR: leitura que falha NUNCA vira zero. Um erro devolve
// `ok: false` e quem chama decide; devolver lista vazia faria um tesouro cheio
// parecer vazio, que é o pior erro possível nesta tela.
// ---------------------------------------------------------------------------

/** id de rede da Zerion → a chave que o portal usa. Rede não mapeada passa com
 *  o próprio id: perder a posição seria pior que exibir um nome cru. */
const CHAIN_KEY: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  optimism: "optimism",
  arbitrum: "arbitrum",
  polygon: "polygon",
  "binance-smart-chain": "bsc",
  xdai: "gnosis",
  avalanche: "avalanche",
};

export type ZerionToken = {
  symbol: string;
  chain: string;
  balance: number;
  valueUsd: number | null;
  untrusted: boolean;
  suspicious: boolean;
};

export type ZerionRead =
  | { ok: true; tokens: ZerionToken[]; chains: string[]; totalUsd: number }
  | { ok: false; error: string };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ZerionRead }>();

type Position = {
  attributes?: {
    quantity?: { numeric?: string; float?: number };
    value?: number | null;
    fungible_info?: { symbol?: string; name?: string; flags?: { verified?: boolean } };
    flags?: { displayable?: boolean };
  };
  relationships?: { chain?: { data?: { id?: string } } };
};

/**
 * Posições fungíveis de um endereço em TODAS as redes, numa requisição.
 *
 * `only_simple` exclui posições de protocolo (staking/LP), que têm outra
 * semântica e não somam como saldo à vista. `only_non_trash` é o filtro de spam
 * da própria Zerion — primeira linha de defesa contra token de phishing, mas
 * NÃO a única: o nome continua sendo texto de terceiro e passa pelo mesmo
 * saneamento dos tokens vindos de indexador.
 */
export async function zerionBalances(address: string): Promise<ZerionRead> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { ok: false, error: "endereço inválido" };

  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) return { ok: false, error: "ZERION_API_KEY não configurada" };

  const url =
    `https://api.zerion.io/v1/wallets/${addr}/positions/` +
    `?filter[positions]=only_simple&currency=usd&filter[trash]=only_non_trash`;

  let out: ZerionRead;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `Zerion HTTP ${res.status}` };
    const body = (await res.json()) as { data?: Position[] };
    const rows = Array.isArray(body.data) ? body.data : [];

    const tokens: ZerionToken[] = [];
    const chains = new Set<string>();
    for (const p of rows) {
      const a = p.attributes ?? {};
      const rawChain = p.relationships?.chain?.data?.id ?? "";
      const chain = CHAIN_KEY[rawChain] ?? sanitizeTokenLabel(rawChain, SYMBOL_MAX) ?? rawChain;
      const balance = a.quantity?.float ?? Number(a.quantity?.numeric ?? 0);
      if (!Number.isFinite(balance) || balance <= 0) continue;

      const rawSymbol = a.fungible_info?.symbol ?? a.fungible_info?.name ?? "?";
      const symbol = sanitizeTokenLabel(rawSymbol, SYMBOL_MAX) || "?";
      // "verified" é o julgamento da Zerion, não nosso: mesmo verificado o texto
      // segue vindo de fora, então continua marcado como não-confiável para a UI
      // decidir como exibir.
      const suspicious = labelLooksHostile(rawSymbol, a.fungible_info?.name ?? "");

      tokens.push({
        symbol,
        chain,
        balance,
        valueUsd: typeof a.value === "number" ? a.value : null,
        untrusted: true,
        suspicious,
      });
      chains.add(chain);
    }

    tokens.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0));
    out = {
      ok: true,
      tokens,
      chains: [...chains].sort(),
      totalUsd: tokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
    };
  } catch (e) {
    // Timeout/rede: erro explícito. Nunca zero.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  cache.set(addr, { at: Date.now(), value: out });
  return out;
}
