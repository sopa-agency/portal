# Indexador de fluxo do tesouro — especificação

**Status: especificado, não construído.** Falta o ok do Vlad, e uma parte é ele
quem instala. Escrito em 31/08/2026.

## O que ele resolve

O painel de **variação** que já está no card de Tesouro responde "o total mudou
quanto entre uma leitura e a outra". Ele **não** responde "quanto entrou", e o
próprio card diz isso: variação de saldo mistura movimento de preço com
transferência, e não separa o que entrou do que saiu. Um dia em que entraram
US$ 500 e saíram US$ 480 aparece como +20, igualzinho a um dia parado em que o
ETH subiu 2%.

Para responder "quanto entrou" é preciso ler **transferência**, não saldo. É
isso que este indexador faz.

## A fonte: medida, não escolhida por gosto

A regra da casa é não gastar dinheiro sem o Vlad. Então a primeira coisa medida
foi se cabe no grátis.

### Volume — cabe com folga

| | |
|---|---|
| carteiras EVM que o cron já fotografa | **6** |
| chains com dinheiro de verdade | **1** (Base; ethereum/optimism/arbitrum somam ~US$ 0,49) |
| chamadas por rodada | 6 carteiras × 2 direções = **12** |
| rodadas por dia (de hora em hora) | 24 |
| **total** | **288 chamadas/dia** — 1.152 se varrer as 4 chains |

Contra o teto de **100.000/dia** do tier grátis do Etherscan: **0,3%** (1,2% com
as quatro chains). Volume nunca foi o problema.

### O problema é a chain, e ele é bloqueante

O tier grátis do Etherscan **não cobre a Base**. Não é dedução — é o que a
própria API responde, e eu bati nisso duas vezes hoje:

```
GET api.etherscan.io/v2/api?chainid=8453&module=account&action=tokentx&…
{"status":"0","message":"NOTOK",
 "result":"Free API access is not supported for this chain.
           Please upgrade your api plan for full chain coverage."}
```

Documentação confirma: grátis = 3 chamadas/s, 100.000/dia, **"selected chains"**.
A Base não é uma delas. O primeiro tier pago (Lite) resolveria — **e não é
preciso, porque existe caminho grátis que funciona.**

### O caminho que funciona, testado hoje

`eth_getLogs` filtrando o tópico `Transfer(address,address,uint256)` com o
endereço do tesouro em `topic1` (saída) e `topic2` (entrada):

| fonte | resultado do teste |
|---|---|
| **`https://mainnet.base.org`** | **OK** — devolveu 2 transferências recebidas numa janela de 1.800 blocos (~1h) |
| `https://base-rpc.publicnode.com` | recusa: *"Archive requests require a personal token"* |
| `https://base.llamarpc.com` | devolveu HTML, não JSON |
| Blockscout `/token-transfers` | **500** no primeiro endereço testado (o endpoint de *lista de tokens* funciona) |

Sem chave, sem custo. **Importante:** RPC público costuma bloquear `eth_getLogs`
vindo de IP de datacenter — e este indexador roda no cron da máquina do Vlad, que
é IP residencial, então o caminho é compatível com onde ele vai morar. Rodar isso
da Vercel provavelmente **não** funcionaria.

## O que grava

