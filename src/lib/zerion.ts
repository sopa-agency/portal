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
  /** Sem verificação da Zerion. É o que acende a etiqueta na linha. */
  untrusted: boolean;
  suspicious: boolean;
  /** URL do logo do token, quando a Zerion tem. É imagem de terceiro: vale como
   *  enfeite, NUNCA como prova de que o token é legítimo — um token de phishing
   *  também traz logo bonito. Por isso `untrusted`/`suspicious` continuam
   *  mandando na forma como a linha é exibida. */
  icon: string | null;
  /** "wallet" = solto; qualquer outro valor = posição de protocolo (staked,
   *  deposit, loan…). É o que separa "tenho na mão" de "está rendendo". */
  kind: string | null;
  /** Protocolo que detém a posição, quando houver (Morpheus, Moonwell…). */
  protocol: string | null;
  /**
   * O julgamento da Zerion sobre o token ter liquidez e preço confiáveis.
   *
   * NÃO confundir com `untrusted`, que vale para TODOS: aquele diz "este texto
   * veio de fora, trate o rótulo com desconfiança". Este diz outra coisa —
   * "existe mercado para isto". É o que separa USDC de GOCHU.
   */
  verified: boolean;
};

export type ZerionRead =
  | {
      ok: true;
      tokens: ZerionToken[];
      chains: string[];
      /** Soma do que é VERIFICADO. É este que pode ser chamado de tesouro. */
      totalUsd: number;
      /** O que a Zerion precifica mas não verifica. Não some — fica ao lado. */
      unverifiedUsd: number;
      unverifiedCount: number;
    }
  | { ok: false; error: string };

// SEGUNDOS, não milissegundos: isto vai para `next: { revalidate }`, que é o
// cache de DADOS do deployment — compartilhado entre instâncias e usuários,
// chaveado pela URL inteira (que já carrega endereço e filtro).
//
// Por que não um Map neste módulo, que era o que eu tinha: cache por processo
// protege UMA instância e não protege a cota de nada. Na Vercel cada instância
// tem o próprio Map, então a cota viraria função de tráfego × instâncias em vez
// de função de PERGUNTAS DISTINTAS. Lição paga pelo swaps.pro, portada.
const TTL_S = 60;
const TTL_PROTOCOL_S = 300;

