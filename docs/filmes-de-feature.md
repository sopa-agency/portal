# Filmes de feature: o estúdio do portal

Rota `/films` (menu "Filmes"), ligada por `project.films`. Um filme curto
(8 a 16 s) por página do produto, pareado com o tweet da campanha, exportado
em MP4 no próprio navegador. Sem servidor, sem custo, sem dependência de
serviço externo.

Este é o playbook: o que a página faz, como um filme é feito (roteiro,
assets, interface), como se exporta e posta, como adicionar filmes a um
projeto, e o que vem depois.

---

## 1. O que a página faz

- **Cenas**: uma por feature, na coluna da esquerda, com a duração.
- **Prévia** com play e scrubber; a cena é função pura do tempo, então o
  scrubber anda para trás sem estado acumulado.
- **Formatos**: 16:9 em 1280×720 para o X, 4:5 em 1080×1350 para feed, 9:16
  em 1080×1920 para Reels/TikTok. O layout se reorganiza por formato.
- **Gerar vídeo**: MP4 gravado em tempo real no navegador (um filme de 12 s
  leva 12 s, com a aba visível; aba oculta cancela). WebM quando o navegador
  não grava MP4. "Todas as cenas" gera o reel inteiro.
- **Tweet da cena** com "Copiar tweet", quebras de linha preservadas, e o
  aviso quando o filme mostra valores de exemplo.
- **Editar texto**: manchete (2 linhas), subtítulo, legendas por estágio e
  tweet, com a prévia mudando ao vivo. "Salvar" grava por projeto e cena
  (tabela `FilmTextOverride`); "Restaurar roteiro" volta ao texto em código.
  Cena editada ganha o selo "editado".
- **Gerar cena com IA**: nome da feature, página, o que ela faz (ou o tweet)
  e uma direção opcional; o agente do projeto escreve a cena em dados (ver
  3.6), validada antes de entrar na lista com o selo "IA".
- **Remixar com IA**: uma instrução sobre a cena selecionada gera uma versão
  nova em dados (selo "remix"); vale para cenas em código também, que passam
  pela descrição delas.
- **Editar cena (JSON)**: nas cenas em dados, o JSON inteiro abre num editor;
  "Aplicar na prévia" mostra ao vivo, "Salvar" grava, "Apagar cena" remove.
- **Assets**: a coluna diz o que carregou, o que o Drive tem e o que falta.
- **Playbook**: este documento, no painel lateral.

---

## 2. Anatomia de um filme

Três tempos, sempre nesta ordem.

1. **Abertura (2 a 4 s):** logo do projeto e a manchete em duas linhas. É o
   corte de duas linhas do tweet, não uma frase nova.
2. **Ação (5 a 10 s):** a interface interpretada, com uma única interação
   roteirizada: o cursor entra, digita um valor, aperta um botão, a tela
   responde. Uma ação por filme. Se tem duas ideias, são dois filmes.
3. **Assinatura (2 s):** crossfade para o logo, o nome e a URL da página.

Regras:
- 8 a 16 s por filme. O reel é só a soma, com a mesma legenda-mãe.
- Sem áudio por padrão.
- Área segura: 5% de margem; nada de texto nos 12% de baixo no 9:16.
- Nada parado na tela: o fundo tem partículas e luzes correndo nas órbitas, a
  ação entra com spring e deriva devagar como uma câmera no ombro.

---

## 3. As três fontes de um filme

### 3.1 Roteiro (texto e tempo)

Cada feature é um roteiro em código, `src/lib/films/<slug>.ts`, com a lista
de cenas do projeto:

```ts
{
  id: "auctions",
  label: "Auctions",
  url: "gnars.com/auctions",
  tweetDoc: "Tweet 1",            // documento da campanha que é a legenda
  seconds: 12,
  headline: ["One Gnar a day.", "One vote per bid."],
  subtitle: "Daily auctions on Base",
  steps: ["Open the live auction", "Place a bid", "Hold a vote in the DAO"],
  captions: [...], captionAt: (t) => stage(t, [[2.7, 0], [5.6, 1]], 2),
  tweet: "…",
  exampleValues: true,
  assets: { gnar: "public:/projects/gnars/films/gnar-1.webp" },
  draw(p, t, assets) { /* a ação, centrada em (0,0), numa caixa de ~560×520 */ },
}
```

