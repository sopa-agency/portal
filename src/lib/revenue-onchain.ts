import "server-only";
import { getPrices } from "@/lib/treasury";

// Keyless on-chain revenue history for a tracked address, via Blockscout's public
// v2 API (no API key). Answers "quanto foi pago PELO/AO contrato": inflows
// (received), outflows (paid out to recipients), and a cumulative-received time
// series for the profit chart. Values counted in USDC + ETH/WETH only — memecoin
// dust is ignored (same philosophy as the treasury tracker).

const BLOCKSCOUT_HOST: Record<string, string> = {
  base: "base.blockscout.com",
  ethereum: "eth.blockscout.com",
  optimism: "optimism.blockscout.com",
  arbitrum: "arbitrum.blockscout.com",
};

const MAX_PAGES = 5; // ~250 events/source — bounds cost on busy addresses
const STABLE = new Set(["USDC", "USDBC", "DAI", "USDT"]);
const ETHy = new Set(["WETH", "ETH"]);

export type RevenueFlow = {
  receivedUsd: number;
  paidUsd: number;
  /** Cumulative received (USD) over time — the revenue/profit curve. */
  series: { t: string; usd: number }[];
  truncated: boolean;
  error?: string;
};

type Ev = { t: number; usd: number; dir: 1 | -1 }; // dir +1 = inflow, -1 = outflow

