# Página de Tesouro — estado, decisões e o que ficou aberto

> Escrito em **2026-08-27**, fim do turno da noite. Complementa `treasury-replan.md`
> (que é plano de refactor); este aqui é **estado**: o que a página é hoje, por que
> ficou assim, e o que a próxima pessoa precisa saber antes de mexer.
>
> Existe porque chat some e resumo perde detalhe. Três agentes voltaram sem contexto
> hoje e recomeçaram em silêncio — um deles foi este terminal, que ficou 44 minutos
> parado num seletor de resume sem ninguém saber.

---

## O problema que esta leva resolveu

Não era quantidade de componente. Era **mistura de público numa tela só**.

A aba `tesouro` atendia três pessoas ao mesmo tempo:

1. quem quer saber **quanto temos** — a pergunta que a página existe pra responder;
2. o **crew**, que opera e precisa de orçamento, atividade de multisig, earmarks;
3. o **owner**, que assina transação: pipeline MOR, stake, deploy de contrato.

Cockpit de owner não *compete* com "quanto temos" — ele **convive**, o que é pior,
porque disputa a mesma atenção sem servir a mesma pessoa.

O critério usado pra cortar, e que vale manter: **a pergunta da página é "quanto a
gente tem, em quê, e isso está subindo ou descendo". Componente que não ajuda a
responder isso está competindo com quem ajuda. Hierarquia não é diminuir fonte — é
decidir o que sai da tela.**

---

## O que mudou

### Custos subiu pro lado do saldo (`1a4a214`)

"O que sai" estava a **duas abas de distância** de "quanto temos". Com isso,
"subindo ou descendo" era impossível de responder olhando uma tela só — você tinha
que trocar de aba e guardar o número de cabeça.

Descoberta do caminho: **o portal de marca já fazia certo.** `BrandTreasury`
renderiza os custos inline numa `Section` junto do saldo. Era a **SOPA** que estava
fora do padrão, com custos numa aba de topo própria. Agora os dois ramos leem igual.

> ⚠️ **A página tem DOIS ramos** e isso já causou bug real hoje: `isSopa` escolhe
> entre `SopaTreasury` (que recebe receita como **dado**) e `BrandTreasury` (que
> recebe como **nó React**). O gráfico foi plugado só no segundo e ficou invisível
> justamente na página da SOPA (`aada4a8` conserta). **Ao mexer na página, confira
> os dois ramos.**

### Cockpit de owner recolhido sob "Operar" (`c117a6a`)

`MorPipelinePanel`, `NativeSwapDeployPanel`, `SopaStakePanel` e `MorFlowDiagram`
vivem hoje num único `<details>` recolhido, rotulado **"Operar" / "Operate"**
(`treasury.ops.mor` no dicionário).

O diagrama vem **por último** dentro da seção: quem abre "Operar" quer a ferramenta;
a explicação fica embaixo pra quem precisa dela. Conteúdo didático mora junto da
coisa que ele explica, não na tela de consulta — antes ele estava na aba `plano`.

**NADA FOI DELETADO.** Cinco componentes mudaram de lugar. Reverter qualquer um é
mover de volta.

### Onde a página está agora

| aba | responde | público |
|---|---|---|
| `tesouro` | quanto temos · em quê · subindo ou descendo · o que sai | todos |
| `tesouro` → "Operar" (recolhido) | pipeline MOR, stake, deploy, como funciona | owner |
| `membros` | o stream de payroll aguenta quanto tempo | crew |
| `apoiar` | staking da comunidade | público externo |
| `plano` | estudo de sustentabilidade | crew |

---

## Três perguntas abertas pro Vlad

Nenhuma foi decidida — e nenhuma bloqueia nada.

1. **`NativeSwapDeployPanel` já cumpriu a função?**
   Medido, e o resultado não foi nenhuma das opções: **não dá pra saber pelo
   servidor.** O painel guarda o endereço do filler em `localStorage`, por
   navegador — nunca persistiu em config nem env. A ausência de registro
   compartilhado é, ela mesma, o argumento de que é ferramenta pontual. Está
   recolhido; se já cumpriu, pode sair um dia.

2. **`MorFlowDiagram` ainda ensina alguém?**
   Diagrama didático envelhece rápido. Recolhido resolve os dois casos: se ensina,
   ensina no lugar certo; se não, não incomoda.

3. **`FinancialPlan` é estudo vivo ou virou registro?**
   Se virou registro, não é tesouro. Está em aba própria e não disputa atenção com
   nada, então ficou como está.

---

## A refatoração adiada — e por que ela importa

**`fetchAddressBalance` deveria RECEBER a fonte de saldo, não importar Zerion e RPC.**

