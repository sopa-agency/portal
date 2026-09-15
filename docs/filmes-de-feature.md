# Filmes de feature: vídeos curtos para os tweets de produto

O swaps.pro tem um estúdio em `/demo/features`: 11 filmes de 8 a 16 s, um por
feature, cada um com abertura, ação e assinatura, exportados em MP4 no próprio
navegador e pareados com um tweet. Entrou no repositório em 15/09/2026
(`coinmastersguild/swapspro`, commit `38c1644`, "add isolated feature video
studio and tweet copy"). A ideia aqui é a mesma coisa como parte do portal,
para todos os projetos, começando pela Gnars, que já tem os 10 tweets de
feature escritos na campanha "Gnars.com features".

Este documento é o playbook: o que o swaps.pro fez, o que o portal já tem, de
onde vem cada pedaço de um filme (roteiro, assets, interface), como se exporta,
como se posta, e o plano de entrega em lotes.

---

## 1. O que o swaps.pro fez (lido no commit)

Cerca de 1.200 linhas de TypeScript em `src/app/demo/features/`, sem
dependência nova, sem servidor, sem áudio:

| Arquivo | Papel |
|---|---|
| `featureScript.ts` | A lista das 11 cenas: `id`, `label`, `headline` (duas linhas), `subtitle`, `seconds`, `steps` (três legendas de acessibilidade) e `tweet` (a legenda, com quebras de linha). `sceneAt(segundos)` acha a cena e o tempo local; `supportedVideoType()` escolhe MP4 (`avc1.42001E`) e cai para WebM. Formatos: 16:9 em 1280×720, 4:5 em 1080×1350, 9:16 em 1080×1920. |
| `swapTake.ts` | A coreografia do filme do swap como **função pura do tempo**: `swapUseAt(t)` devolve o estágio (escolhe token, digita 0.25, procura ZEC, rota, review, confirma, recibo), a posição do cursor por keyframes e o texto digitado. Nenhum frame depende do anterior, então dá para arrastar o scrubber para trás. |
| `drawSwapUse.ts` | A **interpretação da interface**: o card de swap desenhado em Canvas 2D a partir do estado de `swapUseAt(t)`, com cursor, digitação, spinner e recibo roteirizado. É a única cena que recria a interface; as outras são motion graphics (moedas convergindo, órbitas, radar, skyline). |
| `renderFeature.ts` | O renderizador: `renderFeature(canvas, cena, t, assets)`. Helpers pequenos (`text`, `fit`, `rect`, `line`, `circle`, `ring`, `glow`, `image`, `coin`) e três easings (`out`, `smooth`, `spring`). Abertura com títulos em cascata, corpo por cena, assinatura em crossfade com o wordmark e a URL. |
| `commercialAssets.ts` | Assets pré-carregados como `HTMLImageElement` de fontes same-origin (`/public` e o proxy de logos do app). Exportar só libera quando **todos** carregaram; imagem que falha mostra "tentar de novo", nunca um placeholder. |
| `FeatureStudio.tsx` | A página: menu de cenas, prévia com scrubber, formato, "Todas as cenas", "Copiar tweet", "Gerar vídeo". Exportação com `canvas.captureStream(30)` + `MediaRecorder` a 8 Mbps, loop por `requestAnimationFrame`, cancela se a aba ficar oculta, arquivo local para baixar. |
| `e2e/feature-studio.spec.ts` | Testes de navegador: prévia de todas as cenas, assets reais, retry de imagem, cancelamento, um vídeo decodificado contém o wordmark, e nenhuma chamada financeira ou de analytics sai da rota. |

Regras que eles escreveram e valem para nós: valores de exemplo sempre
rotulados ("scripted walkthrough. example amounts."); sem preço, retorno,
saldo, hash ou link de explorer; a única chamada de rede permitida é a de
logos; rota `noindex` e fora do sitemap.

**Decisão:** não reescrever. Vendorar esses arquivos no portal (como foi feito
com o `reelflip-studio` em `src/components/studio/`) e trocar o que é do
swaps.pro por o que é do projeto: assets, cenas, marca e legenda.

---

## 2. O que o portal já tem (e vai reaproveitar)

| Peça | Onde | O que faz |
|---|---|---|
| Exportação de vídeo no navegador | `src/components/studio/video-editor.tsx` | O mesmo mecanismo do swaps.pro (`captureStream` + `MediaRecorder`), mais mistura de áudio por WebAudio, se um dia quisermos música. |
| Assets do Drive, seguros para canvas | `/api/brain/drive/file?id=…&mode=raw` | Proxy same-origin: a imagem do Drive entra no canvas sem "taint". Já usado pelo Zine Studio, pelo seletor de imagem e pela capa da revista. |
| Listagem do Drive por projeto | `/api/brain/drive/list` + `project.googleDrive.folderId` | Pasta raiz do projeto, subpastas, filtro por tipo. |
| Marca por projeto | `project.theme` (accent claro/escuro, fundos, bordas) + `theme.logo` em `/public/projects/<slug>/` | Cores e logo do projeto sem configurar nada novo. |
| Texto dos tweets | Campanha → documentos "Tweet N" | O tweet é a legenda do filme. Ver [campanha da Gnars](https://gnars.sopa.team/campaign-creator/cmu2vin8p0000l804sdd63aej). |
| Levar o vídeo para um post | `onUseInPost` no Post Creator | O arquivo exportado entra no fluxo de post existente; upload para IPFS via `uploadMediaDirectClient`. |
| Imagem estática por HTML | `/api/studio/quick` e `/api/studio/render` (satori) | Serve para o thumbnail/poster do filme, não para o vídeo. |

Pré-requisito que não é código: `GNARS_GOOGLE_SERVICE_ACCOUNT_JSON` e
`SKATEHIVE_GOOGLE_SERVICE_ACCOUNT_JSON` na Vercel ainda guardam o caminho do
arquivo local, então o Drive não carrega em produção (PR #107 mostra o motivo
na tela). Sem isso, o estúdio só funciona com assets de `/public` e upload.

---

## 3. Anatomia de um filme

Um filme tem três tempos. Sempre os três, nesta ordem.

1. **Abertura (2 a 4 s):** logo do projeto e uma frase em duas linhas
   (`headline`). É o corte de duas linhas do tweet, não uma frase nova.
   Ex.: "Different chains. / One destination."
2. **Ação (5 a 10 s):** a interface interpretada, com uma única interação
   roteirizada: o cursor entra, digita um valor, aperta um botão, a tela
   responde. Uma ação por filme. Se tem duas ideias, são dois filmes.
3. **Assinatura (2 s):** crossfade para o wordmark e a URL da página
   (`gnars.com/auctions`), com o convite curto quando o tweet tiver um.

Regras de duração e formato:
- 8 a 16 s por filme. O reel "todas as cenas" é só a soma, com a mesma
  legenda-mãe.
- Os três formatos do swaps.pro: 16:9 em 1280×720 para o X, 4:5 em 1080×1350
  para feed, 9:16 em 1080×1920 para Reels/TikTok. O roteiro é o mesmo; o
  layout se reorganiza por formato, não se escala.
- Sem áudio por padrão. Música é uma faixa opcional vinda do Drive,
  misturada pelo WebAudio que já existe no editor de vídeo.
- Área segura: 5% de margem em todos os lados; nada de texto nos 12% de baixo
  no 9:16 (a UI do X/TikTok cobre).

---

## 4. As três fontes de um filme

### 4.1 Roteiro (texto e tempo)

Cada feature é um roteiro em código, não em prompt. Um arquivo por projeto,
`src/lib/films/<slug>.ts`, exporta a lista de cenas no mesmo formato do
`featureScript.ts` do swaps.pro, mais o que é nosso (página, documento do
tweet, assets do Drive):

```ts
export const gnarsFilms: FeatureFilm[] = [
  {
    id: "auctions",
    label: "Auctions",
    url: "gnars.com/auctions",
    tweetDoc: "Tweet 1",            // documento da campanha que é a legenda
    seconds: 12,
    headline: ["One Gnar a day.", "One vote per bid."],
    subtitle: "Daily auctions on Base",
    steps: ["Open the live auction", "Place a bid", "Hold a vote"],
    take: auctionTakeAt,            // (t) => estado da cena, função pura do tempo
    assets: { logo: "public:/projects/gnars/logo.png", screen: "drive:screens/auctions.png" },
  },
  // …
];
```

Por que código e não configuração: cada cena de ação precisa de desenho
(uma auction card, uma lista de propostas, um mapa de rails), e desenho é
função. A configuração fica só para o que é texto, tempo e caminho de asset.

A coreografia de cada cena segue o padrão do `swapTake.ts`: uma função pura
`takeAt(t)` que devolve o estágio, a posição do cursor e o texto digitado.
Nada de estado acumulado entre frames; o scrubber precisa andar para trás.

O texto de abertura e assinatura vem do tweet correspondente. Se o tweet mudar
na campanha, o roteiro é atualizado à mão; a página avisa quando o tweet
ligado ao filme foi editado depois do roteiro.

### 4.2 Assets do Drive

O swaps.pro carrega tudo de `/public` e do proxy de logos do app. O portal
adiciona o Drive, pela pasta por projeto dentro da raiz do Drive do projeto
(`project.googleDrive.folderId`):

```
🎬 Filmes/
  logo.png              PNG com alpha, 1024 px de largura, fundo transparente
  wordmark.png          opcional
  screens/<feature>.png screenshot real da página, 2× (2880 px de largura no desktop)
  clips/<feature>.mp4   H.264, até 10 s, sem áudio, 1920×1080 ou 1080×1920
  audio/<nome>.mp3      opcional
```

O resolvedor de assets aceita `public:` (arquivo em `/public`) e `drive:`
(caminho dentro de `🎬 Filmes/`, resolvido para
`/api/brain/drive/file?id=…&mode=raw` pela listagem). Nada de URL externa: só
proxy do Drive, upload (IPFS via Pinata, que já existe) ou `/public`. Como no
swaps.pro, exportar só libera quando todos os assets carregaram, e imagem que
falha mostra "tentar de novo", nunca um placeholder.

Screenshots e clipes reais são bem-vindos, mas entram como **camada dentro de
um frame** (moldura de dispositivo ou card com sombra, com um movimento lento
de paralaxe), nunca como o filme inteiro. Um screenshot parado é uma imagem,
não um filme.

### 4.3 Interpretação da interface

É o que dá cara ao filme e é a parte mais cara. No swaps.pro só o filme do
swap tem isso (`drawSwapUse.ts`); as outras dez cenas são motion graphics de
logos. Para páginas de produto como as da Gnars, a interpretação é o centro.
A regra: **interpretar, não copiar**. A cena da ação recria a interface em
primitivas do estúdio, com as cores do projeto, e anima a única interação do
roteiro.

Primitivas (poucas, reutilizadas por todos os projetos; os helpers do
`renderFeature.ts` são o ponto de partida):
- `card` (superfície com borda e sombra), `row` (linha de lista), `input`
  (campo com valor digitado ao vivo), `pill` (token/tag), `button`
  (com estado pressionado), `stat` (número grande + rótulo), `avatar`,
  `frame` (moldura de dispositivo para screenshot/clipe), `map-pin`.
- `cursor`: sempre visível na ação, keyframes de posição como em
  `swapTake.ts`, com movimento ease-out de 300 a 600 ms entre alvos e clique
  com um pulso.
- `type`: digitação a 40 a 60 ms por caractere.
- `reveal`: entrada de elementos em cascata (60 ms entre itens).

Cenas de ação por projeto são composições dessas primitivas. Para a Gnars:

| Feature | Cena de ação | Interação |
|---|---|---|
| Auctions | auction-card | cursor digita um lance, aperta "Place bid", o timer reage |
| Proposals | proposal-list | lista entra em cascata, cursor abre uma, barra de votos cresce |
| Bounties | bounty-card | card com recompensa em ETH, cursor aperta "Claim", estado "proof uploaded" |
| Droposals | media-grid | grade de capas em cascata, uma abre em frame com o clipe do Drive |
| Swap | swap-card | escolhe token, digita valor, marca "Support Gnars treasury", "Review swap" |
| NogglesRails | map-pins | mapa com pins caindo (Rio, Nairobi, Rusutsu…), contador de países |
| Stake | rider-card | escolhe um rider, deposita, barra de yield se divide em dois |
| Live feed | feed-stream | eventos entrando de cima, um por vez, com timestamps |
| Propdates | timeline | proposta → updates entrando na linha do tempo |
| Treasury | stats-board | três `stat` (yield, fee, MOR) subindo até o valor |

O que é proibido na interpretação (as regras do swaps.pro, adotadas):
- Números que pareçam medidos (saldo real, preço, quantos abertos hoje). Só
  valores de exemplo, e quando aparecem na legenda, com a linha "example
  amounts" ou "scripted walkthrough".
- Hash de transação, link de explorer, recibo que pareça real.
- Logos de terceiros como endosso (uma ação tokenizada, uma exchange).
- Prometer velocidade, melhor preço, retorno, anonimato.
- Recriar a interface pixel a pixel. A interpretação é mais limpa que o
  produto: menos itens, fontes maiores, um foco só.

---

## 5. Motor: como vira MP4

Confirmado pelo código do swaps.pro: **um roteiro, um renderizador em
canvas**. A cena é desenhada por funções em Canvas 2D a partir de uma função
pura do tempo; a prévia e a exportação usam o mesmo desenho. A exportação é
`captureStream(30)` + `MediaRecorder` a 8 Mbps, em tempo real (um filme de
12 s leva 12 s para exportar, com a aba visível; aba oculta cancela).

Por que não DOM/CSS direto: não dá para gravar DOM em vídeo no navegador sem
passar por canvas. O caminho "serializa o DOM em SVG `foreignObject` e desenha
no canvas a cada frame" existe, mas exige fontes e imagens embutidas em data
URI, animação dirigida por JS (CSS animation não sobrevive à serialização) e
fica pesado para 30 fps. O swaps.pro chegou à mesma conclusão.

O que fica igual ao "gerador HTML": as cenas são escritas em TypeScript com
helpers declarativos (camadas, tempos, easing), a mesma ergonomia de compor
"em HTML" sem a limitação de exportação.

Evolução possível sem mudar o roteiro: trocar o `MediaRecorder` por
`VideoEncoder` (WebCodecs) + um muxer MP4, e exportar frame a frame fora do
tempo real, também em segundo plano. Só se a exportação em tempo real virar
gargalo.

Custo de servidor: zero. Tudo roda no navegador de quem exporta.

---

## 6. Da campanha ao tweet postado

1. Na campanha, cada documento "Tweet N" que tenha uma feature ligada mostra
   **"Gerar filme"**. Abre o estúdio já na feature, com a legenda (o tweet) ao
   lado do preview e o botão "Copiar tweet", como no swaps.pro.
2. A pessoa escolhe o formato (16:9 por padrão), confere os assets (a página
   lista o que achou no Drive e o que falta), toca o preview, exporta.
3. **"Usar no post"** leva o MP4 ao Post Creator; **"Baixar"** salva local.
   O estúdio também sobe o MP4 para o IPFS e grava a URL no documento do
   tweet, para a peça não ficar só na máquina de quem exportou.
4. Postar no X: hoje o portal abre o composer do X com o texto (intent). O
   intent não anexa mídia, então o vídeo é anexado à mão no composer. Se um
   dia formos pela API do X, o documento já tem o MP4 e a legenda juntos.
5. Antes de postar, o checklist (abaixo).

### Checklist antes de postar

- A página ainda faz o que o filme mostra. Abrir a URL da assinatura.
- Legenda é o tweet da campanha, com as quebras de linha preservadas.
- Se a ação usa valores de exemplo ou um fluxo roteirizado, a legenda diz.
- Nenhum número que pareça medido, nenhuma promessa (velocidade, preço,
  retorno), nenhum "hoje" que não seja verdade no dia do post.
- Formato certo para o canal; assinatura legível no celular.

---

## 7. Ordem de entrega

**Estado (15/09/2026):** lotes 1 a 3 no ar para a Gnars em `/films` (menu
"Filmes"): motor vendorado em `src/lib/films/` (`types`, `take`, `draw`,
`render`, `assets`), estúdio em `src/components/films/film-studio.tsx`, os 10
roteiros em `src/lib/films/gnars.ts`, playbook no painel lateral. Falta do lote
3 a pasta `🎬 Filmes/` no Drive (depende do lote 0); do lote 4, tudo.

**Lote 0 (Vlad, sem código):** JSON das service accounts na Vercel, Production
e Preview, e redeploy. Destrava o Drive em produção para Gnars e SkateHive.

**Lote 1, motor vendorado:** copiar `featureScript.ts`, `renderFeature.ts`,
`commercialAssets.ts`, `FeatureStudio.tsx` e o CSS do swapspro (commit
`38c1644`) para `src/components/films/`, com o cabeçalho "vendored from …
sync manually" como no Studio; generalizar o que é do swaps.pro (paleta lime,
wordmark, lista fixa de assets) em parâmetros do projeto; rota `/films`
ligada por `project.films`; resolvedor `public:` / `drive:`. Sem dependência
nova.

**Lote 2, primitivas e marca:** as primitivas da seção 4.3 em cima dos
helpers do renderizador, cursor, digitação, cascata; tokens de cor do projeto;
fontes.

**Lote 3, Gnars:** os 10 roteiros da tabela, um por tweet da campanha, com a
pasta `🎬 Filmes/` no Drive da Gnars preenchida (logo, screenshots das 10
páginas). Entrega: 10 MP4 em 16:9 exportados e conferidos no checklist.

**Lote 4, integração:** "Gerar filme" no documento do tweet, "Usar no post",
upload para IPFS com URL gravada no documento, aviso de tweet editado depois
do roteiro. O teste de navegador do swaps.pro (vídeo decodificado contém o
wordmark) vem junto.

**Depois:** swaps.pro no portal importando as mesmas 11 cenas do repositório
deles (o estúdio original continua lá), depois SkateHive e KeepKey, cada um
com seu `src/lib/films/<slug>.ts`.

---

## 8. Decisões em aberto (Vlad)

1. Nome da rota e do item de menu: `/films` ("Filmes") ou dentro do Post
   Creator como terceiro modo do Studio. A proposta é rota própria: o fluxo é
   menu de features → preview → exportar → legenda, diferente de editar um
   post.
2. Vendorar o motor do swaps.pro (proposta) ou escrever do zero.
3. Guardar o MP4 no IPFS automaticamente a cada exportação, ou só quando a
   pessoa clicar "Usar no post".
4. 9:16 e 4:5 desde o lote 1 (o motor vendorado já traz) ou só 16:9 até os 10
   filmes da Gnars saírem.
5. Música: faixa opcional do Drive já no lote 1, ou nunca (o swaps.pro
   exporta sem áudio).