async function bs(host: string, path: string, params: Record<string, string> = {}): Promise<{ items?: unknown[]; next_page_params?: Record<string, string> | null } | null> {
  const url = new URL(`https://${host}/api/v2${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, // 5s, nao 12s. Este indexador esta FORA (500 na Base) e cada tentativa
    // queimava doze segundos antes de desistir — vezes o numero de enderecos,
    // dentro do caminho do render. Um Blockscout saudavel responde em menos de
    // um segundo; cinco ja e' generoso, e o fallback existe justamente para
    // quando ele nao responde.
    signal: AbortSignal.timeout(5000), next: { revalidate: 300, tags: ["revenue"] } });
    if (!r.ok) return null;
    return (await r.json()) as { items?: unknown[]; next_page_params?: Record<string, string> | null };
  } catch {
    return null;
  }
}

/** Page a Blockscout collection up to MAX_PAGES, returning all items + whether it was cut off. */
async function pageAll(host: string, path: string): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = [];
  let next: Record<string, string> | null | undefined = {};
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const res = await bs(host, path, pages === 0 ? {} : next);
    if (!res) break;
    items.push(...((res.items as Record<string, unknown>[]) ?? []));
    next = res.next_page_params;
    pages++;
  }
  return { items, truncated: !!next };
}

const lc = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : (v as { hash?: string })?.hash?.toLowerCase() ?? "");

// --- realized revenue via decoded events (accurate, no refund/spend noise) ----
// AuctionSettled(amount) = a Nouns Builder auction's winning bid (ETH). 0xSplits
// SplitDistributed(token, distributor, amount) = a distribution. Blockscout
// decodes both; we sum the amounts → true gross revenue, with a time series.

const STABLE_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC base
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 6, // USDbC base
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC ethereum
};
const WETH = new Set([
  "0x4200000000000000000000000000000000000006", // base/op
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // ethereum
]);
const NATIVE = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);

/**
 * Tokens que não são dólar nem ether e mesmo assim têm preço.
 *
 * O MOR estava de fora, e o efeito era concreto: distribuições em MOR caíam em
 * "token sem preço" e o split do swaps.pro rendia zero — mérito zero para quem
 * o trouxe. O preço já existia no portal (`getPrices().mor`, do CoinGecko); só
 * este leitor não o conhecia.
 *
 * Preço nulo continua sendo "sem preço", nunca zero: valorar a zero
 * subcontaria a receita em silêncio, que é pior que dizer que não sei.
 */
const PRECIFICADOS: Record<string, { decimais: number; preco: "mor" }> = {
  "0x7431ada8a591c955a994a21710752ef9b882b8e3": { decimais: 18, preco: "mor" }, // MOR base
};

export type RealizedRevenue = {
  method: "auction" | "split" | "none";
  revenueUsd: number;
  count: number;
  series: { t: string; usd: number }[]; // cumulative
  truncated: boolean;
  /** Preenchido quando o histórico NÃO pôde ser calculado. Sem isso, "não deu
   *  pra ler" e "não houve receita" são o mesmo zero na tela. */
  error?: string;
};

type DecodedLog = {
  block_timestamp?: string;
  decoded?: { method_call?: string; parameters?: { name?: string; value?: unknown }[] } | null;
};

const REALIZED_MAX_PAGES = 40; // ~2000 logs — full history for these DAOs

// ---------------------------------------------------------------------------
// Caminho 2: a cadeia, direto. Existe porque o caminho 1 caiu.
//
// O Blockscout da Base devolve 500 no /addresses/{addr}/logs — hoje, medido,
// nos quatro splits que a página acompanha. E o efeito disso era o pior
// possível: `bs()` devolvia null, o laço dava break, e a função retornava
// revenueUsd 0 SEM error. A tela lia esse zero e escrevia "no distribution
// yet" em splits que tinham 16, 5 e 3 distribuições. Não é que não tenha
// entrado dinheiro — é que ninguém conseguiu ler. São coisas diferentes, e a
// diferença é toda a diferença num painel de receita.
//
// eth_getLogs não depende de indexador. É a mesma rota que o splits.ts já usa
// para ler a configuração do split, pelos mesmos RPCs.
// ---------------------------------------------------------------------------

/** SplitDistributed(address indexed token, address indexed distributor, uint256 amount) */
/**
 * keccak256("AuctionSettled(uint256,address,uint256)") — Nouns Builder.
 *
 * NADA é indexado neste evento: os três parâmetros vivem no `data`, e o valor
 * é a TERCEIRA palavra. Ler a primeira devolve o tokenId, que é um número
 * grande e plausível — o tipo de erro que passa por receita sem ninguém
 * desconfiar. Conferido contra os logs reais da casa de leilão da Gnars.
 */
const AUCTION_SETTLED_TOPIC = "0xc9f72b276a388619c6d185d146697036241880c36654b1a3ffdad07c24038d99";

const SPLIT_DISTRIBUTED_TOPIC = "0x562c19c0e7b3493417e3cf5103baa939f4d0e9c1087be236aebb46b84e09c7d9";

const LOG_RPCS: Record<string, string[]> = {
  base: ["https://base.gateway.tenderly.co", "https://gateway.tenderly.co/public/base", "https://mainnet.base.org"],
  ethereum: ["https://gateway.tenderly.co/public/mainnet"],
  optimism: ["https://gateway.tenderly.co/public/optimism"],
  arbitrum: ["https://gateway.tenderly.co/public/arbitrum"],
};

/**
 * Um valor bruto de token em dólar — ou `null` quando não há preço.
 *
 * Existe para os DOIS caminhos (indexador e RPC) usarem a mesma tabela. Antes
 * a conversão estava escrita duas vezes, e adicionar um token significava
 * lembrar dos dois lugares — o tipo de coisa que se lembra uma vez e esquece na
 * seguinte.
 */
function emDolar(token: string, raw: number, ethPrice: number, morPrice: number | null): number | null {
  if (STABLE_DECIMALS[token]) return raw / 10 ** STABLE_DECIMALS[token];
  if (WETH.has(token) || NATIVE.has(token)) return (raw / 1e18) * ethPrice;
  const p = PRECIFICADOS[token];
  // Token conhecido cujo preço não leu: continua "sem preço". Zero aqui
  // subcontaria a receita calada.
  if (p) return morPrice == null ? null : (raw / 10 ** p.decimais) * morPrice;
  return null;
}

type RpcLeitura = { evs: { t: number; usd: number; bloco?: string }[]; semPreco: number } | null;

/**
 * Distribuições de um split numa rede, lidas por eth_getLogs.
 *
 * Devolve null quando NENHUM RPC respondeu — null é "não sei", e quem chama tem
 * que tratá-lo diferente de uma lista vazia, que é "li e não houve nenhuma".
 * Foi exatamente essa distinção que faltava e produziu o "no distribution yet".
 *
 * `semPreco` conta as distribuições cujo token a gente não sabe precificar. Elas
 * NÃO entram no total como zero: entram nesta contagem, para a tela poder dizer
 * que o número é um piso.
 */
async function distribuicoesPorRpc(addr: string, chain: string, ethPrice: number, morPrice: number | null): Promise<RpcLeitura> {
  const rpcs = LOG_RPCS[chain] ?? [];
  for (const rpc of rpcs) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 6s, e nao 20s. Este fetch ja rodou dentro do caminho do render, com
        // tres RPCs em cascata: 3 x 20s = um minuto por endereco quando a rede
        // engasga. Timeout generoso e' generosidade com a maquina e crueldade
        // com quem esta esperando a pagina.
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getLogs",
          // Os DOIS eventos numa consulta só. Antes só o split era procurado,
          // e uma casa de leilão lida por aqui devolvia zero SEM erro — o zero
          // mudo que esta base inteira existe para não produzir.
          params: [{ address: addr, fromBlock: "0x0", toBlock: "latest", topics: [[SPLIT_DISTRIBUTED_TOPIC, AUCTION_SETTLED_TOPIC]] }],
        }),
      });
      const j = (await r.json()) as { result?: { topics: string[]; data: string; blockNumber: string }[]; error?: unknown };
      if (j.error || !Array.isArray(j.result)) continue;

      const evs: { t: number; usd: number; bloco?: string }[] = [];
      let semPreco = 0;
      const palavra = (d: string, i: number): bigint => {
        const inicio = 2 + i * 64;
        const p = (d ?? "").slice(inicio, inicio + 64);
        return p.length === 64 ? BigInt("0x" + p) : BigInt(0);
      };
      for (const log of j.result) {
        if (log.topics[0] === AUCTION_SETTLED_TOPIC) {
          // (tokenId, winner, amount) — tudo no data, valor na terceira palavra.
          // Leilão sem lance liquida com vencedor zero e valor zero: não é
          // receita, e entrar como evento inflaria a contagem.
          const wei = palavra(log.data, 2);
          if (wei > BigInt(0)) evs.push({ t: 0, usd: (Number(wei) / 1e18) * ethPrice, bloco: log.blockNumber });
          continue;
        }
        // topic1 = token (endereço nos 20 bytes finais da palavra de 32)
        const token = ("0x" + (log.topics[1] ?? "").slice(26)).toLowerCase();
        const raw = Number(BigInt(log.data || "0x0"));
        const usd = emDolar(token, raw, ethPrice, morPrice);
        if (usd == null) {
          semPreco++;
          continue;
        }
        if (usd > 0) evs.push({ t: 0, usd, bloco: log.blockNumber });
      }

      // AS DATAS. Antes este caminho devolvia série vazia — "o log traz bloco,
      // não data" — e isso bastava enquanto só o TOTAL importava. Passou a não
      // bastar: o mérito recorta os últimos 90 dias, e uma série sem data não
      // tem o que recortar. Sem isto, toda fonte lida por RPC rendia mérito
      // zero para sempre, e o zero parecia falta de receita em vez de falta de
      // relógio.
      //
      // Custa UMA requisição, não uma por bloco: os blocos distintos vão num
      // lote só. São poucos — um split distribui punhados de vezes, não
      // milhares.
      // AS DATAS, SEM PEDIR UMA POR BLOCO.
      //
      // A tentativa anterior buscava o timestamp de cada bloco distinto em
      // lote. Funcionava com quinze; morria com mil. Medido: o gateway conta
      // CADA item do lote contra o limite (429 a partir de ~25), e cada
      // cabeçalho de bloco pesa ~19 KB — datar seiscentos blocos daria dezenas
      // de requisições e megabytes, para responder uma pergunta de sim ou não
      // ("caiu dentro dos 90 dias?").
      //
      // Duas leituras bastam: um bloco recente e um antigo dão o ritmo real da
      // cadeia, e daí o instante de qualquer bloco sai por interpolação. É
      // APROXIMADO e está dito: o erro é de minutos ao longo de meses, e a
      // única coisa que ele decide é de que lado de um corte de 90 dias um
      // evento cai. Errar isso por minutos é aceitável; não ter data nenhuma,
      // como antes, deixava todo o mérito em zero.
      const numeros = evs.map((e) => (e.bloco ? Number(BigInt(e.bloco)) : 0)).filter((n) => n > 0);
      if (numeros.length) {
        try {
          const alto = Math.max(...numeros);
          const baixo = Math.min(...numeros);
          const pedir = async (n: number) => {
            const rr = await fetch(rpc, {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: AbortSignal.timeout(8000),
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] }),
            });
            const jj = (await rr.json()) as { result?: { timestamp?: string } };
            return jj?.result?.timestamp ? Number(BigInt(jj.result.timestamp)) * 1000 : 0;
          };
          const tAlto = await pedir(alto);
          // Um bloco só: não dá para medir ritmo, e todos os eventos ficam com
          // a data dele. Serve porque nesse caso todos ESTÃO nesse bloco.
          const tBaixo = baixo === alto ? tAlto : await pedir(baixo);
          if (tAlto > 0 && tBaixo > 0) {
            const msPorBloco = alto === baixo ? 0 : (tAlto - tBaixo) / (alto - baixo);
            for (const e of evs) {
              const n = e.bloco ? Number(BigInt(e.bloco)) : 0;
              e.t = n > 0 ? Math.round(tAlto - (alto - n) * msPorBloco) : 0;
            }
          }
        } catch {
          // Sem referência não há data: o evento continua no total e fica fora
          // de qualquer janela. Menos errado que carimbar "hoje" nele.
        }
      }
      return { evs, semPreco };
    } catch {
      // próximo RPC
    }
  }
  return null;
}

/** Sum realized revenue from a contract's decoded events (AuctionSettled / SplitDistributed). */
export async function fetchOnchainRevenue(address: string, chainKey: string | null): Promise<RealizedRevenue> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { method: "none", revenueUsd: 0, count: 0, series: [], truncated: false };
  // NUNCA cair na Base por omissão. O mapa antes fazia `chainKey ?? "base"` com
  // um segundo `?? base`, então rede nula E rede desconhecida liam a Base e
  // devolviam um número com cara de certo — para um contrato que pode nem
  // existir lá. Um stream multi-rede não tem host único, e o Blockscout não tem
  // instância para bsc nem avalanche (404) e a de polygon responde 500: somar
  // as que existem e chamar de total seria a mesma mentira em outra forma.
  const host = chainKey ? BLOCKSCOUT_HOST[chainKey] : undefined;
  // getPrices() now returns null when CoinGecko gives no ETH price. Historical
  // revenue math has no honest answer in that case: valuing ETH events at 0
  // undercounts, and failing the whole read turns a price blip into "revenue 0"
  // at the call sites that catch (sopa-boards.ts). Keeping the previous
  // behaviour on purpose — the fix is a degraded-result flag on
  // RealizedRevenue/RevenueFlow, which is its own change.
  const precos = await getPrices();
  const ethPrice = precos.eth ?? 0;
  // Preço do MOR: null quando o CoinGecko não respondeu. Null vira "sem preço"
  // lá na frente, nunca zero — ver emDolar().
  const morPrice = precos.mor;

  // Page decoded logs.
  const items: DecodedLog[] = [];
  let next: Record<string, string> | null | undefined = {};
  let pages = 0;
  let indexadorRespondeu = false;
  while (host && next && pages < REALIZED_MAX_PAGES) {
    const res = await bs(host, `/addresses/${addr}/logs`, pages === 0 ? {} : (next as Record<string, string>));
    if (!res) break;
    indexadorRespondeu = true;
    items.push(...((res.items as DecodedLog[]) ?? []));
    next = res.next_page_params;
    pages++;
  }
  const truncated = !!next && indexadorRespondeu;

  const param = (log: DecodedLog, name: string): string | undefined =>
    log.decoded?.parameters?.find((p) => p.name === name)?.value as string | undefined;

  type Ev = { t: number; usd: number };
  const auctions: Ev[] = [];
  const splits: Ev[] = [];
  for (const log of items) {
    const call = log.decoded?.method_call ?? "";
    const t = Date.parse(log.block_timestamp ?? "") || 0;
    if (call.startsWith("AuctionSettled")) {
      const amt = Number(param(log, "amount") ?? 0) / 1e18;
      if (amt > 0) auctions.push({ t, usd: amt * ethPrice });
    } else if (call.startsWith("SplitDistributed")) {
      const token = (param(log, "token") ?? "").toLowerCase();
      const raw = Number(param(log, "amount") ?? 0);
      const usd = emDolar(token, raw, ethPrice, morPrice);
      if (usd != null && usd > 0) splits.push({ t, usd });
    }
  }

  // O INDEXADOR NÃO ENTREGOU. Antes isto acabava em `revenueUsd: 0` sem error,
  // e a tela escrevia "no distribution yet". Agora a cadeia é perguntada direto.
  if (!auctions.length && !splits.length) {
    const redes = chainKey ? [chainKey] : Object.keys(LOG_RPCS);
    let total = 0;
    let n = 0;
    let semPreco = 0;
    const naoLidas: string[] = [];
    const todos: { t: number; usd: number }[] = [];
    for (const rede of redes) {
      const r = await distribuicoesPorRpc(addr, rede, ethPrice, morPrice);
      if (!r) {
        naoLidas.push(rede);
        continue;
      }
      for (const e of r.evs) {
        total += e.usd;
        todos.push({ t: e.t, usd: e.usd });
      }
      n += r.evs.length;
      semPreco += r.semPreco;
    }

    // Nenhuma rede lida: isso é NÃO SEI, e sai dito. O zero desta linha nunca
    // mais pode passar por "não houve distribuição".
    if (naoLidas.length === redes.length) {
      return {
        method: "none", revenueUsd: 0, count: 0, series: [], truncated: false,
        error: `não consegui ler as distribuições (${redes.join(", ")}) — nem indexador nem RPC responderam`,
      };
    }

    const ressalvas: string[] = [];
    // Uma rede não lida NÃO é uma rede sem receita. O total vira piso, e diz.
    if (naoLidas.length) ressalvas.push(`sem leitura em ${naoLidas.join(", ")}`);
    if (semPreco) ressalvas.push(`${semPreco} distribuição(ões) em token sem preço`);
    // Rede nula = o stream não declara cadeia. Varremos as que temos RPC; se
    // houver receita numa que não está na lista, ela não entra — e some-la em
    // silêncio seria repetir o erro de comparar coberturas diferentes.
    if (!chainKey) ressalvas.push(`redes lidas: ${redes.filter((r) => !naoLidas.includes(r)).join(", ")}`);

    return {
      method: n > 0 ? "split" : "none",
      revenueUsd: total,
      count: n,
      // A série agora existe também por aqui: os eventos que tiveram a data
      // lida entram em ordem, acumulados. Os sem data ficam de fora da série
      // (mas dentro do total) — melhor um ponto a menos que uma data inventada.
      series: (() => {
        const comData = todos.filter((e) => e.t > 0).sort((a, b) => a.t - b.t);
        let acc = 0;
        return comData.map((e) => ({ t: new Date(e.t).toISOString(), usd: (acc += e.usd) }));
      })(),
      truncated: false,
      ...(ressalvas.length ? { error: ressalvas.join("; ") } : {}),
    };
  }

  const chosen = auctions.length ? { evs: auctions, method: "auction" as const } : splits.length ? { evs: splits, method: "split" as const } : { evs: [], method: "none" as const };
  chosen.evs.sort((a, b) => a.t - b.t);
  let cum = 0;
  const series: { t: string; usd: number }[] = [];
  for (const e of chosen.evs) {
    cum += e.usd;
    if (e.t) series.push({ t: new Date(e.t).toISOString(), usd: cum });
  }
  return { method: chosen.method, revenueUsd: cum, count: chosen.evs.length, series, truncated };
}

// ---------------------------------------------------------------------------
// A porta que a PAGINA usa.
//
// `fetchOnchainRevenue` le a cadeia. Isso nao pode acontecer dentro de um
// render — foi assim que a pagina do tesouro foi de 12s para 26s. Aqui o
// caminho e: cache primeiro; se estiver velho ou vazio, uma leitura ao vivo com
// ORCAMENTO FECHADO, e o que nao couber no orcamento fica declarado como nao
// lido em vez de segurar a pagina.
//
// O `force` existe para o botao de atualizar: ali a pessoa PEDIU e esta olhando
// uma ampulheta, entao a espera e' esperada.
// ---------------------------------------------------------------------------

/** Quanto tempo uma leitura guardada vale. Distribuicao de split e evento raro:
 *  seis horas de idade nao muda decisao nenhuma, e a data viaja junto. */
const REVENUE_TTL_MS = 6 * 60 * 60_000;
/** Teto para a leitura ao vivo quando ela acontece no caminho do render. */
const REVENUE_BUDGET_MS = 8_000;

export async function fetchOnchainRevenueCached(
  address: string,
  chainKey: string | null,
  opts: { force?: boolean } = {},
): Promise<RealizedRevenue> {
  const { readRevenueCache, saveRevenueCache } = await import("@/lib/revenue-cache");
  if (!opts.force) {
    const guardado = await readRevenueCache(address, chainKey, REVENUE_TTL_MS);
    if (guardado) return guardado;
  }

  const ao_vivo = fetchOnchainRevenue(address, chainKey).then((r) => {
    void saveRevenueCache(address, chainKey, r);
    return r;
  });

  if (opts.force) return ao_vivo;

  // Sem force, a pagina nao espera indefinidamente. Estourou o orcamento: a
  // leitura CONTINUA em segundo plano e grava no cache (o proximo carregamento
  // ja acha), e esta resposta diz que nao leu — nunca que nao houve.
  const estourou = Symbol("estourou");
  const corrida = await Promise.race([
    ao_vivo,
    new Promise<typeof estourou>((r) => setTimeout(() => r(estourou), REVENUE_BUDGET_MS)),
  ]);
  if (corrida !== estourou) return corrida as RealizedRevenue;

  // Cache vencido serve melhor que nada — desde que se anuncie como velho.
  const velho = await readRevenueCache(address, chainKey, Infinity);
  if (velho) {
    return { ...velho, error: [velho.error, "leitura ao vivo demorou; este número é do último sync"].filter(Boolean).join("; ") };
  }
  return {
    method: "none", revenueUsd: 0, count: 0, series: [], truncated: false,
    error: "ainda não lido — a leitura on-chain está em andamento, recarregue em instantes",
  };
}

export async function fetchAddressFlows(address: string, chainKey: string | null): Promise<RevenueFlow> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return { receivedUsd: 0, paidUsd: 0, series: [], truncated: false, error: "endereço inválido" };
  // Mesma regra do fetchOnchainRevenue: sem host, sem número inventado.
  const host = chainKey ? BLOCKSCOUT_HOST[chainKey] : undefined;
  if (!host) {
    return {
      receivedUsd: 0, paidUsd: 0, series: [], truncated: false,
      error: chainKey
        ? `sem indexador para a rede "${chainKey}"`
        : "stream multi-rede: fluxo por indexador não cobre todas as redes",
    };
  }
  // getPrices() now returns null when CoinGecko gives no ETH price. Historical
  // revenue math has no honest answer in that case: valuing ETH events at 0
  // undercounts, and failing the whole read turns a price blip into "revenue 0"
  // at the call sites that catch (sopa-boards.ts). Keeping the previous
  // behaviour on purpose — the fix is a degraded-result flag on
  // RealizedRevenue/RevenueFlow, which is its own change.
  const ethPrice = (await getPrices()).eth ?? 0;

  const [erc20, internal, txs] = await Promise.all([
    pageAll(host, `/addresses/${addr}/token-transfers?type=ERC-20`),
    pageAll(host, `/addresses/${addr}/internal-transactions`),
    pageAll(host, `/addresses/${addr}/transactions`),
  ]);
  const truncated = erc20.truncated || internal.truncated || txs.truncated;
  const evs: Ev[] = [];

  // ERC-20 stablecoins + WETH.
  for (const it of erc20.items) {
    const token = it.token as { symbol?: string; decimals?: string } | undefined;
    const sym = (token?.symbol ?? "").toUpperCase();
    const isStable = STABLE.has(sym);
    const isEth = ETHy.has(sym);
    if (!isStable && !isEth) continue;
    const total = it.total as { value?: string; decimals?: string } | undefined;
    const dec = Number(total?.decimals ?? token?.decimals ?? (isStable ? 6 : 18));
    const amt = Number(total?.value ?? 0) / 10 ** dec;
    if (!(amt > 0)) continue;
    const usd = isStable ? amt : amt * ethPrice;
    const to = lc(it.to), from = lc(it.from);
    const t = Date.parse(String(it.timestamp ?? "")) || 0;
    if (to === addr) evs.push({ t, usd, dir: 1 });
    else if (from === addr) evs.push({ t, usd, dir: -1 });
  }

  // Native ETH (internal calls + top-level tx value), no double count: internal
  // = contract-mediated sub-calls; txs.value = top-level sends.
  for (const src of [internal.items, txs.items]) {
    for (const it of src) {
      const v = Number((it as { value?: string }).value ?? 0) / 1e18;
      if (!(v > 0)) continue;
      const usd = v * ethPrice;
      const to = lc(it.to), from = lc(it.from);
      const t = Date.parse(String((it as { timestamp?: string }).timestamp ?? "")) || 0;
      if (to === addr) evs.push({ t, usd, dir: 1 });
      else if (from === addr) evs.push({ t, usd, dir: -1 });
    }
  }

  evs.sort((a, b) => a.t - b.t);
  let receivedUsd = 0;
  let paidUsd = 0;
  const series: { t: string; usd: number }[] = [];
  for (const e of evs) {
    if (e.dir === 1) receivedUsd += e.usd;
    else paidUsd += e.usd;
    if (e.t) series.push({ t: new Date(e.t).toISOString(), usd: receivedUsd });
  }
  return { receivedUsd, paidUsd, series, truncated };
}