```prisma
/// Uma janela de blocos processada por carteira. A linha existe mesmo quando a
/// leitura FALHOU — é isso que separa "não houve transferência" de "não sei".
model TreasuryFlowWindow {
  id          String   @id @default(cuid())
  address     String   // carteira do tesouro, minúscula
  chain       String   // "base", "ethereum", …
  fromBlock   Int
  toBlock     Int
  /// "ok" | "empty" | "unread" — os três estados, ver abaixo
  state       String
  /// Por que falhou, quando falhou. Null nos outros dois estados.
  reason      String?
  inUsd       Float?   // soma do que ENTROU, valorado no instante da transferência
  outUsd      Float?   // soma do que SAIU
  transfers   Int?     // quantas transferências compõem os totais
  processedAt DateTime @default(now())

  @@unique([address, chain, fromBlock, toBlock])
  @@index([address, chain, toBlock])
}

/// Cada transferência, para o total ser auditável em vez de acreditável.
model TreasuryTransfer {
  id        String   @id @default(cuid())
  address   String   // o tesouro
  chain     String
  direction String   // "in" | "out"
  token     String   // contrato, ou "native"
  symbol    String?
  amount    String   // decimal em texto: Float perde precisão em 18 casas
  usd       Float?   // null = não consegui precificar (NÃO é zero)
  txHash    String
  logIndex  Int
  blockNum  Int
  at        DateTime

  @@unique([chain, txHash, logIndex])
  @@index([address, chain, at])
}
```

### Os três estados, que são o coração disto

| estado | quando | o que o card mostra |
|---|---|---|
| `ok` | a janela foi lida e houve transferência | as barras de entrada e saída |
| `empty` | a janela foi lida e **não houve** transferência | barra zerada — e zero aqui é verdade |
| `unread` | a janela **não pôde ser lida** (RPC caiu, limite, timeout) | **buraco declarado**, nunca zero |

**Uma janela não lida não pode virar "não entrou nada".** Este card é um
relatório financeiro: um buraco silencioso vira "não houve receita naquele dia",
alguém soma o mês e o número sai errado para fora — para um grant, para um
parceiro. É o pior lugar onde esse bug pode cair, e é por isso que a linha
existe mesmo quando a leitura falha.

Mesma regra dentro da linha: `usd` nulo quando não deu para precificar o token.
Um token sem preço confiável **não entra no total como zero** — ele aparece
contado à parte, como "N transferências sem preço". Isso não é teórico: o
multisig da SkateHive tem 27 tokens, e fora US$ 63 de USDC o resto é airdrop sem
liquidez. Um indexador ingênuo somaria poeira como receita.

## O job

- **Cursor por (address, chain)**: o último `toBlock` processado. Sem cursor, o
  primeiro run começa do bloco de hoje — **não** varre o histórico. Histórico
  retroativo é uma decisão separada (custa muitas janelas) e fica de fora desta
  spec.
- **Janela fixa** de ~1.800 blocos (≈1h na Base). Janela grande demais faz o RPC
  recusar; pequena demais multiplica chamadas.
- **Avança só quando teve sucesso.** Numa falha, o cursor NÃO anda e a janela
  fica gravada como `unread`; a rodada seguinte tenta de novo. Sem isso, uma
  falha viraria um buraco permanente que ninguém veria.
- **Valoração no instante da transferência**, não no de hoje. É isso que torna o
  número imune a preço: "entraram US$ 500" continua sendo US$ 500 no mês que vem.
- **Frequência**: de hora em hora, junto do snapshot de saldo que já roda.

## O que é do Vlad

1. **Instalar o cron** na máquina dele (pm2, como os outros workers). Configuração
   persistente na máquina é dele, nunca minha.
2. **Dar o ok na fonte**: `mainnet.base.org` grátis (testado) ou pagar o tier Lite
   do Etherscan. A recomendação é o grátis — não vejo o que o pago compraria aqui.
3. **Decidir sobre histórico retroativo**: esta spec começa do zero e passa a
   valer daqui pra frente. Varrer o passado é outro trabalho.

## O que fica de fora, de propósito

- **Contas Hive** (3 delas). Fluxo em Hive é outra API e outro formato.
- **Posição de protocolo**: entrar e sair do vault da Moonwell é transferência de
  share, não receita. O indexador vai enxergar e precisa marcar como
  movimentação interna, senão vira "entrou US$ 780" no dia em que o dinheiro só
  mudou de bolso. **Esta é a parte mais fácil de errar** e merece atenção na
  implementação.