Hoje ela importa os dois direto (`src/lib/treasury.ts`). Isso é a diferença entre a
página **sobreviver ou não a trocar de provedor**: enquanto a função souber que a
Zerion existe, trocar de provedor significa reescrever a função, e testá-la
significa ter uma chave de API.

O time do swaps.pro chegou nessa conclusão do jeito caro. O `PortfolioView.tsx`
deles sabe que o Pioneer existe, e é **exatamente por isso que é impossível de
extrair**. A recomendação que veio de lá, textual: *"se a tua página de tesouro
nascer com a fonte injetada em vez de importada, ela sobrevive a trocar de
provedor"*.

Foi adiada de propósito no fim do turno — é refactor grande e não conserta bug
nenhum hoje. Mas é a próxima coisa certa a fazer nesta página.

### Ver junto com o padrão dos três estados

`patterns/three-state-reads.md` + `patterns/reading.ts` (126 linhas, zero
dependência) no repo **sopa-estado**, commit `87c629d` — escrito pelo Comporta
depois que o **mesmo bug mordeu três frentes no mesmo dia**: a Zerion daqui
falhando e virando "não tem nada em stake", o gnars.com afirmando "Not linked"
sobre 1050 pessoas, e o `parseUnits` do SwapPro truncando dinheiro num airdrop
cujo total continuava batendo. O caso desta página é o **primeiro exemplo citado
no doc**.

> Caminho dado: `/Users/web3warrior/Code/sopa-estado/patterns/`. **Não é
> acessível desta máquina** (home de outro usuário) — buscar pelo repo
> `sopa-estado`, não por esse path.

Duas peças que interessam aqui:

- **`fromCall()`** torna o erro *impossível de escrever*, não só documentado.
  `multicall` com `allowFailure` devolve sucesso e falha no mesmo formato, e a
  linha natural seguinte é `result ?? 0n`. Depois do `fromCall`, o ramo de falha
  não tem acesso a valor nenhum — só a um motivo.
- **`sumReadings()`** se recusa a somar quando qualquer parcela está ruim:
  leitura falha não vale zero na aritmética, vale "total incompleto". Numa
  página de tesouro é a diferença entre um número errado e um número honesto.

**Olhar as duas coisas juntas, não separado.** Se a fonte for injetada **e**
devolver `Reading<T>`, resolve-se de uma vez sobreviver a trocar de provedor
**e** não conseguir mais colapsar falha em zero. Hoje a correção daqui é uma
convenção que depende de alguém lembrar; com `Reading<T>` vira tipo, e o
compilador passa a cobrar.

---

## O achado da quota (não pode viver só no chat)

**Cache num `Map` de módulo não protege cota nenhuma.**

Na Vercel **cada instância tem o próprio `Map`**. Com isso a cota vira função de
**tráfego × instâncias** em vez de função de **perguntas distintas**. Cinco
instâncias respondendo sobre a mesma carteira = cinco chamadas upstream pra mesma
resposta. É o tipo de bug que **só aparece na fatura, nunca em teste**.

A correção (`d006078`) é `next: { revalidate }` no próprio `fetch`: usa o **data
cache do deployment**, compartilhado entre instâncias e usuários, chaveado pela URL
inteira — que já carrega endereço e filtro. Duas pessoas perguntando da mesma
carteira dividem uma chamada; carteiras diferentes nunca colidem.

TTLs atuais em `src/lib/zerion.ts`: **60s** saldo simples, **300s** posição de
protocolo, e por período no gráfico (300s para 24h → 43200s para "tudo").

### Por que os TTLs de protocolo e gráfico são maiores

Documentado no código do swaps.pro e respeitado aqui: **`charts`, `pnl` e
`positions?filter[positions]=only_complex` puxam de um quarto da cota do plano e
NÃO são cobertos por overage.** Qualquer coisa construída em cima disso é racionada
mais do que saldo simples.

### A regra irmã: leitura que falha não vira zero

Esta estava **viva no código** e foi corrigida no mesmo commit. Quando a Zerion
falhava, a leitura caía no fan-out de RPC — que é **cego pra posição de protocolo**.
A tela mostraria um total menor dizendo *"não tem nada em stake"* quando a verdade é
*"não conseguimos perguntar"*.

Numa página de tesouro esse é o pior erro possível, porque **parece um número em vez
de parecer uma falha**. Hoje a falha viaja junto do número (`AddressBalance.error`)
e diz explicitamente que o total exclui stake/LP.

O mesmo princípio já vale em outros pontos e deve continuar valendo:
`failedChains` nunca vira 0; sem preço confiável, mostra-se a quantidade com "USD
indisponível"; e o snapshot horário **pula** a carteira cuja leitura falhou em vez
de gravar um ponto de zero — um zero gravado por engano desenha um despenhadeiro
que nunca aconteceu.

---

## Outros dois bugs que esta leva matou

