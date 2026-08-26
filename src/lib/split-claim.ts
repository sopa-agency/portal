import "server-only";
import { createPublicClient, http, fallback, getAddress, formatUnits, type Address, type Chain } from "viem";
import { arbitrum, avalanche, base, gnosis, mainnet, optimism, polygon } from "viem/chains";
import { getSplitDistributeConfig, type SplitDistributeConfig } from "@/lib/splits";

// "Collect" a 0xSplits revenue split into the treasury without leaving the app.
// A split accrues fee revenue (USDC/WETH/MOR/…) but the money only reaches the
// recipients once someone calls `distribute()` — and, for a PullSplit, once each
// recipient `withdraw()`s their Warehouse credit. Both calls are permissionless
// (funds can only go to the split's fixed recipients), so any wallet can trigger
// them. This reads what's currently collectable so the UI can show + run it.
//
// Multi-rede. O split de fee do swaps.pro passou a existir em OITO redes, então
// prender isto na Base fazia a receita das outras sete ficar invisível E
// irrecolhível. Uma rede sem entrada em CHAINS falha fechada: devolve null, em
// vez de ler a Base e mostrar o saldo do contrato errado.

// O Warehouse do 0xSplits é CREATE2 determinístico: medi o bytecode em ethereum,
// base, optimism, arbitrum, polygon, bsc e avalanche e é byte a byte idêntico no
// mesmo endereço. Por isso é uma constante e não um mapa por rede.
const WAREHOUSE = getAddress("0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8");

type ClaimTokenDef = { address: Address; symbol: string; decimals: number };
type ChainDef = { chain: Chain; rpcs: string[]; tokens: ClaimTokenDef[] };

const t = (address: string, symbol: string, decimals: number): ClaimTokenDef => ({ address: getAddress(address), symbol, decimals });

// Os tokens de receita que varremos, POR REDE. Endereço de token não é o mesmo
// entre redes — usar a lista da Base em arbitrum leria contrato inexistente e
// reportaria zero com cara de saldo real.
const CHAINS: Record<string, ChainDef> = {
  base: {
    chain: base,
    rpcs: ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"],
    tokens: [
      t("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", 6),
      t("0xd9aaEC86B65D86f6A7B5B1b0c42FFA531710b6CA", "USDbC", 6),
      t("0x4200000000000000000000000000000000000006", "WETH", 18),
      t("0x7431aDa8a591C955a994a21710752EF9b882b8e3", "MOR", 18),
    ],
  },
  ethereum: {
    chain: mainnet,
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    tokens: [
      t("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", 6),
      t("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "WETH", 18),
    ],
  },
  optimism: {
    chain: optimism,
    rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
    tokens: [
      t("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "USDC", 6),
      t("0x4200000000000000000000000000000000000006", "WETH", 18),
    ],
  },
  arbitrum: {
    chain: arbitrum,
    rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    tokens: [
      t("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", 6),
      t("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "WETH", 18),
    ],
  },
  polygon: {
    chain: polygon,
    rpcs: ["https://polygon-bor-rpc.publicnode.com"],
    tokens: [
      t("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "USDC", 6),
      t("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "WPOL", 18),
    ],
  },
  gnosis: {
    chain: gnosis,
    rpcs: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"],
    tokens: [
      t("0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83", "USDC", 6),
      t("0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d", "WXDAI", 18),
    ],
  },
  avalanche: {
    chain: avalanche,
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com"],
    tokens: [
      t("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", "USDC", 6),
      t("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", "WAVAX", 18),
    ],
  },
};

/** Compat: a Base continua sendo a lista padrão para quem importava daqui. */
export const CLAIM_TOKENS = CHAINS.base.tokens;

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const warehouseAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/** Warehouse (ERC-6909) token id = uint256(uint160(tokenAddress)). */
const warehouseId = (token: Address) => BigInt(token);
// The Warehouse leaves 1 wei behind to save gas — treat <= 1 as empty.
const clean = (v: bigint) => (v <= BigInt(1) ? BigInt(0) : v);

// Um client por rede, criado uma vez e reusado — criar por chamada abriria
// conexão nova a cada leitura de card.
const clients = new Map<string, ReturnType<typeof createPublicClient>>();
function clientFor(key: string) {
  const def = CHAINS[key];
  if (!def) return null;
  let c = clients.get(key);
  if (!c) {
    c = createPublicClient({ chain: def.chain, transport: fallback(def.rpcs.map((u) => http(u))) });
    clients.set(key, c);
  }
  return c;
}

export type ClaimToken = { address: string; symbol: string; decimals: number; amount: string; amountUi: number };
export type ClaimWithdraw = ClaimToken & { recipient: string };

export type SplitClaim = {
  config: SplitDistributeConfig;
  warehouse: string;
  /** Tokens sitting in the split, ready to `distribute()`. */
  distributable: ClaimToken[];
  /** Recipient Warehouse credits, ready to `withdraw()`. */
  withdrawable: ClaimWithdraw[];
  /** Rede desta leitura e o chainId que a carteira precisa estar para recolher.
   *  Vem daqui e não de um mapa no componente: o botão pedindo a rede errada
   *  assinaria a transação na cadeia errada. */
  chainKey: string;
  chainId: number;
};

/**
 * Read what's collectable for a split: token balances sitting in the split
 * (distributable) + recipient Warehouse credits (withdrawable). Returns null
 * when the address isn't a readable Base split. Never throws.
 */
export async function getSplitClaim(address: string, chain: string | null): Promise<SplitClaim | null> {
  // Sem rede declarada assumimos base — é onde o histórico dos splits vive e o
  // padrão anterior. Rede fora do registro devolve null (falha fechada).
  const chainKey = chain ?? "base";
  const def = CHAINS[chainKey];
  const client = clientFor(chainKey);
  if (!def || !client) return null;

  const config = await getSplitDistributeConfig(address, chainKey).catch(() => null);
  if (!config) return null;

  const TOKENS = def.tokens;
  const split = getAddress(address);
  const read = (a: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]) =>
    client.readContract({ address: a, abi: abi as never, functionName: fn, args: args as never }).catch(() => BigInt(0)) as Promise<bigint>;

  // Split's own token balances → distributable.
  const splitBals = await Promise.all(TOKENS.map((t) => read(t.address, erc20Abi, "balanceOf", [split])));
  const distributable: ClaimToken[] = [];
  TOKENS.forEach((t, i) => {
    const amt = clean(splitBals[i]);
    if (amt > BigInt(0)) distributable.push({ address: t.address, symbol: t.symbol, decimals: t.decimals, amount: amt.toString(), amountUi: Number(formatUnits(amt, t.decimals)) });
  });

  // Recipient Warehouse credits → withdrawable.
  const recips = config.recipients.map((r) => getAddress(r));
  const whReads = recips.flatMap((r) => TOKENS.map((t) => ({ r, t })));
  const whBals = await Promise.all(whReads.map(({ r, t }) => read(WAREHOUSE, warehouseAbi, "balanceOf", [r, warehouseId(t.address)])));
  const withdrawable: ClaimWithdraw[] = [];
  whReads.forEach(({ r, t }, i) => {
    const amt = clean(whBals[i]);
    if (amt > BigInt(0)) withdrawable.push({ recipient: r, address: t.address, symbol: t.symbol, decimals: t.decimals, amount: amt.toString(), amountUi: Number(formatUnits(amt, t.decimals)) });
  });

  return { config, warehouse: WAREHOUSE, distributable, withdrawable, chainKey, chainId: def.chain.id };
}