Por que código e não configuração: cada cena de ação precisa de desenho (uma
auction card, uma lista de propostas, um globo), e desenho é função. O que é
texto é editável na página; o que é desenho fica em código.

A coreografia é uma função pura do tempo. Os helpers de `take.ts` (`stage`,
`typed`, `cursorAt`, `countUp`, easings) devolvem tudo que a cena precisa
para desenhar o instante `t`. Nada depende do frame anterior.

### 3.2 Assets

Fontes aceitas: `public:` (arquivo em `/public`), `drive:` (caminho dentro da
pasta `🎬 Filmes/` na raiz do Drive do projeto, servido pelo proxy same-origin
para o canvas não ficar "tainted") e `data:`. Nada de URL externa.

```
🎬 Filmes/
  logo.png              PNG com alpha, 1024 px de largura
  screens/<feature>.png screenshot real da página, 2×
  clips/<feature>.mp4   H.264, até 10 s, sem áudio
```

Exportar só libera quando o logo da marca carregou; asset do Drive que não
existe some do desenho e a página lista o que falta. Screenshots e fotos
entram como camada dentro de um frame (card, polaroid, moldura), com
movimento lento de câmera (Ken Burns), nunca como o filme inteiro.

**Assets do próprio site**, copiados para `/public/projects/<slug>/films/`:
para a Gnars, a escultura 3D do NogglesRail (`nograil.glb`), dois Gnars reais
(via `tokenURI` na Base, render do nouns.build), os cutouts dos riders da
página /stake, cinco fotos de rails, noggles, logos POIDH e Morpheus. Tudo da
casa ou CC0. Quando o site ganhar um asset novo, o caminho é o mesmo: copiar
para a pasta e referenciar com `public:`.

### 3.3 Interpretação da interface

A regra: **interpretar, não copiar**. A cena recria a página em primitivas do
estúdio (`draw.ts`), com as cores do projeto, e anima a única interação do
roteiro. Primitivas: `card`, `row`, `input` (com digitação e caret), `pill`,
`button` (com estado pressionado), `stat`, `progress`, `avatar`, `image`,
`imageCover` (Ken Burns), `polaroid`, `coin` (tile biselado com logo),
`streak` (luz correndo), `sparkline`, `cursor`, `fade`, `reveal` (cascata),
`wrap`, `noggles`, `scene3d`.

Proibido na interpretação:
- Números que pareçam medidos (saldo, preço, quantos abertos hoje). Só valores
  de exemplo, e a legenda diz "example amounts" quando aparecem.
- Hash de transação, link de explorer, recibo que pareça real.
- Logo de terceiro como endosso. Promessa de velocidade, preço, retorno.
- Recriar pixel a pixel. A interpretação é mais limpa que o produto: menos
  itens, fontes maiores, um foco só.

### 3.4 Cor da marca

O roteiro fixa `brand.accent` quando a cor da marca não é a do tema do
portal. A Gnars usa o amarelo do logo (`#fce560`); o vermelho fica onde é
vermelho de verdade (os noggles, a escultura no preset "OG Nogglesrail"
`#FF2D2D`). Sem `brand.accent`, vale o accent do tema do projeto. A paleta
(`paletteFor`) deriva o resto: fundo escuro neutro, superfícies, texto sobre o
accent claro ou escuro conforme a luminância.

### 3.5 Cenas 3D (three.js)

Um asset pode ser uma cena three.js. O roteiro declara `prepare()`, que
carrega o GLB uma vez e devolve um `Scene3D`; a cena chama
`p.scene3d("rail3d", x, y, w, h, { spin })`, que renderiza o frame `t` num
canvas WebGL próprio e o desenha no canvas 2D. A rotação é função do tempo,
então prévia, scrubber e exportação batem. `three` entra por `import()`
dinâmico só quando a cena precisa. Sem WebGL ou sem GLB, o filme cai para o
ícone 2D e a página lista o asset em falta.

### 3.6 Cenas em dados (o que a IA escreve)