- **MOR era invisível no tesouro** (`3af9642`, `6e92845`). O multisig da SkateHive
  "caiu" sem ninguém gastar nada: os fundos foram fazer stake no Morpheus. O leitor
  não via porque a chamada pedia `filter[positions]=only_simple`, que é justamente o
  filtro que **exclui posição de protocolo**. O dado sempre esteve na API — o pedido
  é que estava errado. Corrigido de forma geral: staking, LP e lending contam em
  qualquer cadeia, sem um leitor por protocolo.

- **O gráfico não aparecia na página da SOPA** (`aada4a8`) — ver o aviso dos dois
  ramos acima.

---

## Os dois verificadores são obrigatórios, por razões opostas

Escrito depois de o `next build` quebrar num commit em que `tsc` e `eslint`
passaram os dois, limpos.

**Aqui, o `tsc` não enxerga a fronteira cliente/servidor.** `treasury.ts` é
`server-only`. O `treasury-aggregate.ts` sempre importou dele — mas só TIPOS, e
tipo é apagado na compilação. A fronteira existia sem nunca ter sido
exercitada. No dia em que um VALOR cruzou (duas funções puras que traduzem
carteira em `Reading<number>`), o `SopaTreasury`, que é Client Component e
importa esse agregador, passou a arrastar chave de RPC e caminho de fetch para
o bundle do navegador. Isso é quase-incidente de segurança, não erro de build.
Quem separa cliente de servidor é o **bundler**. Só o `next build` acusa.

**Na SkateHive é o inverso.** Lá o `next build` roda com *Skipping validation of
types*, então o build não é verificador de tipo nenhum — o `tsc` é o único que
pega erro de tipo.

Ou seja: **cada repo tem um buraco diferente, e os dois verificadores cobrem
buracos que o outro não cobre.** Passar num não é evidência de nada sobre o
outro. Rodar os dois antes de mesclar não é zelo, é o mínimo — e no caso deste
repo é por isso que o preview da Vercel roda antes do merge, não depois.

**A regra prática:** quando um módulo `server-only` passar a exportar um VALOR
consumido fora dele, verifique quem consome. Import de tipo é grátis e não
prova nada; o primeiro import de valor é que testa a linha.

## Medição da completude das leituras (27/08, 23h)

A pergunta era com que frequência o total do tesouro apareceria como
"incompleto" depois de ele parar de somar leitura falha como zero. Medido no
próprio `TreasuryWalletSnapshot`, que já é o registro: o cron grava uma linha
por carteira por hora e **pula** a que falhou, então linha ausente é falha
registrada. Custo zero de cota.

**Resultado: 0 de 8 ticks incompletos. 40 de 40 leituras.** Cinco carteiras
configuradas (gnars 1, skatehive 3, sopa 1), todas presentes em todas as horas.

Três ressalvas, e a terceira é a que importa:

1. A amostra tem **8 horas**, todas de hoje — a tabela nasceu hoje. Não é
   evidência sobre semanas.
2. Cobre só EVM. As contas Hive também alimentam o total do hero e podem
   falhar ("account not found"); o snapshot não as grava.
3. **O snapshot mede um LEITOR DIFERENTE do que decide o INCOMPLETO.**
   (Correção: eu havia escrito aqui que o snapshot gravava leituras parciais.
   Não gravava — ele PULAVA a carteira com `bal.error`, o que já cobria chain
   caída. O erro real é outro e é mais fundo.)

   O snapshot lê com `fetchAddressBalance` (Zerion primeiro, fan-out de RPC
   como queda). O total do hero lê com `fetchEvmWallet` (fan-out de RPC puro).
   **São dois caminhos com modos de falha distintos.** O "0 de 8" diz *a Zerion
   respondeu 40 de 40 vezes* — ótima notícia sobre a Zerion, e quase nada sobre
   o fan-out que produz o `failedChains` que o hero avalia.

   Isto é a mesma refatoração adiada ("`fetchAddressBalance` receber a fonte")
   vista de outro ângulo: enquanto a página e o snapshot lerem por caminhos
   diferentes, um não mede o outro.

**Consertado no passo 2** (`feat/treasury-read-health`): a falha deixa de ser
ausência de linha e passa a ser uma linha com `totalUsd` nulo, mais
`failedChains`, `reason` e `kind`. Ausência de linha era indistinguível de "o
cron não rodou naquela hora", e o que não está lá não se conta. Nulo não entra
no gráfico e nulo se conta. As contas Hive passaram a ser fotografadas junto,
porque elas alimentam o mesmo total — uma saúde só de EVM pareceria completa
sem ser.

### O conserto de verdade: convergir os dois caminhos de leitura

Não é "ressalva conhecida" — ressalva conhecida é o tipo de nota que ninguém
age. É trabalho nomeado, com dono a definir.

