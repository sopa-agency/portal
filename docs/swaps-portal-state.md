# Portal do swaps.pro — estado em 28/08/2026

Handoff em disco. O que foi feito, por quê, e o que ainda depende de quem.

As perguntas abertas para o Vlad vivem em `swaps-portal-perguntas.md`, ao lado
deste arquivo. Aqui está o que **já foi decidido e construído**.

---

## O portal já estava de pé antes desta rodada

Três coisas que ninguém precisa refazer:

- **`swaps.sopa.team` serve o portal.** Responde `307 → /login`. DNS e
  roteamento prontos.
- **As 10 pessoas do `allowlist` entram hoje.** `getAccess` consulta o banco
  primeiro, mas com **zero** linhas em `TeamMember` para `swaps` o array da
  config é a autoridade. O allowlist herdou o do KeepKey — decisão do Vlad em
  28/08: **fica como está**, é o time da marca irmã e a config já dizia que era
  proposital.
- **`switcher` e `githubProject`** já configurados: rank 110 sob KeepKey, board
  `coinmastersguild/projects/2` reaproveitado em vez de duplicado.

E o token do portal **lê `coinmastersguild/swapspro`** (privado, com push),
lista commits e enxerga o board. Testado, não suposto.

---

## Os quatro commits da `feat/swaps-shared-agent`

| commit | o que faz |
|---|---|
| `b48b3cd` | separa credencial de **computação** de credencial de **identidade** (desenho abaixo) |
| `8d24369` | logo real da marca; tesouro passa a ser "sem tesouro próprio" |
| `9ed9347` | doc: analytics — não existe service account global, e isso muda o pedido |
| `d2e5e47` | doc: e-mails das service accounts, e as duas regras da rodada |

Antes deles, já na `main`: `7ebf198` (descrição oficial + repo) e `d9fc90c`
(tesouro provisório, depois substituído).

**Nenhum commit da branch foi mesclado.** Ficam esperando o Vlad.

---

## O desenho que impede o swaps postar como KeepKey

O Vlad decidiu que o swaps **reusa o agente do KeepKey** em vez de ter o seu. O
caminho óbvio seria trocar `gatewayEnvPrefix` para `"KEEPKEY"` — uma linha — e é
exatamente o que não se pode fazer.

### O problema

Apesar do nome, `agent.gatewayEnvPrefix` **não resolve só o gateway.** Dois
resolvedores leem o mesmo campo:

- **`projectEnv()`** (`src/projects/secrets.ts`) → `GATEWAY_URL`,
  `GATEWAY_TOKEN`, `PORTAL_DEVICE_*` — **computação**. Dois chamadores.
- **`brandEnv()`** (`src/lib/brand-env.ts`) → `HIVE_POSTING_KEY`,
  `NEYNAR_SIGNER_UUID`, `DISCORD_BOT_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`,
  `TIKTOK_*`, `BINANCE_SQUARE_KEY` — **identidade**. Mais uns dez pontos que
  montam `${prefix}_X` na mão.

Apontar o campo para outra marca não empresta computação: empresta **o direito
de postar como ela**. É o desastre descrito no topo de `brand-env.ts`, que fala
do caso da SkateHive — mas vale em qualquer direção.

### A separação

Entrou `agent.gatewayFrom`, lido **só** pelo `projectEnv`:

```ts
agent: {
  gatewayEnvPrefix: "SWAPS",   // identidade própria
  gatewayFrom: "KEEPKEY",      // computação emprestada
}
```

`projectEnv` usa `gatewayFrom ?? gatewayEnvPrefix`. Verificado:

```
computação (projectEnv) → KEEPKEY_GATEWAY_URL / KEEPKEY_GATEWAY_TOKEN
identidade (brandEnv)   → SWAPS_NEYNAR_SIGNER_UUID / SWAPS_HIVE_POSTING_KEY
```

