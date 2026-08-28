# Portal do swaps.pro — o que só o Vlad responde

Oito perguntas. Cada uma tem uma linha dizendo **por que ela não pode ser
respondida por código, por documentação pública ou por leitura on-chain** — é
essa linha que justifica interromper alguém em vez de ir descobrir.

Levantadas em 28/08/2026, ao montar o slot `swaps` no portal.

---

## Contexto: o portal já está de pé

Três coisas que já funcionam, para ninguém refazer:

- **`swaps.sopa.team` já serve o portal.** Responde `307 → /login`, igual aos
  demais. DNS e roteamento: prontos.
- **As 10 pessoas do `allowlist` já entram hoje.** O `getAccess` consulta o
  banco primeiro, mas com **zero** linhas em `TeamMember` para `swaps` o array
  da config é a autoridade.
- **`switcher` e `githubProject` já configurados** — rank 110 sob KeepKey, e o
  board `coinmastersguild/projects/2`, reaproveitado em vez de duplicado.

Já preenchido sem depender de ninguém (bloco A): descrição oficial, repo do
produto, e o tesouro provisório — ver a pergunta 8.

---

## 1. Logo real do swaps.pro

O arquivo em `public/projects/swaps/logo.svg` é placeholder, e o comentário do
próprio `swaps.ts` diz isso: *"Placeholder mark — swap for the real swaps.pro
asset when it lands."*

**Por que só ele responde:** é o asset da marca. Não existe em repositório
público nem se deduz do site.

## 2. Existem redes sociais do swaps.pro? — RESPONDIDA EM PARTE (28/08)

Procurei em `swaps.pro/llms.txt`, em `llms-full.txt` e na página `/about`:
nenhum handle publicado. A ausência era ambígua — canal que não existe e canal
que existe sem estar publicado produzem a mesma tela vazia.

**Resposta do Vlad:**

- **Twitter/X: EXISTE.** Falta o handle — é o que ainda impede preencher
  `socials`.
- **Farcaster: sendo criado agora.** Deixou de ser "não sei se existe" e virou
  "vai existir em breve".
- **Discord e Telegram: não mencionados.** Registrado como não-mencionado, não
  como inexistente — a distinção é a mesma de antes.

**Ainda falta dele:** o handle do Twitter, e o canal do Farcaster quando estiver
de pé.

## 3. Analytics — RESPONDIDA EM PARTE (28/08), e falta MAIS do que parecia

O provedor está resolvido: **GA4 está no ar no swaps.pro**, measurement ID
`G-93QVXQ3NLY`. Mas o portal não usa o `G-` — o bloco `analytics` pede o
`ga4PropertyId`, que é o **ID numérico da propriedade** (como `527345741` da
SkateHive e `527420949` da Gnars).

**Faltam DUAS coisas, e a segunda foi surpresa.**

### 3a. O ID numérico da propriedade GA4

Está no admin do GA4, em Detalhes da propriedade. Uma linha no `swaps.ts`.

### 3b. Uma service account para o prefixo SWAPS — não existe global

A hipótese era que a service account que já serve os outros portais só
precisaria ganhar leitura na nova propriedade. **Metade certa.**

O código resolve assim:

```
${gatewayEnvPrefix}_GOOGLE_SERVICE_ACCOUNT_JSON  ??  GOOGLE_SERVICE_ACCOUNT_JSON
```

Só que **a global não existe neste ambiente.** O que existe são duas com
prefixo, e são contas DIFERENTES, em projetos Google diferentes:

Os dois `client_email`, completos (são identificadores, não segredos — podem
circular e é isso que se cola no Gerenciamento de acesso do GA4):

```
skatehive-268@skatehive-94e95.iam.gserviceaccount.com
```

```
bobgnarley@gnars-489819.iam.gserviceaccount.com
```

Projetos Google: `skatehive-94e95` e `gnars-489819`, respectivamente.

Ou seja, o padrão desta base é **uma service account por marca**, não uma
compartilhada. Para o swaps existem dois caminhos, e nenhum exige criar conta:

1. Setar `SWAPS_GOOGLE_SERVICE_ACCOUNT_JSON` com o JSON de uma das que já
   existem, e dar **Visualizador** a ela na propriedade do swaps.pro.
2. Setar a global `GOOGLE_SERVICE_ACCOUNT_JSON`, que passa a servir de fallback
   para qualquer marca sem a sua.