Enquanto o snapshot ler por `fetchAddressBalance` e o hero por
`fetchEvmWallet`, **a métrica mede o caminho vizinho.** Isso é pior que não
medir: daqui a uma semana alguém olha "0 incompletos", conclui que os RPCs
estão saudáveis, e o que estava saudável era outra coisa. Métrica que mede o
vizinho produz confiança falsa.

A unidade de análise certa é o **caminho de leitura**, não a função. O SwapPro
chegou à mesma unidade por outro lado, propondo ranquear caminhos por terem ou
não canal de incerteza: *"no caminho com canal o erro é um bug; no caminho sem
canal, é o design"*. O corolário é este caso: **dois caminhos separados não se
medem, por mais correto que cada um esteja internamente.**

Convergir os dois — a fonte injetável que já está adiada aqui — é o que faria
a medição medir a coisa e não a vizinha. Fica nomeado como o próximo passo
estrutural desta página, acima de qualquer conserto pontual restante.

### Item 3: caminho COM canal — o erro é bug, não design

`EvmToken.valueUsd` já era `number | null`, com o comentário certo ao lado
("unknown is not zero"). O canal existia; as duas somas é que o jogavam fora
com `?? 0`. Pela unidade do SwapPro: **no caminho com canal, o erro é um bug.**
Não havia o que projetar, havia o que consertar.

**A medição, e ela é estrutural — custo zero de cota.** A pergunta era se
"token sem preço ⇒ carteira incompleta" seria sinal ou barulho. Dos extraTokens
configurados, `gnars` na carteira da SOPA é `usd: "none"` — **sem preço por
configuração, toda hora, para sempre.** A regra estrita deixaria o hero da SOPA
permanentemente incompleto: ruído constante, não sinal.

**Mas a escolha não se apoia no barulho — se apoia numa distinção real:**

| buraco | o que se sabe | o que o total é |
|---|---|---|
| chain que não respondeu | não se sabe O QUE tem | desconhecido → recusa o número |
| token sem preço | sabe-se exatamente o que tem, não quanto vale | **piso correto** → mostra e nomeia o que falta |

Conflar os dois seria um erro próprio, na direção oposta. Então a soma passa a
somar os tokens COM preço — escrita como filtro, não como `?? 0`, para que ler
a linha diga o que ela faz — e o resto sobe até o hero como nota: *"Não inclui
gnars (N) — em carteira, sem preço confiável."*

Num tesouro este é o pior lugar possível para essa confusão: **token sem preço
conhecido é comum, token que vale zero é raro.** O caso frequente estava sendo
renderizado como o caso raro.

### Aplicando a mesma unidade ao passo 2, item 2

A pergunta antes de consertar os três `.catch(() => [])` do `treasury-history`
foi: **este caminho tem canal?** A verificação:

| função | retorno antes | canal? |
|---|---|---|
| `getTreasuryHistory` | `TreasurySeries[]` | não |
| `getTreasuryWalletHistory` | `TreasurySeries[]` | não |
| `getTreasuryWalletChart` | `{series, failed}` | **sim** |

Dois dos três não tinham onde colocar a informação, então tratar os `catch`
não teria destino — e o quarto nasceria depois, que é exatamente o que o
SwapPro descreveu. O conserto foi **dar canal ao caminho**: as duas funções
passam a devolver `Reading<TreasurySeries[]>`, e o `attempt()` do módulo
finalmente se aplica (na primeira leva eu tinha recusado usá-lo, porque lá a
camada de fetch já produzia dois estados corretos por chain — aqui não produzia
nada).

Havia uma SEGUNDA camada de colapso: a página refazia `.catch(() => [])` no
call site. Dar canal à lib sem tirar isso não teria mudado a tela.

Um `catch` ficou de pé de propósito, e a distinção vale: o que busca os TÍTULOS
dos cards. Ele degrada um rótulo — a série aparece com o id do card, feia e
visivelmente incompleta — não um número. A regra dos três estados protege
VALOR; rótulo caindo para id é degradação à vista, não valor errado se passando
por certo.

## Cuidados pra quem mexer aqui depois

- **Confira os dois ramos** (`SopaTreasury` × `BrandTreasury`). Já mordeu hoje.
- **Deploy verde não prova que a tela mudou.** Prova que o build subiu. Duas vezes
  hoje eu reportei "está em prod" quando o componente não estava na rota que o
  usuário abria. Se não der pra abrir a página (ela exige login), diga isso em vez
  de deixar o sucesso do deploy sugerir mais do que ele prova.
- **`portal.sopa.team` não é a SOPA.** O rótulo "portal" não é slug de projeto
  nenhum, então cai no projeto padrão. A página da SOPA é `sopa.sopa.team/treasury`.
- **Verifique deploy por SHA COMPLETO** na API do GitHub. Sha curto devolve vazio e
  parece que nunca deployou.