**A diferença entre os dois campos é a diferença entre "usa o mesmo computador"
e "assina como".** Está escrita no tipo (`src/projects/types.ts`), onde alguém
lê antes de mexer.

Projetos existentes não mudam — nenhum define `gatewayFrom`. O fallback legado
da SkateHive passa a casar contra o prefixo **efetivo**, para que quem tomar
emprestado dela também enxergue as variáveis antigas.

### Por que foi construído antes de haver água no encanamento

**Nenhuma variável `KEEPKEY_*` existe neste ambiente** — nem gateway, nem
identidade. O agente do KeepKey também está offline aqui. Fiz mesmo assim porque
o risco não é o estado de hoje:

> No dia em que alguém setar `KEEPKEY_NEYNAR_SIGNER_UUID` para o KeepKey postar
> — uma mudança que não teria nada a ver com o swaps — o swaps.pro passaria a
> postar como KeepKey, em silêncio.

Sem a separação, o encanamento errado é o mais fácil de instalar com pressa.

---

## O gateway: duas variáveis, e o modo de falha de setar só uma

Para o agente acender, o ambiente de **produção** precisa de:

```
KEEPKEY_GATEWAY_URL
KEEPKEY_GATEWAY_TOKEN
```

**As duas. Nunca só a URL.** A cadeia de resolução do token é:

```
KEEPKEY_GATEWAY_TOKEN  ??  OPENCLAW_GATEWAY_TOKEN  ??  GATEWAY_TOKEN
```

Esse último é o global legado, **que pertence à SkateHive**. Então setar só a
URL faz o swaps.pro falar com o gateway do KeepKey **usando o token da
SkateHive** — e nada avisa. É a mesma família do problema que a separação acima
resolve, mas no canal de computação, onde a guarda de dono do `brand-env` não
alcança: o `projectEnv` tem cadeia própria.

O gateway **não é valor de config, é infraestrutura**: em dev é um serviço em
`127.0.0.1:18789`; em produção é handshake WebSocket assinado por dispositivo
contra uma URL de Tailscale Funnel. Ninguém "seta o gateway" — alguém provisiona
um e emite um token.

**Quem seta é o Vlad, no painel da Vercel.** Token de gateway não anda por chat
nem por terminal. A conferência (o agente respondendo) é feita depois.

---

## De onde veio o logo — e a correção de um erro meu

**O arquivo em uso é `swaps.pro/icon.png`**, o que o próprio site declara no
HTML (`<link rel="icon" href="/icon.png" sizes="256x256">`). Confirmado byte a
byte como o `public/brand/swappro-logo.png` do repo do produto.

### O que aconteceu antes, e por que vale registrar

O commit `8d24369` se chamava **"logo real"** e instalou o `public/icon.svg` do
repo do swapspro — um mark pequeno da marca, **não** o que ela publica como sua
identidade. Duas coisas erradas de uma vez:

1. **O nome do commit afirmava mais do que o conteúdo entregava.** "Logo real"
   descrevendo o arquivo errado da pasta certa é a mesma classe do "verde que
   não prova nada": o rótulo dizendo uma coisa e o conteúdo outra.
2. **A documentação continuou dizendo que o campo estava aberto.** A pergunta 1
   seguia como "só o Vlad responde, o asset não existe em repositório público
   nem se deduz do site" — enquanto o repo já tinha um arquivo instalado. Quem
   lesse o doc não saberia que já havia coisa lá.

E a afirmação original — "não se deduz do site" — **era falsa e eu não a tinha
verificado**. Bastava ler o HTML da página inicial.

**Por que isso é grave num logo especificamente:** identidade visual é o tipo de
coisa que ninguém audita depois. Entra no portal, vira favicon, aparece em
preview de link, e em seis meses é "o logo do swaps".

### Nota de procedência, para a pergunta "algo foi inventado?"

