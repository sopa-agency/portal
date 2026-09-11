/**
 * A página de um split no explorer da 0xSplits.
 *
 * É `explorer.splits.org`, NÃO `app.splits.org` — e a diferença não é de
 * domínio, é de o link abrir ou não. O `app` só conhece o que foi criado por
 * ele mesmo; para os nossos splits, criados por contrato, ele responde HTTP 200
 * com a página "Account not found". É a pior forma de link quebrado: não dá
 * erro, só afirma que não existe uma coisa que existe. O `explorer` lê o
 * protocolo e abre qualquer split.
 *
 * Vive num arquivo próprio, e não em `splits.ts`, porque aquele é `server-only`
 * e quem monta o link é componente de cliente.
 *
 * Existia em quatro cópias espalhadas pela UI, e foi assim que uma delas ficou
 * apontando para o host errado sem ninguém notar.
 */
const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  ethereum: 1,
  optimism: 10,
  arbitrum: 42161,
};

export function splitsExplorerUrl(address: string, chain?: string | null): string {
  // Sem cadeia declarada cai na Base, que é onde a maioria dos nossos vive.
  const id = (chain && CHAIN_IDS[chain]) || 8453;
  return `https://explorer.splits.org/accounts/${address}/?chainId=${id}`;
}
