# API & MCP do portal

Cada membro cria um token pessoal em **Settings → API & MCP** e leva o contexto
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

O banco guarda só o sha256 do token. O segredo aparece uma vez, na tela em que
nasce. Limite de 10 tokens ativos por pessoa.

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

## Ferramentas

| Ferramenta | Devolve |
|------------|---------|
| `whoami` | quem é o token, escopos, projetos e papel em cada um |
| `list_projects` | ficha de cada projeto: descrição, repositórios, redes, agente, kanban |
| `get_briefing` | o briefing mais recente do agente do projeto (ou o de uma data) |
| `get_kanban` | colunas com contagem e os cards filtrados por coluna, responsável ou texto |
| `get_card` | um card inteiro, com o corpo |
| `get_treasury` | saldo por carteira, maiores tokens, quando foi lido |
| `get_costs` | a planilha de custos fixos, com o mensal em USD |
| `get_team` | membros e papéis; na SOPA, também os pesos do split em vigor |
| `list_campaigns` / `get_campaign` | campanhas, e o briefing e os textos de uma |
| `list_brain_files` / `read_brain_file` | os documentos do workspace do agente |
| `ask_agent` | pergunta ao agente do projeto (escopo `agents`, 10 por dia) |

## O que fica de fora do brain

`read_brain_file` lê documentos (`.md`, `.mdx`, `.txt`, `.csv`, `.ics`). Ficam
de fora a fiação do próprio agente (`SOUL.md`, `IDENTITY.md`, `USER.md`,
`AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`) e tudo que é config ou
código, que é onde segredo costuma morar. O texto ainda passa por um filtro que
apaga o que tiver cara de credencial.

## Onde mora

- `src/lib/api-tokens.ts` — criar, revogar, conferir o Bearer, teto do agente
- `src/lib/mcp/tools.ts` — as ferramentas; uma ferramenta nova entra aqui e
  aparece no MCP e no REST de uma vez
- `src/app/api/mcp/route.ts` — o transporte MCP
- `src/app/api/v1/tools/` — o espelho REST
- `src/components/api-access.tsx` — a aba em Settings
- `src/proxy.ts` — `/api/mcp` e `/api/v1` passam pelo porteiro de sessão porque
  se autenticam sozinhas