**Nada foi gerado.** O SVG que estava lá era byte a byte idêntico ao
`public/icon.svg` do repo do produto — verificado por `diff` contra o arquivo
baixado do GitHub. O erro foi de **escolha entre arquivos reais**, não de
invenção. Nenhum asset, endereço, credencial ou identificador nestas branches
foi gerado por mim: todos vieram de repositório, de banco, de env, ou do site.

### Ressalva do arquivo atual

É RGB **sem canal alfa**, com fundo escuro (média RGB 1,28,14). No tema claro
aparece como um quadrado escuro em vez de um mark solto — fiel à marca e menos
elegante que os outros portais. Se incomodar, o conserto é um PNG com alfa
vindo da marca, **não um desenho gerado**.

### E o tema não é a cor da marca

O accent do swaps é **ciano** (`#0e7490` / `#22d3ee`). A marca é **verde**
(`#4DF98A → #12A34F`, o gradiente do próprio logo). O ciano foi escolhido por
ser distinto dos outros portais, e trocar por verde colidiria com o lime da
SkateHive — que é o motivo de existir o ciano.

Fica como está até alguém decidir qual das duas coisas importa mais: fidelidade
à marca ou distinção entre portais. **É decisão de design, não achado de
código.**

---

## O tesouro: "sem tesouro próprio"

A fee do swaps.pro **não fica com ele**: aponta para o parceiro KeepKey
(`coinmastersguild.eth`) e para o ENS da SOPA.

Antes disso eu havia posto o split `0xAccF0dB4b6B55Ba692467988D0a1188f26428C2b`
em `treasury.ethWallets`, rotulado como "em trânsito". Com a informação do Vlad,
ele saiu: **era exatamente o dinheiro que não é da marca** — a distribuição para
os outros dois.

O bloco fica com `ethWallets: []` de propósito. Sem o bloco, a página inteira
vira guia de configuração e a receita some junto; com ele vazio, a página abre e
o assunto passa a ser as fontes de receita, que vêm do card do org-chart e casam
por nome.

**E o "$0" que isso criaria foi consertado.** `sumReadings([])` devolve `ok(0)`,
que é aritmeticamente correto e semanticamente errado aqui: somar conjunto vazio
não é somar e dar zero. Numa marca que **tem** receita e não guarda tesouro,
"$0" é o número que engana à primeira vista. Agora, sem nenhuma fonte
configurada, o total é `insufficient` e o hero diz **"sem tesouro próprio"** —
em cinza e não em amarelo, porque não-haver-fonte é resposta correta e não
falha. Pintar de aviso mandaria alguém investigar um problema inexistente.

**Até o Vlad dizer o contrário, é assim.** Se existir carteira própria da marca,
são três linhas.

---

## Analytics: duas service accounts, e não há global

O GA4 está no ar no swaps.pro (`G-93QVXQ3NLY`), mas o portal quer o **ID
numérico da propriedade**, não o measurement ID.

A hipótese de que bastava dar leitura à conta existente era **metade certa**. O
código resolve `${gatewayEnvPrefix}_GOOGLE_SERVICE_ACCOUNT_JSON ??
GOOGLE_SERVICE_ACCOUNT_JSON` — e **a global não existe neste ambiente**. O que
existe são duas com prefixo, contas diferentes em projetos Google diferentes:

```
skatehive-268@skatehive-94e95.iam.gserviceaccount.com
```

```
bobgnarley@gnars-489819.iam.gserviceaccount.com
```

O padrão da casa é **uma service account por marca**. Encaminhado ao Vlad:
setar `SWAPS_GOOGLE_SERVICE_ACCOUNT_JSON` com o JSON de uma das existentes e dar
**Visualizador** a ela na propriedade do swaps — mantém o padrão. Setar a global
mudaria o comportamento de toda marca futura sem a própria, e isso é decisão de
arquitetura que não deve sair de carona numa tarefa de ligar analytics.

`gscSiteUrl` é **opcional de verdade**: campo `?:` no tipo e um estado
`NotConfigured` dedicado no componente. Sem ele, o painel diz "Search Console
not configured" e o resto funciona só com GA4.