type Position = {
  attributes?: {
    quantity?: { numeric?: string; float?: number };
    value?: number | null;
    fungible_info?: { symbol?: string; name?: string; icon?: { url?: string }; flags?: { verified?: boolean } };
    position_type?: string;
    protocol?: string;
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
export async function zerionBalances(
  address: string,
  /**
   * "simple" = só o que está solto na carteira. "all" inclui POSIÇÕES DE
   * PROTOCOLO — staking, LP, lending — que é onde mora o dinheiro que saiu da
   * carteira sem sair do tesouro. Foi a ausência disto que fez o multisig da
   * SkateHive parecer ter perdido dinheiro quando na verdade tinha feito stake.
   *
   * "all" NÃO é o padrão de propósito: pelo que o swaps.pro documenta, posição
   * de protocolo cobra da fatia racionada da cota (a mesma do gráfico e do PnL),
   * que não tem overage. Só o tesouro liga isso, e com cache mais longo.
   */
  positions: "simple" | "all" = "simple",
): Promise<ZerionRead> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { ok: false, error: "endereço inválido" };

  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) return { ok: false, error: "ZERION_API_KEY não configurada" };

  const url =
    `https://api.zerion.io/v1/wallets/${addr}/positions/` +
    `?filter[positions]=${positions === "all" ? "no_filter" : "only_simple"}` +
    `&currency=usd&filter[trash]=only_non_trash&sort=-value`;

  let out: ZerionRead;
  try {
    const res = await fetch(url, {
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, accept: "application/json" },
      // Posição de protocolo cobra da fatia racionada da cota — cacheia mais.
      next: { revalidate: positions === "all" ? TTL_PROTOCOL_S : TTL_S },
      signal: AbortSignal.timeout(20_000),
    });
    // Status repassado: 401 é a chave, 429 é o plano. Colapsar os dois manda a
    // gente caçar o problema errado.
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
      const verified = a.fungible_info?.flags?.verified === true;

      // AVISO QUE APARECE EM TUDO NÃO AVISA NADA.
      //
      // Antes, TODO token vinha marcado como não-confiável — o texto vem de
      // fora, então a régua era essa. O resultado na tela: ETH, USDC e stETH
      // com etiqueta de alerta, lado a lado com o airdrop de verdade. Quem lê
      // aprende em dois segundos que a etiqueta não quer dizer nada, e aí ela
      // não protege mais no dia em que aparece no token que importa. É o mesmo
      // erro do aviso falso de "não consegui ler" que a gente tirou do split.
      //
      // `labelLooksHostile` marca quem usa um ticker famoso, e o comentário
      // dela sempre disse para que serve: "só chame para rótulo de indexador —
      // um USDC declarado no config é o real". No caminho do RPC isso bastava,
      // porque o config era a prova. Agora TUDO vem da Zerion, e a prova passou
      // a ser a flag `verified` dela.
      //
      // Então: verificado = o token é quem diz ser, sem etiqueta. Não
      // verificado = segue como antes, e se ainda por cima usa ticker famoso,
      // vira o alerta forte — que é exatamente o caso perigoso de verdade.
      const suspicious = !verified && labelLooksHostile(rawSymbol, a.fungible_info?.name ?? "");

      tokens.push({
        symbol,
        chain,
        balance,
        valueUsd: typeof a.value === "number" ? a.value : null,
        untrusted: !verified,
        suspicious,
        verified,
        icon: typeof a.fungible_info?.icon?.url === "string" ? a.fungible_info.icon.url : null,
        kind: typeof a.position_type === "string" ? a.position_type : null,
        protocol: typeof a.protocol === "string" ? sanitizeTokenLabel(a.protocol, SYMBOL_MAX) || null : null,
      });
      chains.add(chain);
    }

    tokens.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0));

    // O total conta só o que a Zerion verifica, e o não-verificado viaja ao
    // lado — contado e somado, para a tela mostrar sem misturar.
    //
    // CORREÇÃO DE UMA ACUSAÇÃO FALSA QUE ESTEVE AQUI. Este comentário dizia que
    // a Zerion inflava o multisig da SkateHive em ~US$ 2.100 de airdrop, e que
    // por isso o filtro era essencial. Medido depois, com o número na mão: os
    // não-verificados daquela carteira somam US$ 0,02. A diferença de US$ 2.117
    // para o leitor por RPC era DINHEIRO DE VERDADE que o RPC não enxerga —
    // stETH travado na MorpheusAI (US$ 1.916) e USDC depositado na Morpho
    // (US$ 200). A Zerion estava certa e eu estava errado.
    //
    // Como o erro foi cometido, porque a forma dele importa mais que o número:
    // comparei a lista de ERC-20 da Base no Blockscout (US$ 63 precificados,
    // resto poeira) contra o total MULTI-REDE E COM PROTOCOLO da Zerion, e
    // atribuí a diferença à poeira. Duas fontes com COBERTURAS diferentes, e a
    // lacuna creditada à explicação errada.
    //
    // O filtro fica: contar só o verificado continua certo por princípio, e o
    // custo dele aqui é US$ 0,02. O que não fica é a justificativa inventada.
    const verificados = tokens.filter((t) => t.verified);
    const resto = tokens.filter((t) => !t.verified);
    out = {
      ok: true,
      tokens,
      chains: [...chains].sort(),
      totalUsd: verificados.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
      unverifiedUsd: resto.reduce((s, t) => s + (t.valueUsd ?? 0), 0),
      unverifiedCount: resto.length,
    };
  } catch (e) {
    // Timeout/rede: erro explícito. Nunca zero.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

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
      `https://api.zerion.io/v1/wallets/${address.toLowerCase()}/positions/?filter[positions]=no_filter&currency=usd&filter[trash]=only_non_trash`,
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
      comIcon: has((r) => r.attributes?.fungible_info?.icon?.url),
      tiposDePosicao: [...new Set(rows.map((r) => r.attributes?.position_type).filter(Boolean))],
      protocolos: [...new Set(rows.map((r) => r.attributes?.protocol).filter(Boolean))].slice(0, 8),
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

/** SEGUNDOS, para o data cache do deployment. Um gráfico de um mês não muda de
 *  minuto em minuto; só os períodos curtos precisam ser frescos. */
const CHART_TTL_S: Record<ChartPeriod, number> = {
  day: 300,
  week: 900,
  month: 3_600,
  "3months": 3_600,
  year: 21_600,
  max: 43_200,
};

export type ZerionChart = { ok: true; points: { t: number; v: number }[] } | { ok: false; error: string };

export async function zerionChart(address: string, period: ChartPeriod): Promise<ZerionChart> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { ok: false, error: "endereço inválido" };

  const key = process.env.ZERION_API_KEY?.trim();
  if (!key) return { ok: false, error: "ZERION_API_KEY não configurada" };

  try {
    // `filter[positions]=no_filter` É O CONSERTO, e a assimetria era o defeito:
    // a chamada de SALDO já pedia no_filter (inclui posição de protocolo) e a de
    // GRÁFICO não pedia nada, ficando no padrão da Zerion, que é só token solto
    // na carteira.
    //
    // O efeito na tela: fazer stake tirava o token da carteira, a linha DESCIA,
    // e o total ao lado continuava igual — porque ele conta a posição. Movimento
    // interno aparecia como perda de dinheiro, no gráfico que existe justamente
    // para mostrar se o tesouro está subindo ou caindo.
    //
    // `only_non_trash` acompanha para o gráfico não passar a somar airdrop que o
    // saldo já descarta — as duas chamadas precisam responder sobre a MESMA
    // carteira, senão trocamos um desencontro por outro.
    const res = await fetch(
      `https://api.zerion.io/v1/wallets/${addr}/charts/${period}` +
        `?currency=usd&filter[positions]=no_filter&filter[trash]=only_non_trash`,
      {
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, accept: "application/json" },
        next: { revalidate: CHART_TTL_S[period] },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return { ok: false, error: `Zerion HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { attributes?: { points?: unknown[] } } };
    const raw = Array.isArray(body.data?.attributes?.points) ? body.data.attributes.points : [];
    // Cada ponto é [segundos unix, valor].
    const points = raw
      .map((p) => (Array.isArray(p) ? { t: Number(p[0]), v: Number(p[1]) } : null))
      .filter((p): p is { t: number; v: number } => !!p && Number.isFinite(p.t) && Number.isFinite(p.v));
    return { ok: true, points };
  } catch (e) {
    // Falha NUNCA vira série vazia silenciosa — quem chama decide o que exibir.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
