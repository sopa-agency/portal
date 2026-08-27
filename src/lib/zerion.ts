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
  /** URL do logo do token, quando a Zerion tem. É imagem de terceiro: vale como
   *  enfeite, NUNCA como prova de que o token é legítimo — um token de phishing
   *  também traz logo bonito. Por isso `untrusted`/`suspicious` continuam
   *  mandando na forma como a linha é exibida. */
  icon: string | null;
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
    fungible_info?: { symbol?: string; name?: string; icon?: { url?: string }; flags?: { verified?: boolean } };
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
        icon: typeof a.fungible_info?.icon?.url === "string" ? a.fungible_info.icon.url : null,
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

// ---------------------------------------------------------------------------
// Sonda de FORMATO.
//
// O parser acima foi escrito contra a documentação, não contra uma resposta
// real: a chave é write-only na Vercel, então ninguém consegue rodar um curl de
// fora. Se `quantity.float` ou `chain.data.id` tiverem outro nome, zerionBalances
// devolve lista vazia — e tesouro cheio vira tesouro vazio na tela.
//
// Esta sonda roda DENTRO do runtime, que tem a chave, e grava um resumo do
// FORMATO: quantos itens vieram, quais ids de rede apareceram e se cada campo
// que o parser depende chegou preenchido. Sem valores de saldo, sem nome de
// token (texto de terceiro), sem a chave. Só o suficiente para provar ou
// derrubar o mapeamento.
// ---------------------------------------------------------------------------
export async function zerionShapeProbe(address: string): Promise<Record<string, unknown>> {
  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) return { ok: false, error: "sem chave" };
  try {
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${address.toLowerCase()}/positions/?filter[positions]=only_simple&currency=usd&filter[trash]=only_non_trash`,
      { headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as { data?: Position[] };
    const rows = Array.isArray(body.data) ? body.data : [];
    const chainIds = [...new Set(rows.map((r) => r.relationships?.chain?.data?.id).filter(Boolean))];
    const has = (f: (p: Position) => unknown) => rows.filter((r) => f(r) != null).length;
    return {
      ok: true,
      status: res.status,
      itens: rows.length,
      chainIds,                                  // alimenta o mapa CHAIN_KEY
      comQuantityFloat: has((r) => r.attributes?.quantity?.float),
      comQuantityNumeric: has((r) => r.attributes?.quantity?.numeric),
      comValue: has((r) => r.attributes?.value),
      comSymbol: has((r) => r.attributes?.fungible_info?.symbol),
      chavesTopo: rows[0] ? Object.keys(rows[0].attributes ?? {}) : [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Histórico de valor da carteira, direto da Zerion.
//
// Isto existe porque a Zerion JÁ guarda o histórico: acumular snapshot próprio
// para desenhar a mesma linha significaria esperar semanas por um dado que a
// API entrega pronto, com meses de profundidade, na primeira chamada.
//
// RACIONADO: pelo que o swaps.pro documenta, este endpoint divide um quarto da
// cota do plano com PnL e posições DeFi, e essa fatia NÃO tem overage. Por isso
// o cache é por período e agressivo — um gráfico de um mês não muda de minuto
// em minuto, e só os períodos curtos precisam ser frescos.
// ---------------------------------------------------------------------------

export const CHART_PERIODS = ["day", "week", "month", "3months", "year", "max"] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

const CHART_TTL_MS: Record<ChartPeriod, number> = {
  day: 300_000,
  week: 900_000,
  month: 3_600_000,
  "3months": 3_600_000,
  year: 21_600_000,
  max: 43_200_000,
};

export type ZerionChart = { ok: true; points: { t: number; v: number }[] } | { ok: false; error: string };

const chartCache = new Map<string, { at: number; value: ZerionChart }>();

export async function zerionChart(address: string, period: ChartPeriod): Promise<ZerionChart> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { ok: false, error: "endereço inválido" };

  const ck = `${addr}:${period}`;
  const hit = chartCache.get(ck);
  if (hit && Date.now() - hit.at < CHART_TTL_MS[period]) return hit.value;

  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) return { ok: false, error: "ZERION_API_KEY não configurada" };

  try {
    const res = await fetch(`https://api.zerion.io/v1/wallets/${addr}/charts/${period}?currency=usd`, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `Zerion HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { attributes?: { points?: unknown[] } } };
    const raw = Array.isArray(body.data?.attributes?.points) ? body.data.attributes.points : [];
    // Cada ponto é [segundos unix, valor].
    const points = raw
      .map((p) => (Array.isArray(p) ? { t: Number(p[0]), v: Number(p[1]) } : null))
      .filter((p): p is { t: number; v: number } => !!p && Number.isFinite(p.t) && Number.isFinite(p.v));
    const out: ZerionChart = { ok: true, points };
    chartCache.set(ck, { at: Date.now(), value: out });
    return out;
  } catch (e) {
    // Falha NUNCA vira série vazia silenciosa — quem chama decide o que exibir.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