---

## O achado do Gnars, e a regra que saiu dele

Em 27/08 um agente ficou bloqueado no gnars.com por **"falta credencial da GA4
Data API"**.

Em 28/08, ao olhar de fato: a conta `bobgnarley@gnars-489819` **já existia**, já
estava configurada no portal, e a propriedade **`527420949`** já estava lá com
GSC. **A leitura de GA4 do Gnars já funcionava.** O bloqueio era de outro
tamanho — ou é no repo `gnars-website`, que é outro sistema e não herda esta
credencial, ou ninguém sabia que a conta existia.

### Regra: antes de pedir credencial nova, verifique se a antiga já tem acesso

Custo de checar: minutos. Custo medido de não checar: **um item parado um dia
inteiro** na lista do Vlad.

A verificação é mecânica:

1. `grep` no ambiente por `*_GOOGLE_SERVICE_ACCOUNT_JSON` (ou o equivalente do
   provedor) — existe alguma?
2. Extraia o `client_email` de cada e veja se são a mesma conta ou distintas.
3. Veja quais projetos já têm a propriedade configurada.

Foi essa mesma checagem que revelou, de quebra, que **não existe global** e que
o padrão é uma conta por marca — os dois achados que mudaram o pedido.

### Regra: a credencial circula; a permissão não

Por que a service account de **leitura** pode ser compartilhada entre marcas e a
de identidade não pode:

O resolvedor de GA4 não usa `brandEnvByPrefix`, então não tem a trava de dono. E
está certo — ler relatório não é postar como ninguém. Mas o motivo real de ser
seguro é melhor que "não é identidade": **a service account só lê a propriedade
em que foi concedida**, no admin do GA4. O mesmo JSON serve várias marcas sem
que nenhuma enxergue a propriedade da outra, porque **quem separa é a concessão
por propriedade, não o prefixo da variável.**

Trava de prefixo protegeria menos e atrapalharia mais. Escrito também junto do
resolvedor em `src/lib/google-analytics.ts`, que é onde a próxima pessoa olha.

---

## O que está ligado, e o que não está

`postCreator` ligado em 28/08, como mecanismo do pedido do Vlad — *"ligar o
github que importa no repo to social"*.

**Correção de uma afirmação minha:** eu havia dito que "o `/repo-to-social` já
funcionava, rota sem flag". Estava errado, e o erro foi ter verificado a
existência da rota em vez do que ela faz. `/repo-to-social` é apenas um
**redirecionamento** para `/marketing-suggestions?tab=repo` — a funcionalidade
mora na aba de Post Suggestions, que é gateada pelo `postCreator`.

### E havia um bug por baixo

Relatado como "não parece configurado", e era. `getRepoToSocialConfig` faz
`upsert`: o **create** preenche `repoUrl` a partir de `project.repos`, mas o
**update** só toca o `agentId`.

A linha do `swaps` no `RepoToSocialConfig` nasceu **antes** de o projeto
declarar repos — naquele momento `project.repos` era `[]` — então nasceu vazia.
Depois que o repo foi declarado, o default nunca mais foi aplicado: a linha já
existe, o upsert não recria, e não havia cura para esse campo.

O código já curava o campo vizinho (`prompt` vazio) com um comentário
explicando por quê. A cura foi estendida ao `repoUrl`, com a mesma regra: **só
cura o vazio** — lista que alguém editou, inclusive para remover um repo, é
escolha e não se mexe.

Verificado no banco: `gnars` e `skatehive` têm repos preenchidos; `reelflip`,
`keepkey` e `nogenta` estão vazios **corretamente**, porque esses projetos não
declaram `repos`. Só o `swaps` estava vazio por engano.

**O `lab` NÃO foi ligado** — não foi pedido, nem implicitamente. E não é
pré-requisito: são flags independentes; o `lab/page.tsx` lê `postCreator`, não
o contrário.

Todas as demais flags seguem desligadas.
