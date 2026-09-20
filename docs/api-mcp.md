# API & MCP do portal

Cada membro tem um token pessoal em **Settings → API & MCP** e leva o contexto
da SOPA e dos projetos para o próprio agente (Claude Code, Claude Desktop,
Cursor) ou para um script.

## O que o token enxerga

O token é de uma **pessoa**. A cada chamada o acesso é conferido com a mesma
régua do portal (`getAccess`): quem sai do time perde o alcance na hora, sem
ninguém revogar nada. Quem está na SOPA também lê, como `viewer`, os projetos
que o tesouro dela agrega — o portal dela já mostra os três juntos.

Tudo é leitura. A exceção é `ask_agent`, que gasta modelo: exige o escopo
`agents` (só admin marca, ao criar o token) e para em 10 perguntas por dia por
token.

O token é gerado para a pessoa: quem abre a aba sem nenhum já recebe o seu, com
os comandos de conexão preenchidos. Para outro cliente, um clique gera outro;
nome e escopo `agents` ficam em Opções. O banco guarda só o sha256, então o
segredo aparece uma vez, na tela em que nasce. Limite de 10 tokens ativos por
pessoa; token automático que ninguém usou em um dia é revogado na geração
seguinte.

## Endpoints

| O quê | Onde |
|-------|------|
| MCP (Streamable HTTP, JSON, sem estado) | `POST /api/mcp` |
| Lista de ferramentas (REST) | `GET /api/v1/tools` |
| Chamar uma ferramenta (REST) | `POST /api/v1/tools/<nome>` com os argumentos em JSON |

Sempre com `Authorization: Bearer sopa_pat_…`. Funciona em qualquer domínio do
portal (`sopa.sopa.team`, `gnars.sopa.team`…): o projeto vem no argumento
`project`, não do domínio.

```bash
claude mcp add --transport http sopa https://sopa.sopa.team/api/mcp \
  --header "Authorization: Bearer sopa_pat_…"
```

## Como o contexto é organizado

O catálogo tem famílias, na ordem em que fazem sentido para quem chega. A mesma
lista alimenta o guia que o agente lê (`get_guide`) e a aba do portal.

| Família | Ferramentas |
|---------|-------------|
| Começar | `whoami`, `list_projects`, `get_guide` |
| Estado do projeto | `get_overview` (o retrato inteiro em uma chamada), `get_briefing` |
| Trabalho | `get_kanban`, `get_card` (com as notas do time), `my_tasks`, `list_meetings`, `get_meeting` |
| Dinheiro | `get_treasury`, `get_costs`, `get_team` (na SOPA, com os pesos do split) |
| Conteúdo | `list_campaigns`, `get_campaign`, `get_social_metrics` |
| Memória dos agentes | `search`, `list_brain_files`, `read_brain_file` |
| Perguntar ao agente | `ask_agent` (escopo `agents`, 10 por dia) |

Três atalhos evitam dezenas de chamadas:

- `get_overview` devolve board (contagem, os cards mais quentes, os atrasados),
  dinheiro (tesouro, custo mensal, runway), campanhas, última reunião com ata,
  seguidores e a idade do briefing. Cada parte falha sozinha.
- `my_tasks` junta o que está no nome da pessoa em todos os boards (pelo login
  de GitHub cadastrado em Team e pelo dono do card) e os itens de ação das
  reuniões.
- `search` procura um termo em cards, campanhas, briefings e atas, e diz qual
  ferramenta abre cada achado.

O board do GitHub fica 60 s em memória por instância, porque um agente faz
várias chamadas seguidas sobre o mesmo quadro.

## O que a pessoa vê ao conectar

O MCP não tem mensagem de boas-vindas para o usuário. O que existe, e está
ligado:

- **`instructions` na conexão**, montadas por pessoa: o modelo já chega sabendo
  quem está do outro lado, quais projetos ela enxerga e por onde começar. Perguntar
  "o que eu posso pedir sobre a SOPA?" faz o agente chamar `get_guide`.
- **Prompts**, que o cliente mostra como comandos (`/mcp__sopa__comecar` no
  Claude Code, o menu + no Claude Desktop): `comecar`, `resumo_projeto`,
  `minhas_tarefas`, `dinheiro`, `ultima_reuniao`, `rascunho_post`, `semana`.
- **Recursos**: `sopa://guide` e `sopa://project/<slug>`, para anexar com `@`.
- **A aba do portal**, que dá a primeira mensagem para colar, pedidos prontos
  por família, os atalhos e o catálogo.

Exemplos, prompts e famílias moram em `src/lib/mcp/guide.ts`: muda ali, muda nos
três lugares.

## O que fica de fora do brain

`read_brain_file` lê documentos (`.md`, `.mdx`, `.txt`, `.csv`, `.ics`). Ficam
de fora a fiação do próprio agente (`SOUL.md`, `IDENTITY.md`, `USER.md`,
`AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`) e tudo que é config ou
código, que é onde segredo costuma morar. O texto ainda passa por um filtro que
apaga o que tiver cara de credencial.

## Onde mora

- `src/lib/api-tokens.ts` — criar, revogar, conferir o Bearer, teto do agente
- `src/lib/mcp/guide.ts` — famílias, pedidos prontos, prompts e a primeira mensagem
- `src/lib/mcp/tools.ts` — as ferramentas; uma ferramenta nova entra aqui e
  aparece no MCP e no REST de uma vez
- `src/app/api/mcp/route.ts` — o transporte MCP
- `src/app/api/v1/tools/` — o espelho REST
- `src/components/api-access.tsx` — a aba em Settings
- `src/proxy.ts` — `/api/mcp` e `/api/v1` passam pelo porteiro de sessão porque
  se autenticam sozinhas
