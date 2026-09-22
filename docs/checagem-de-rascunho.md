# Checagem de rascunho contra o briefing

O gerador de posts tem regras no prompt ("não invente prêmio, número, data").
Isso orienta o modelo, mas nada conferia o texto que **saiu**. Agora confere.

## O que é

Cada rascunho curto (até 1.800 caracteres: tweet, cast, post) é julgado contra o
briefing da campanha dele, em quatro perguntas pequenas e separadas:

| Pergunta | Tipo | Vira aviso quando |
|----------|------|-------------------|
| Traz número que o briefing não tem? | sim/não | probabilidade > 0,5 |
| Anuncia data ou prazo que o briefing não tem? | sim/não | probabilidade > 0,5 |
| Promete prêmio, airdrop ou retorno que o briefing não tem? | sim/não | probabilidade > 0,5 |
| Quanto soa como hype genérico de cripto? | escala 0–2 | nota > 1,3 |

Quem julga é o modelo Jev, da TypeSafe: ele devolve probabilidades, não texto. O
limiar e o veredito (`ok` ou `review`) são nossos, em código
(`src/lib/draft-check.ts`).

O julgamento chega ao Jev por dois caminhos, nesta ordem (`src/lib/typesafe.ts`):

1. **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`, ou o token OIDC do deploy),
   modelo `typesafe-ai/jev`. Sem chave da TypeSafe no portal, gasto na fatura da
   Vercel, ZDR e "no training" pelo gateway. No SDK a pergunta sim/não se chama
   `boolean`, não `noul`; a tradução fica no cliente.
2. **API direta da TypeSafe** (`TYPESAFE_API_KEY`), a reserva se o gateway falhar
   ou não estiver configurado.

O resultado gravado diz por onde passou (`via`). Os dois caminhos deram o mesmo
veredito e as mesmas probabilidades (±0,04) nos testes.

## Onde roda

- **Lote de tweets** no Campaign Creator: todos os gerados são conferidos na hora.
- **`save_campaign_draft` do MCP**: o rascunho salvo por um agente já volta com o
  veredito, e o `get_campaign` mostra o veredito guardado.
- **Botão "Conferir"** no cabeçalho do documento: para conferir o que já existia
  e para reconferir depois de editar.

Na tela: selo verde "Fiel ao briefing", ou âmbar "Revisar: número · data ·
prêmio · hype" (o hover mostra as probabilidades), e um triângulo na lista
lateral. Texto editado depois da checagem derruba o selo — o resultado guarda o
hash do texto conferido.

## Cuidados

- **Opcional.** Sem nenhuma das duas credenciais no ambiente, nada roda e nada
  quebra: o selo e o botão somem. API fora do ar ou lenta (10 s) = "não conferiu", que não
  é um "ok".
- **O que sai do portal:** só o briefing e o rascunho, que são texto feito para
  ser publicado. Custos, atas, tesouro e o resto do contexto interno não passam
  por aqui.
- **Conferir não é editar:** o resultado é gravado por SQL, sem mexer no
  `updatedAt` do documento.
- **Nada solto depois da resposta:** as checagens do lote rodam em paralelo e são
  esperadas (ver `serverless` no PR #123).

## Um acerto que vale registrar

No primeiro teste em produção o Tweet 7 da campanha da Gnars ("you keep half
the yield") saiu "Revisar: número 82%". O briefing só diz que o rendimento é
dividido entre quem deposita, o rider e o tesouro — a proporção "metade" foi
inventada por quem escreveu o tweet. Era exatamente o tipo de erro que a
checagem existe para pegar.

## Onde mora

- `src/lib/typesafe.ts` — gateway (`experimental_evaluate` do `ai`) com a API direta por `fetch` como reserva
- `src/lib/draft-check.ts` — as perguntas, os limiares, `checkDraft`, `checkAndStore`
- `CampaignDocument.check` (JSONB, criada por SQL) — veredito, avisos,
  probabilidades, modelo, data e hash do texto
- `src/components/campaign-document-panel.tsx` — o selo e o botão
