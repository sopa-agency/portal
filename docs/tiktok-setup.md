# Ligar o TikTok de uma marca no portal

A tela fica em `/tiktok` (nav → Criação → TikTok), habilitada por
`tiktok: true` no config do projeto. Fluxo:

```
sobe o vídeo → rascunho → alguém aprova → agenda → o scheduler publica
```

O `reviewed` é o portão: **o scheduler ignora qualquer linha que não tenha sido
aprovada por alguém**, então nada publica sozinho.

## Por que não é igual ao Instagram

| | Instagram | TikTok |
|---|---|---|
| Credencial | token de Página que não expira, em `.env` | OAuth por usuário, no banco (`TikTokAccount`) |
| Validade | indefinida | access token 24h, refresh token 365 dias **que rotaciona** |
| Post público | app em modo Dev já publica | só depois da **auditoria** da TikTok |
| Mídia | URL pública direto | `FILE_UPLOAD` (o `PULL_FROM_URL` exige domínio verificado) |
| Agendamento | nosso scheduler | nosso scheduler (a API não agenda) |

A rotação do refresh token é o detalhe que mais quebra integração: a resposta do
refresh pode vir com um `refresh_token` **novo**, e guardar o antigo mata a
conexão. O [`tiktok.ts`](../src/lib/tiktok.ts) sempre grava o que voltou.

## Passo 1 — criar o app

Em [developers.tiktok.com](https://developers.tiktok.com) → Manage apps → Connect
an app:

1. Adicione o produto **Content Posting API** e ligue **Direct Post**.
2. Adicione o **Login Kit** e registre a redirect URI — exatamente:

   ```
   https://nogenta.SEU-DOMINIO/api/tiktok/callback
   http://nogenta.localhost:3010/api/tiktok/callback   (dev)
   ```

   Ela precisa bater byte a byte com a que o portal manda; as duas são geradas
   pela mesma função (`tiktokRedirectUri`), então basta registrar as duas.
3. Peça os escopos: `user.info.basic`, `video.publish`, `video.upload`.

## Passo 2 — envs

Copie Client key e Client secret pro `.env.local`:

```
NOGENTA_TIKTOK_CLIENT_KEY=
NOGENTA_TIKTOK_CLIENT_SECRET=
```

O prefixo é o `agent.gatewayEnvPrefix` do projeto. Como no Instagram, não existe
fallback entre marcas.

## Passo 3 — criar as tabelas

```sh
dotenv -e .env.local -- node scripts/create-tiktok-tables.cjs
```

Aditivo: só cria `TikTokAccount` e `TikTokPost`. Rode o mesmo contra o
`DATABASE_URL` de produção. (`prisma db push` não serve — a base tem drift
pré-existente no `InstagramPost`.)

## Passo 4 — conectar a conta

Abra `/tiktok` e clique em **Conectar TikTok**. O portal faz o fluxo com PKCE +
state em cookie, guarda os tokens e já busca o `creator_info` pra saber o handle,
quais visibilidades a conta permite e o limite de duração do vídeo.

Daí em diante o refresh é automático (5 minutos antes de expirar). Se o refresh
token vencer — 365 dias, ou porque ninguém publicou nesse período — a tela e o
Settings avisam pra reconectar.

## Passo 5 — a auditoria

Enquanto o app não passa pela auditoria da TikTok, **tudo que a API publicar fica
privado**. O portal não finge que não: a flag `audited` na `TikTokAccount` começa
`false`, a tela mostra o aviso, e o `publishTikTokVideo` rebaixa a visibilidade
pra `SELF_ONLY` em vez de mandar um valor que a API recusaria.

Isso é o suficiente pra testar tudo ponta a ponta — o vídeo sobe de verdade,
aparece na conta, só que privado.

Quando a TikTok aprovar, vire a flag:

```sh
dotenv -e .env.local -- npx prisma db execute --stdin <<'SQL'
UPDATE "TikTokAccount" SET "audited" = true WHERE "projectSlug" = 'nogenta';
SQL
```

A partir daí a visibilidade escolhida na tela é respeitada.

### O que a auditoria exige da TELA (não quebre isso)

As diretrizes de UX da TikTok são parte do que é auditado, e a tela já foi feita
pra cumprir. Mexer nesses pontos pode reprovar a auditoria:

- **A visibilidade começa sem valor escolhido.** O dropdown abre em "Selecione…"
  e o botão de salvar fica desabilitado até alguém escolher. Não coloque padrão.
- **As opções vêm do `creator_info`**, não de uma lista fixa.
- **A conta de destino aparece na tela**, pelo `creator_nickname`.
- **Divulgação comercial é um toggle só, desligado por padrão**, e só depois abre
  as duas opções ("Sua marca" / "Conteúdo de marca"), mostrando qual selo o vídeo
  vai receber — "Conteúdo promocional" ou "Parceria paga".
- **Parceria paga não pode ser privada**: a opção fica desabilitada no dropdown,
  com explicação — não é erro depois de salvar.
- **A declaração antes do botão**: Confirmação de Uso de Música, trocada pela
  Política de Conteúdo de Marca quando é parceria paga.
- **O aviso de processamento** ("pode levar alguns minutos") fica junto do envio.

## Detalhes que a API impõe

- **Legenda**: máximo 2200 caracteres. Hashtags e @mentions funcionam no texto.
- **Rate limit**: 6 requisições por minuto por token, mais um teto diário de
  posts. Por isso o scheduler publica **um** TikTok por tick.
- **Parceria paga** (`brand_content_toggle`) não pode sair como privado — a tela
  bloqueia antes de salvar.
- **Publicação é assíncrona**: a API devolve um `publish_id` na hora e processa o
  vídeo depois. O link público só existe quando ela termina — daí o botão
  "Conferir status" no item já publicado.
- **Opções de visibilidade** vêm do `creator_info` a cada render, não são fixas:
  se a conta virar privada, a lista muda sozinha e o item antigo ganha um aviso.

## O que ainda não existe

- Não há curadoria de **engajamento** (responder comentário) — a tela é só a fila
  de publicação. A API de comentários do TikTok é bem mais restrita que a da Meta.
- O vídeo sobe inteiro em um chunk. Se aparecer arquivo grande o bastante pra
  estourar a janela de 1 hora do upload, aí vale partir em chunks.
