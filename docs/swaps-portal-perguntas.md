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

## 2. Existem redes sociais do swaps.pro?

Procurei em `swaps.pro/llms.txt`, em `llms-full.txt` e na página `/about`:
**nenhum handle publicado** — nem X, nem Discord, nem Telegram, nem Farcaster.

**Por que só ele responde:** ou os canais não existem, ou existem e não estão
publicados. As duas hipóteses produzem a mesma ausência, e só quem opera a marca
sabe distinguir.

## 3. Conta de analytics do site

O bloco `analytics` do portal precisa das credenciais do provedor.

**Por que só ele responde:** é acesso a conta. Nada em código ou on-chain
revela qual provedor é, nem dá a credencial.

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
