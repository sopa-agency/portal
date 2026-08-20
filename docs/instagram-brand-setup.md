# Ligar o Instagram de uma marca no portal

Cada portal publica com as **próprias** credenciais Meta. O
[`src/lib/brand-env.ts`](../src/lib/brand-env.ts) bloqueia fallback entre marcas de
propósito — senão a Nogenta postaria com o token da SkateHive, no Instagram da
SkateHive. Então uma marca nova fica sem publicar até existirem:

```
<PREFIX>_INSTAGRAM_ACCESS_TOKEN
<PREFIX>_INSTAGRAM_BUSINESS_ACCOUNT_ID
```

`<PREFIX>` é o `agent.gatewayEnvPrefix` do projeto (`NOGENTA`, `GNARS`,
`SKATEHIVE`, `REELFLIP`, `VLAD`).

O resto — Post Creator, agendamento, o worker que publica na hora marcada — já é
genérico: o scheduler resolve o projeto pelo `projectSlug` da linha
([`scheduler-core.ts:268`](../src/lib/scheduler-core.ts#L268)), sem nada por marca.

---

## Passo 1 — a conta precisa ser Profissional + ligada a uma Página

No app do Instagram da marca (ex.: `@nogenta`):

1. **Configurações → Conta → Mudar para conta profissional** (Criador ou
   Empresa; ambos servem pra API).
2. **Configurações → Central de Contas → Conectar uma Página do Facebook.**
   Se a marca não tem Página, crie uma — a Graph API só enxerga contas do
   Instagram através de uma Página.

Sem esses dois passos, o passo 3 devolve a lista de Páginas vazia.

## Passo 2 — dar acesso ao seu usuário e ao App Meta

No [Meta Business Suite](https://business.facebook.com):

1. A Página e a conta do Instagram precisam estar no mesmo **Portfólio
   Empresarial** das outras marcas.
2. Seu usuário Facebook precisa ser **admin da Página**.

**Cada marca aqui tem o seu próprio app Meta**, um por token — dá pra confirmar
perguntando ao Graph API a que app cada token pertence:

| Token | App Meta |
|---|---|
| `SKATEHIVE_INSTAGRAM_ACCESS_TOKEN` | SkateHive Worker (`1929197424470720`) |
| `GNARS_INSTAGRAM_ACCESS_TOKEN` | Gnars Worker (`1574702697407794`) |
| `REELFLIP_INSTAGRAM_ACCESS_TOKEN` | Reelflip Worker (`977649531703272`) |
| `VLAD_INSTAGRAM_ACCESS_TOKEN` | SkateHive Worker (reaproveitado) |

Então o padrão pra Nogenta é criar um **"Nogenta Worker"** em
[developers.facebook.com/apps](https://developers.facebook.com/apps) (tipo
*Business*), adicionar o produto **Instagram Graph API** e deixar o app em modo
*Desenvolvimento* — publicar nas contas que você mesmo administra não exige App
Review, que é como os outros já funcionam. Reaproveitar um app existente também
serve tecnicamente (a Vlad reaproveita o da SkateHive); o app novo só mantém a
separação por marca e evita mexer no que já está em produção.

Anote `META_APP_ID` e `META_APP_SECRET` do app (Painel do app →
Configurações → Básico) e coloque no `.env.local` — o script usa para trocar o
token.

## Passo 3 — gerar o token

1. Abra o [Graph API Explorer](https://developers.facebook.com/tools/explorer).
2. Selecione o app da marca (o "Nogenta Worker" do passo 2), **User Token**, e
   marque as permissões:

   ```
   pages_show_list           business_management
   instagram_basic           instagram_content_publish
   instagram_manage_comments instagram_manage_insights
   pages_read_engagement     pages_manage_posts
   ```

   `instagram_content_publish` é a que autoriza publicar; sem ela o portal só
   consegue ler métricas. `instagram_manage_comments` é o que permite o primeiro
   comentário automático (as hashtags).

3. **Generate Access Token**, aceite o diálogo escolhendo a Página da marca, e
   copie o token (ele é curto — vale 1–2 horas).
4. Rode:

   ```sh
   node scripts/instagram-token-setup.cjs --prefix NOGENTA --token EAAG…
   ```

   O script troca o token curto por um de longa duração, lista todas as Páginas
   com a conta do Instagram de cada uma, e imprime o bloco de env pronto pra
   cada uma. **Tokens de Página derivados de um token de usuário de longa
   duração não expiram** — é por isso que o script faz a troca antes de listar.

5. Cole no `.env.local` só o bloco da conta certa e confira o `@handle` que o
   script mostrou (o `socials[]` da Nogenta ainda tem o handle marcado como
   placeholder em [`src/projects/nogenta.ts`](../src/projects/nogenta.ts)).

## Passo 4 — verificar

```sh
node scripts/instagram-token-setup.cjs --prefix NOGENTA --check
```

Confirma três coisas: o token responde e é da conta certa, a permissão de
publicação está concedida (lendo a cota de 100 posts/24h), e se o token tem
validade. Depois, `nogenta.localhost:3010/settings` deve mostrar **Instagram:
connected**.

## Passo 5 — produção

O `.env.local` só resolve o dev. Espelhe na Vercel:

```sh
vercel env add NOGENTA_INSTAGRAM_ACCESS_TOKEN production
vercel env add NOGENTA_INSTAGRAM_BUSINESS_ACCOUNT_ID production
```

Lembrando que o publisher normal roda no **Mac (PM2)** e a Vercel é só a rede de
segurança quando o Mac cai — então as envs precisam existir nos dois lugares.

---

## Enquanto o token não sai

Dá pra marcar post sem credencial de publicação: o Post Creator salva rascunho,
faz upload de mídia (isso usa o `PINATA_JWT` global, que já existe) e agenda —
a linha entra no calendário normalmente. O que falha é só a publicação na hora
marcada.

Pra fechar o ciclo sem token, use o **modo manual**. Ele não é um botão: o
portal deriva `publishMode` do preenchimento
([`post-creator.ts:180`](../src/app/actions/post-creator.ts#L180)) — basta
preencher música, parceria paga ou localização, e o post vira lembrete em vez de
publicação automática. O scheduler ignora essas linhas de propósito
([`scheduler-core.ts:238`](../src/lib/scheduler-core.ts#L238)), alguém posta na
mão e marca como publicado. Vale pra sempre, não só agora: Reels com música e
post com parceria paga a API não aceita de jeito nenhum.

## Erros comuns

| Sintoma | Causa |
|---|---|
| `/me/accounts` volta vazio | Conta ainda pessoal, ou não ligada a uma Página |
| `Cannot locate the Instagram Business Account` | `_BUSINESS_ACCOUNT_ID` é o id da Página, não o da conta IG — use o `instagram_business_account.id` que o script imprime |
| `(#10) requires instagram_content_publish` | A permissão não foi marcada no Explorer, ou o app não passou pela App Review pra ela |
| Publica, mas com a marca errada | Token de outra marca no `<PREFIX>` — cada marca tem o seu, não existe fallback |
| Token morre em ~60 dias | Foi usado o token de usuário, não o de Página. Rode o script de novo e use o `access_token` que vem de `/me/accounts` |