Uma cena pode ser um JSON em vez de código: `FilmSpec` (`src/lib/films/spec.ts`),
com id, label, url, seconds, headline, subtitle, captions (+ captionTimes),
tweet, exampleValues, assets e `layers`. Cada camada tem tipo (card, rect,
row, text, pill, button, input, image, polaroid, coin, stat, progress, check,
avatar, sparkline, streak, timer, cursor, burst, scene3d), posição no mesmo
sistema das cenas em código (ação centrada em 0,0) e tempo: `in` (quando
aparece), `out` (quando some), `enter` (fade, rise, spring, none). A história
é contada com tempos: o cursor anda por keyframes, clica quando o botão tem
`press` no mesmo segundo, o input digita entre `typeFrom` e `typeTo`, o
estado troca com `out` numa camada e `in` na outra, `burst` comemora.

O interpretador (`drawSpec`) desenha com as mesmas primitivas; `specToFilm`
transforma o JSON numa cena igual às outras (prévia, formatos, exportação,
texto editável). O zod valida tudo antes do banco e do canvas. A IA recebe o
guia do formato (`SPEC_GUIDE`), uma cena de exemplo e o catálogo de assets do
projeto (os `public:` dos roteiros mais `extraAssets`, inclusive o GLB, que
vira uma camada `scene3d`). As cenas ficam na tabela `FilmScene`
(`sceneId` único por projeto, `spec`, `source` ia/remix/manual, `basedOn`).

---

## 4. Motor: como vira MP4

Um roteiro, um renderizador em canvas (`render.ts`): fundo, abertura, ação
(`film.draw`) e assinatura. Prévia e exportação usam o mesmo desenho. A
exportação é `captureStream(30)` + `MediaRecorder` a 8 Mbps.

Por que não DOM/CSS direto: não dá para gravar DOM em vídeo no navegador sem
passar por canvas. O caminho "serializa o DOM em SVG `foreignObject` e desenha
por frame" exige fontes e imagens embutidas, animação dirigida por JS e fica
pesado a 30 fps. Com poucas primitivas, canvas é mais barato e previsível.

Evolução possível sem mudar o roteiro: `VideoEncoder` (WebCodecs) + um muxer
MP4, exportando frame a frame fora do tempo real. Só se a exportação em tempo
real virar gargalo.

---

## 5. Da campanha ao tweet postado

1. O tweet da cena é a legenda; "Copiar tweet" preserva as quebras de linha.
2. Escolher o formato, conferir os assets, tocar a prévia, exportar.
3. Baixar o MP4 e anexar à mão no composer do X (o intent do portal não anexa
   mídia). O documento do tweet na campanha guarda a legenda.
4. Checklist antes de postar:
   - A página ainda faz o que o filme mostra. Abrir a URL da assinatura.
   - Se a ação usa valores de exemplo, a legenda diz.
   - Nenhum número que pareça medido, nenhuma promessa, nenhum "hoje" que não
     seja verdade no dia do post.
   - Formato certo para o canal; assinatura legível no celular.

---

## 6. Como adicionar filmes a um projeto

1. `films: true` no `src/projects/<slug>.ts`.
2. `src/lib/films/<slug>.ts` exportando um `FilmSet` (`brand` + `films`), e a
   linha no registro em `src/lib/films/index.ts`.
3. Assets em `/public/projects/<slug>/films/` (ou no Drive, em `🎬 Filmes/`).
4. Uma cena por tweet da campanha; `tweetDoc` aponta o documento.
5. Verificar: build de produção num worktree, Chrome headless com sessão
   assinada, frames por cena, uma exportação de verdade.

---

## 7. Estado e o que vem depois

**Entregue (Gnars, 15/09/2026):** rota, motor, 10 cenas com assets reais e a
escultura 3D, texto editável por cena, playbook no painel.

**Entregue (16/09/2026):** cenas em dados (3.6): "Gerar cena com IA",
"Remixar com IA" (também a partir das cenas em código), editor JSON com
prévia ao vivo, salvar e apagar. As cenas em código continuam como referência
e como fallback.

**Próximo:** um editor visual por cima do JSON (arrastar camadas, ajustar
tempos numa linha do tempo) e "Gerar cena" direto do documento do tweet na
campanha.

**Depois:** "Gerar filme" dentro do documento do tweet na campanha, "Usar no
post", MP4 guardado no IPFS com a URL no documento, swaps.pro, SkateHive e
KeepKey com seus próprios `src/lib/films/<slug>.ts`.

---

*O motor nasceu do estúdio de comerciais do swaps.pro
(`coinmastersguild/swapspro` @ `38c1644`, `src/app/demo/features`), vendorado
e generalizado aqui. O original continua no repositório deles.*
