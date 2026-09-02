// A fatia da SOPA em cada split das marcas, e a regra de somá-la.
//
// Por que agrupar por CONTRATO e não por stream: um projeto pode registrar dois
// produtos que cobram taxa no mesmo split (swaps.pro tem "Swaps fees" e "Batch
// Send Fees" caindo em 0xeB29…3A36). A leitura on-chain é por contrato, então
// os dois streams voltam com o MESMO gross — e somá-los por stream contava a
// mesma pota duas vezes: o subtotal dizia $58.74 quando a cadeia tinha $34.52.
// Somar uma vez por (cadeia, endereço) é o que impede o subtotal de mentir.

export type OnchainShare = {
  key: string;
  projectName: string;
  label: string;
  address: string;
  chain: string | null;
  /** Gross que passou pelo split. */
  realizedUsd: number;
  /**
   * Por que a leitura falhou, ou com que ressalva ela veio.
   *
   * Sem isto, `realizedUsd: 0` era escrito na tela como "no distribution yet" —
   * e era o que a página vinha dizendo dos quatro splits, enquanto a cadeia
   * tinha 16, 5 e 3 distribuições neles. O Blockscout da Base estava em 500 e o
   * silêncio dele virava uma afirmação nossa.
   */
  realizedError?: string;
  /** A fatia da SOPA, lida da config do próprio split. Null = não lida. */
  sopaShare: number | null;
  /** Todos os destinatários, para a página mostrar aonde vai a outra metade. */
  recipients: { address: string; share: number; label: string }[];
};

/** Uma pota de dinheiro: o contrato, e todos os produtos que a alimentam. */
export type OnchainShareGroup = Omit<OnchainShare, "label"> & {
  /** Os rótulos dos streams que caem neste contrato, na ordem de registro. */
  labels: string[];
  /**
   * Fora do subtotal: alguma leitura do grupo falhou e voltou zero. Um zero que
   * significa "não sei" não pode entrar na soma nem como zero.
   */
  naoLido: boolean;
};

export type ContractRef = { address: string; chain: string | null };

/** Identidade de um contrato: cadeia + endereço, ambos em minúsculas. */
export function contractKey({ address, chain }: ContractRef): string {
  return `${(chain ?? "").toLowerCase()}:${address.trim().toLowerCase()}`;
}

/** Agrupa preservando a ordem da primeira aparição de cada contrato. */
export function groupByContract<T extends ContractRef>(items: T[]): T[][] {
  const grupos = new Map<string, T[]>();
  for (const item of items) {
    const k = contractKey(item);
    const g = grupos.get(k);
    if (g) g.push(item);
    else grupos.set(k, [item]);
  }
  return [...grupos.values()];
}

const naoLido = (o: OnchainShare) => o.realizedUsd === 0 && !!o.realizedError;

export function agruparOnchainShare(shares: OnchainShare[]): OnchainShareGroup[] {
  return groupByContract(shares).map((membros) => {
    const [primeiro] = membros;
    // Os membros vêm da mesma leitura on-chain, então gross, fatia e
    // destinatários são iguais entre eles; o que difere é só o rótulo. Mesmo
    // assim, a ressalva e a fatia são buscadas em QUALQUER membro: um aviso não
    // some porque estava no segundo stream e não no primeiro.
    return {
      key: primeiro.key,
      projectName: [...new Set(membros.map((m) => m.projectName))].join(" + "),
      labels: membros.map((m) => m.label),
      address: primeiro.address,
      chain: primeiro.chain,
      realizedUsd: primeiro.realizedUsd,
      realizedError: membros.find((m) => m.realizedError)?.realizedError,
      sopaShare: membros.find((m) => m.sopaShare != null)?.sopaShare ?? null,
      recipients: primeiro.recipients,
      naoLido: membros.some(naoLido),
    };
  });
}

/**
 * O subtotal on-chain: a fatia da SOPA, UMA vez por contrato.
 *
 * Split não lido NÃO entra — nem como zero. Somar um zero que na verdade é
 * "não sei" é como o subtotal virava $0 com distribuição acontecendo nos
 * quatro contratos.
 */
export function subtotalOnchain(grupos: OnchainShareGroup[]): number {
  return grupos.filter((g) => !g.naoLido).reduce((s, g) => s + g.realizedUsd * (g.sopaShare ?? 0), 0);
}