A opção 1 mantém o padrão da casa; a 2 muda o padrão para toda marca futura.

**Encaminhado: opção 1.** Setar a global mudaria o comportamento de toda marca
futura sem a própria — decisão de arquitetura que não deve sair de carona numa
tarefa de ligar analytics.

**Quem seta é o Vlad, no painel.** Mover JSON de service account por chat ou por
terminal não acontece; eu confiro depois que estiver setado.

**Por que ele responde:** o ID da propriedade e o acesso no admin do GA4 são
conta dele; e escolher entre os dois caminhos é decisão de padrão.

**O e-mail para colar no Gerenciamento de acesso** (identificador, não segredo)
é o da conta que ele escolher — os dois estão acima.

### 3c. Search Console é OPCIONAL

`gscSiteUrl` é opcional no tipo, e a ausência **degrada com aviso, não quebra**:
o painel de GSC renderiza "Search Console not configured" e o resto da página
funciona só com GA4. Se ele não tiver GSC para o swaps.pro, tudo bem.

**Confirmado no código, não suposto:** o campo é `gscSiteUrl?: string` no tipo, e
o componente tem um estado `NotConfigured` dedicado. **Esta pergunta sai da lista
do Vlad** — não há nada a decidir nem a fornecer.

## 4. `SWAPS_GATEWAY_URL` e `SWAPS_TOKEN`

O prefixo `SWAPS_*` já está reservado na config, com o comentário explicando que
chat e briefings acendem no dia em que as duas variáveis existirem.

**Por que só ele responde:** é endpoint privado mais segredo. O código já está
pronto para consumi-los.

## 5. O token do portal enxerga a org `coinmastersguild`?

O repo (`coinmastersguild/swapspro`) e o board (`projects/2`) já estão
configurados, mas só funcionam se o token do portal tiver acesso à org.

**Por que só ele responde:** é permissão de conta no GitHub. Dá para descobrir
por tentativa, mas a correção é dele de qualquer jeito.

## 6. Contatos da equipe (`teamContacts`)

**Por que só ele responde:** é PII. Mora no banco, nunca no código — é regra da
casa, não limitação técnica.

## 7. IDs de conta, se forem usar

Discord, Instagram, Google Drive, thirdweb, Facebook.

**Por que só ele responde:** cada um é um identificador de conta que ele
controla. E antes disso há uma decisão de produto: **se** o swaps.pro vai usar
cada um desses canais.

## 8. Qual carteira é o tesouro do swaps.pro?

**A pergunta mais importante da lista, e a única que já está afetando o que
aparece na tela.**

O único endereço EVM que encontrei para o swaps.pro é
`0xAccF0dB4b6B55Ba692467988D0a1188f26428C2b`, e ele é um **0xSplits**: dinheiro
em trânsito, do qual a SOPA leva 20% e o resto segue para os demais
destinatários. **Não é uma carteira própria da marca.**

Ele entrou no `treasury.ethWallets` rotulado como *"Split de taxas (em trânsito
· SOPA 20%)"* em vez de "tesouro", porque o total do hero soma tudo que estiver
ali — e um número que afirma posse de dinheiro de terceiros é exatamente a
classe de coisa que esta base passou a semana removendo. **O rótulo é o que
impede a soma de mentir sozinha.**

**Por que só ele responde:** de fora dá para ver que o endereço recebe taxas e
as reparte. Não dá para ver se o swaps.pro tem uma carteira própria, qual é, nem
o que a marca considera "seu" dinheiro antes da distribuição. É decisão de quem
é dono do dinheiro.

**Se a resposta for outra carteira, são três linhas em `src/projects/swaps.ts`.**

## 9. `FARCASTER_SPONSOR_MNEMONIC` e `_FID` estão setados na Vercel de produção?

O fluxo de conectar Farcaster por QR (`/api/farcaster/project-signer/start`)
responde **503** sem essas duas variáveis. E a ordem das checagens importa: o
`role !== "admin"` é avaliado ANTES do 503, então um não-admin recebe 403 e
nunca descobre se as variáveis existem.

**Verificado:** as duas estão presentes no `.env.local` **local**. Isso não diz
nada sobre produção — são ambientes diferentes, e é a produção que serve o
endpoint.

**Por que só ele responde:** ler a env de produção exige o token Vercel da SOPA,
que não deve ser cruzado com outras credenciais. Ele tem acesso; eu não, por
regra.

