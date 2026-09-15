# Filmes de feature: vídeos curtos para os tweets de produto

O swaps.pro fez um estúdio (`/demo/features`): 11 filmes de 8 a 16 s, um por
feature, cada um com abertura, ação e assinatura, exportados em MP4 no próprio
navegador e pareados com um tweet. A ideia aqui é a mesma coisa como parte do
portal, para todos os projetos, começando pela Gnars, que já tem os 10 tweets
de feature escritos na campanha "Gnars.com features".

Este documento é o playbook: o que é um filme, de onde vem cada pedaço
(roteiro, assets, interface), como se exporta, como se posta, e o plano de
entrega em lotes.

---

## 1. O que o portal já tem (não reinventar)

| Peça | Onde | O que faz |
|---|---|---|
| Exportação de vídeo no navegador | `src/components/studio/video-editor.tsx` | `canvas.captureStream(30)` + `MediaRecorder`, MP4 onde o navegador suporta (Chrome, Safari), WebM de reserva. Sem ffmpeg, sem servidor. Mistura de áudio por WebAudio já existe. |
| Assets do Drive, seguros para canvas | `/api/brain/drive/file?id=…&mode=raw` | Proxy same-origin: a imagem do Drive entra no canvas sem "taint". Já usado pelo Zine Studio, pelo seletor de imagem e pela capa da revista. |
| Listagem do Drive por projeto | `/api/brain/drive/list` + `project.googleDrive.folderId` | Pasta raiz do projeto, subpastas, filtro por tipo. |
| Marca por projeto | `project.theme` (accent claro/escuro, fundos, bordas) + `theme.logo` em `/public/projects/<slug>/` | Cores e logo do projeto sem configurar nada novo. |
| Texto dos tweets | Campanha → documentos "Tweet N" | O tweet é a legenda do filme. Ver [campanha da Gnars](https://gnars.sopa.team/campaign-creator/cmu2vin8p0000l804sdd63aej). |
| Levar o vídeo para um post | `onUseInPost` no Post Creator | O arquivo exportado entra no fluxo de post existente; upload para IPFS via `uploadMediaDirectClient`. |
| Imagem estática por HTML | `/api/studio/quick` e `/api/studio/render` (satori) | Serve para o thumbnail/poster do filme, não para o vídeo. |

Pré-requisito que não é código: `GNARS_GOOGLE_SERVICE_ACCOUNT_JSON` e
`SKATEHIVE_GOOGLE_SERVICE_ACCOUNT_JSON` na Vercel ainda guardam o caminho do
arquivo local, então o Drive não carrega em produção (PR #107 mostra o motivo
na tela). Sem isso, o estúdio só funciona com upload manual.

---

## 2. Anatomia de um filme

Um filme tem três tempos. Sempre os três, nesta ordem.

1. **Abertura (2 a 4 s):** logo do projeto e uma frase em no máximo duas
   linhas. É o corte de duas linhas do tweet, não uma frase nova.
   Ex.: "Different chains. / One destination."
2. **Ação (5 a 10 s):** a interface interpretada, com uma única interação
   roteirizada: o cursor entra, digita um valor, aperta um botão, a tela
   responde. Uma ação por filme. Se tem duas ideias, são dois filmes.
3. **Assinatura (2 s):** a URL da página (`gnars.com/auctions`), o logo, e o
   convite curto quando o tweet tiver um.

Regras de duração e formato:
- 8 a 16 s por filme. O reel "todas as cenas" é só a soma, com a mesma
  legenda-mãe.
- 16:9 para o X (1920×1080). 9:16 (1080×1920) para Reels/TikTok e 1:1 quando
  pedirem. O roteiro é o mesmo; o layout se reorganiza por formato, não se
  escala.
- Sem áudio por padrão. Música é uma faixa opcional vinda do Drive,
  misturada pelo WebAudio que já existe.
- Área segura: 5% de margem em todos os lados; nada de texto nos 12% de baixo
  no 9:16 (a UI do X/TikTok cobre).

---

## 3. As três fontes de um filme

### 3.1 Roteiro (texto e tempo)

Cada feature é um roteiro em código, não em prompt. Um arquivo por projeto,
`src/lib/films/<slug>.ts`, exporta a lista de features:

```ts
export const gnarsFilms: FeatureFilm[] = [
  {
    slug: "auctions",
    label: "Auctions",
    url: "gnars.com/auctions",
    tweet: "Tweet 1",            // documento da campanha que é a legenda
    duration: 12,
    opening: ["One Gnar a day.", "One vote per bid."],
    action: { scene: "auction-card", props: { token: "Gnar #2345", bid: "0.42 ETH", timer: "05:12" } },
    signature: { url: "gnars.com/auctions", cta: "Watch the live one." },
    assets: { logo: "drive:logo.png", screen: "drive:screens/auctions.png" },
  },
  // …
];
```

Por que código e não configuração: cada cena de ação precisa de desenho
(uma auction card, uma lista de propostas, um mapa de rails), e desenho é
função. A configuração fica só para o que é texto, tempo e caminho de asset.

O texto de abertura e assinatura vem do tweet correspondente. Se o tweet mudar
na campanha, o roteiro é atualizado à mão; a página avisa quando o tweet
ligado ao filme foi editado depois do roteiro.

### 3.2 Assets do Drive

Pasta por projeto dentro da raiz do Drive do projeto (`project.googleDrive.folderId`):

```
🎬 Filmes/
  logo.png              PNG com alpha, 1024 px de largura, fundo transparente
  wordmark.png          opcional
  screens/<feature>.png screenshot real da página, 2× (2880 px de largura no desktop)
  clips/<feature>.mp4   H.264, até 10 s, sem áudio, 1920×1080 ou 1080×1920
  audio/<nome>.mp3      opcional
```

O estúdio lê a pasta pela rota de listagem e resolve `drive:<caminho>` para
`/api/brain/drive/file?id=…&mode=raw`. Nada de URL externa: só proxy do
Drive, upload (IPFS via Pinata, que já existe) ou `/public`.

Screenshots e clipes reais são bem-vindos, mas entram como **camada dentro de
um frame** (device frame ou card com sombra, com um movimento lento de
paralaxe), nunca como o filme inteiro. Um screenshot parado é uma imagem, não
um filme.

### 3.3 Interpretação da interface

É o que dá cara ao filme e é a parte mais cara. A regra: **interpretar, não
copiar**. A cena da ação recria a interface em primitivas do estúdio, com as
cores do projeto, e anima a única interação do roteiro.

Primitivas (poucas, reutilizadas por todos os projetos):
- `card` (superfície com borda e sombra), `row` (linha de lista), `input`
  (campo com valor digitado ao vivo), `pill` (token/tag), `button`
  (com estado pressionado), `stat` (número grande + rótulo), `avatar`,
  `frame` (moldura de dispositivo para screenshot/clipe), `map-pin`.
- `cursor`: sempre visível na ação, com movimento ease-out de 300 a 600 ms
  entre alvos, clique com um pulso.
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

O que é proibido na interpretação:
- Números que pareçam medidos (saldo real, preço, quantos abertos hoje). Só
  valores de exemplo, e quando aparecem na legenda, com a linha "example
  amounts" ou "scripted walkthrough", como o swaps.pro faz.
- Logos de terceiros como endosso (uma ação tokenizada, uma exchange).
- Prometer velocidade, melhor preço, retorno, anonimato.
- Recriar a interface pixel a pixel. A interpretação é mais limpa que o
  produto: menos itens, fontes maiores, um foco só.

---

## 4. Motor: como o HTML vira MP4

Decisão: **um roteiro, um renderizador em canvas**. A cena é um grafo de
camadas com keyframes (posição, opacidade, escala, texto revelado), desenhado
por funções em Canvas 2D. A prévia e a exportação usam o mesmo desenho, como o
editor de vídeo do Studio já faz. A exportação é a que já existe:
`captureStream` + `MediaRecorder`, em tempo real (um filme de 12 s leva 12 s
para exportar, com a aba aberta).

Por que não DOM/CSS direto: não dá para gravar DOM em vídeo no navegador sem
passar por canvas. O caminho "serializa o DOM em SVG `foreignObject` e desenha
no canvas a cada frame" existe, mas exige fontes e imagens embutidas em data
URI, animação dirigida por JS (CSS animation não sobrevive à serialização) e
fica pesado para 30 fps. O custo não compensa quando as primitivas são poucas.

O que fica igual ao "gerador HTML" do swaps.pro: as cenas são escritas em
TypeScript com uma DSL declarativa (camadas, tempos, easing), o que dá a
mesma ergonomia de compor "em HTML" sem a limitação de exportação.

Evolução possível sem mudar o roteiro: trocar o `MediaRecorder` por
`VideoEncoder` (WebCodecs) + um muxer MP4, e exportar frame a frame fora do
tempo real, também em segundo plano. Só se a exportação em tempo real virar
gargalo.

Custo de servidor: zero. Tudo roda no navegador de quem exporta.

---

## 5. Da campanha ao tweet postado

1. Na campanha, cada documento "Tweet N" que tenha uma feature ligada mostra
   **"Gerar filme"**. Abre o estúdio já na feature, com a legenda (o tweet) ao
   lado do preview.
2. A pessoa escolhe o formato (16:9 por padrão), confere os assets do Drive
   (a página lista o que achou e o que falta), toca o preview, exporta.
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

## 6. Ordem de entrega

**Lote 0 (Vlad, sem código):** JSON das service accounts na Vercel, Production
e Preview, e redeploy. Destrava o Drive em produção para Gnars e SkateHive.

**Lote 1, motor:** rota `/films` ligada por `project.films` na configuração do
projeto; grafo de cenas + keyframes + renderizador canvas; prévia com scrubber
e play; formatos 16:9, 9:16, 1:1; exportação reaproveitando o gravador do
`video-editor.tsx`; "Todas as cenas". Sem dependência nova.

**Lote 2, primitivas e marca:** as primitivas da seção 3.3, cursor, digitação,
cascata; tokens de cor do projeto; fontes; resolução de `drive:` e de
`/public`.

**Lote 3, Gnars:** os 10 roteiros da tabela, um por tweet da campanha, com a
pasta `🎬 Filmes/` no Drive da Gnars preenchida (logo, screenshots das 10
páginas). Entrega: 10 MP4 em 16:9 exportados e conferidos no checklist.

**Lote 4, integração:** "Gerar filme" no documento do tweet, "Usar no post",
upload para IPFS com URL gravada no documento, aviso de tweet editado depois
do roteiro.

**Depois:** swaps.pro (os 11 filmes do estúdio deles, refeitos no portal, já
que o `/demo/features` não está no ar nem no repositório que temos), depois
SkateHive e KeepKey, cada um com seu `src/lib/films/<slug>.ts`.

---

## 7. Decisões em aberto (Vlad)

1. Nome da rota e do item de menu: `/films` ("Filmes") ou dentro do Post
   Creator como terceiro modo do Studio. A proposta é rota própria: o fluxo é
   menu de features → preview → exportar → legenda, diferente de editar um
   post.
2. Guardar o MP4 no IPFS automaticamente a cada exportação, ou só quando a
   pessoa clicar "Usar no post".
3. 9:16 desde o lote 1 ou só depois dos 10 filmes da Gnars em 16:9.
4. Música: faixa opcional do Drive já no lote 1, ou nunca (o swaps.pro
   exporta sem áudio).
