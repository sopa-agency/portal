# Cross-post: o que falta do lado do app (skatehive3.0)

O portal já cura, publica no Instagram e escreve o desfecho de volta na fila.
Faltam duas coisas que só existem no app, e uma delas é a mais importante da
feature inteira.

---

## 1. O aviso no momento do clique — prioridade máxima

Hoje a pessoa marca cross-post e vê o post no Instagram. Com a fila ligada, ela
marca e **não acontece nada visível**, possivelmente por dias.

Do ponto de vista dela isso é indistinguível de bug. Ela vai clicar de novo — e
o índice único parcial vai barrar, porque o primeiro pedido ainda está vivo em
`pending_review`. Uma ação que nunca deu retorno, agora dando erro.

Nenhuma quantidade de trabalho no portal conserta isso: no momento do clique o
portal ainda não sabe que aquele pedido existe.

**O que precisa:** ao enfileirar, confirmar na hora. Um toast já resolve
("seu post foi pra curadoria — a gente te avisa"), mas o ideal é também uma
`userbase_notifications` com `type = 'crosspost_queued'`, pra ficar registrado
junto dos outros avisos.

---

## 2. Os quatro tipos no mapa de tradução

O app traduz no cliente a partir de `type` + `metadata`, usando `title`/`body`
só como fallback. O portal insere estes quatro. Sem cadastrar, o usuário recebe
o texto em inglês independente do idioma dele.

| `type` | quando | campos do `metadata` a usar |
|---|---|---|
| `crosspost_rejected` | curador recusou | `note` — **opcional, pode vir `null`** — o motivo, entre aspas, no idioma em que foi escrito |
| `crosspost_scheduled` | aprovado com data futura (>15 min) | `scheduled_for` — ISO 8601, renderizar no fuso e locale do usuário |
| `crosspost_published` | post entrou no ar | `ig_permalink` — também vai no campo `link` |
| `crosspost_failed` | o portal desistiu de publicar | nenhum; avisar que dá pra pedir de novo |

Todos carregam também `queue_id`, `target` (sempre `"instagram"`) e
`hive_permlink`.

`crosspost_rejected` já estava na spec original — provavelmente já traduz. Os
outros três são novos.

### Sugestão de texto (pt-BR)

- **rejected** — "Seu cross-post não foi selecionado" / «{note}» — **com `note` nulo ou vazio, renderize só o título** (ou "A curadoria não levou esse dessa vez"), nunca aspas vazias. Exigir justificativa se mostrou desnecessário pra curadoria, então recusa sem texto é o caso comum, não a exceção.
- **scheduled** — "Cross-post aprovado" / "Vai ao ar em {scheduled_for}"
- **published** — "Seu cross-post está no ar" / "Toca pra ver no Instagram"
- **failed** — "Não consegui publicar seu cross-post" / "Pode pedir de novo"

### Por que o "publicar agora" não manda `crosspost_scheduled`

Porque o post sai em minutos e o `crosspost_published` chega logo depois, já com
o link. Dois avisos em sequência pela mesma ação é como se ensina alguém a
silenciar notificação. Só agendamento com mais de 15 minutos avisa antes.

---

## Contrato que o portal assume

Escrito a partir da spec original, **nunca verificado contra o schema real**.
Rodar `scripts/crosspost-preflight.cjs` confirma tudo isto antes de ligar.

Na `userbase_crosspost_queue` o portal:

- **lê** todas as colunas
- **escreve** `payload`, `status`, `reviewed_by_handle`, `reviewed_at`,
  `review_note`, `attempts`, `published_at`, `publish_error`, `result`,
  `updated_at`
- **nunca escreve** `status = 'publishing'` — esse valor continua sendo o
  compare-and-swap do app
- transiciona `pending_review → approved` como reserva atômica, e
  `approved → published | failed` quando o post resolve

`reviewed_by_user_id` fica null: o portal não resolve o uuid a partir do handle.
Se importar, o app preenche.

Como PostgREST não tem transação de múltiplos comandos, "muda a linha E avisa o
autor" não é atômico. O portal reconstrói a garantia do lado dele: reserva o
direito de enviar numa tabela própria (com unique), envia, e confirma. Aviso não
confirmado é reenviado por um passe a cada 10 minutos. Consequência prática pro
app: **uma notificação pode chegar atrasada, nunca duplicada.**

## Uma coisa que só o app decide

Se ele continuar enfileirando pedidos de **Farcaster**, essas linhas ficam sem
dono — o portal cura só Instagram e filtra o resto no SQL. Elas parariam em
`pending_review` pra sempre. Ou o app volta a publicar Farcaster na hora, sem
passar pela fila, ou alguém precisa curá-las em algum lugar.