**Vale saber antes do QR na mão, não durante.**

---

## Resolvido sem precisar dele: papéis no swaps

Chegou a dúvida de se **semear `TeamMember` seria pré-requisito** para conectar
o Farcaster, já que o endpoint exige `role === "admin"` e o swaps tem zero
linhas. **Não é.**

O `getAccess` tem duas portas para `admin` que passam por fora das linhas do
projeto, e ambas são avaliadas ANTES do fallback de config:

1. Linha em `TeamMember` com `projectSlug = "*"` — existem quatro:
   `xvlad`, `highlander22`, `bithighlander22`, `r4topunk`, todas `admin`.
2. `GLOBAL_ALLOWLIST` em `auth.ts`, fixa no código:
   `["xvlad", "highlander22", "bithighlander22"]`.

**O Vlad é admin global** e recebe `role: "admin"` em todos os portais,
incluindo o swaps, sem nenhuma linha de swaps. Pode conectar o Farcaster hoje.

Os outros seis do allowlist (`bielcx`, `keepkey`, `illithics`,
`humbertoperes`, `nogenta`, `louzoshi`, `vaipraonde`) recebem `member` e **não**
conseguem. Se a conexão precisar ser feita por algum deles, aí sim semear vira
pré-requisito — e isso é decisão de papéis, que é assunto diferente de quem
entra no allowlist.

---

## Decisões de produto que ficaram fora desta lista

Não são perguntas de dado — são escolhas sobre para que serve este portal, e
valem conversa, não resposta rápida:

- **Quais módulos ligar.** Nenhum projeto liga tudo: skatehive é o mais completo
  com 7 flags, keepkey e influencers não ligam nenhuma.
- **Hive e Farcaster.** O swaps.pro **suporta Hive como chain de swap**, o que é
  coisa diferente de *ter conta* na Hive. Se não vão publicar lá, os campos
  ficam vazios de propósito.
- **Semear `TeamMember` ou não.** Hoje o allowlist basta; semear torna o banco
  autoritativo e habilita papéis — ganha controle, perde a simplicidade de
  editar um array. Decisão dele, ainda não tomada.
- **Quem entra no allowlist.** Herdou os 10 do KeepKey. Já decidido em 28/08:
  **fica como está** — é o time do KeepKey, e a config já dizia que era
  proposital.


---

## Duas regras que saíram deste levantamento

### Antes de pedir credencial nova, verifique se a antiga já tem acesso

Custo de checar: minutos. Custo de não checar, medido: **um item parado um dia
inteiro** na lista do Vlad.

Em 27/08 um agente ficou bloqueado no gnars.com por "falta credencial da GA4
Data API". Em 28/08, ao olhar de fato, a conta `bobgnarley@gnars-489819` já
existia, já estava configurada no portal, e a propriedade `527420949` já estava
lá — a leitura de GA4 do Gnars **já funcionava**. A pergunta talvez já
estivesse respondida antes de ser feita.

A verificação é barata e mecânica:

1. `grep` no ambiente por `*_GOOGLE_SERVICE_ACCOUNT_JSON` (ou o equivalente do
   provedor) — existe alguma?
2. Extraia o `client_email` de cada e veja se são a mesma conta ou contas
   distintas.
3. Veja quais projetos já têm a propriedade configurada.

Foi assim que se descobriu, na mesma passada, que **não existe global** e que o
padrão da casa é uma conta por marca — as duas coisas que mudaram o pedido.

### A credencial circula; a permissão não

Por que a service account de LEITURA pode ser compartilhada entre marcas, e a
de identidade não pode:

O resolvedor de GA4 (`getServiceAccountJson`) não usa `brandEnvByPrefix`, então
não tem a trava de dono que protege `HIVE_POSTING_KEY`, `NEYNAR_SIGNER_UUID` e
companhia. E está certo: ler relatório não é postar como ninguém.

Mas o motivo real de ser seguro é melhor que "não é identidade": **a service
account só lê a propriedade em que foi concedida**, no admin do GA4. O mesmo
JSON pode servir várias marcas sem que nenhuma enxergue a propriedade da outra,
porque quem separa é a concessão por propriedade — não o prefixo da variável.

Trava de prefixo protegeria menos e atrapalharia mais. Está escrito também em
`src/lib/google-analytics.ts`, junto do resolvedor, que é onde a próxima pessoa
olha.
