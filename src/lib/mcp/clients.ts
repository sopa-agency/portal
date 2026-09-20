// Como cada harness registra o servidor MCP do portal.
//
// Todo cliente precisa dos mesmos três fatos — transporte Streamable HTTP, a URL
// e o cabeçalho Authorization — e cada um pede de um jeito. Os formatos de
// Claude Code, Codex, OpenClaw e Gemini CLI foram conferidos contra o `--help`
// dos próprios CLIs e testados contra o servidor em produção; Cursor, VS Code e
// Claude Desktop seguem a documentação de cada um.
//
// Sem nada de servidor aqui: a aba Settings → API & MCP importa direto.

import type { Lang } from "@/lib/mcp/guide";

type Both = Record<Lang, string>;
export type ConnectBlock = { title?: Both; text: string };
/** `name` é o nome do servidor no cliente: "sopa", ou "sopa-gnars" para um token limitado a um projeto. */
export type ConnectClient = { id: string; label: string; note?: Both; blocks: (origin: string, token: string, name?: string) => ConnectBlock[] };

/** Variável de ambiente para quem lê o token do ambiente em vez do arquivo. */
export const TOKEN_ENV = "SOPA_PORTAL_TOKEN";

const mcpUrl = (origin: string) => `${origin}/api/mcp`;
const json = (v: unknown) => JSON.stringify(v, null, 2);

/** O pedido que serve para qualquer agente: ele mesmo se configura. */
export function selfSetupPrompt(origin: string, token: string, lang: Lang): string {
  const url = mcpUrl(origin);
  return lang === "pt"
    ? `Configure para você um servidor MCP chamado "sopa":
- transporte: Streamable HTTP
- URL: ${url}
- cabeçalho: Authorization: Bearer ${token}

Use o seu próprio mecanismo de configuração de MCP (comando ou arquivo) e me avise se eu preciso te reiniciar. Se você só aceita servidor MCP por stdio, faça a ponte com:
npx -y mcp-remote ${url} --header "Authorization:Bearer ${token}"

Se você não fala MCP, use a API REST com o mesmo cabeçalho: GET ${origin}/api/v1/tools lista as ferramentas com o JSON Schema de cada uma, e POST ${origin}/api/v1/tools/<nome> chama uma, com os argumentos no corpo em JSON. Comece por get_guide.

O token é segredo: não imprima, não faça commit e não mande para nenhum outro lugar.`
    : `Set up an MCP server for yourself named "sopa":
- transport: Streamable HTTP
- URL: ${url}
- header: Authorization: Bearer ${token}

Use your own MCP configuration mechanism (command or file) and tell me if I need to restart you. If you only accept stdio MCP servers, bridge it with:
npx -y mcp-remote ${url} --header "Authorization:Bearer ${token}"

If you do not speak MCP, use the REST API with the same header: GET ${origin}/api/v1/tools lists the tools with each one's JSON Schema, and POST ${origin}/api/v1/tools/<name> calls one, with the arguments as a JSON body. Start with get_guide.

The token is a secret: do not print it, commit it or send it anywhere else.`;
}

export const CLIENTS: ConnectClient[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    blocks: (o, t, n = "sopa") => [{ text: `claude mcp add --transport http ${n} ${mcpUrl(o)} \\\n  --header "Authorization: Bearer ${t}"` }],
  },
  {
    id: "codex",
    label: "Codex",
    note: { pt: "O Codex lê o token de uma variável de ambiente, não do arquivo. Ponha o export no seu ~/.zshrc para valer em todo terminal.", en: "Codex reads the token from an environment variable, not from the file. Put the export in your ~/.zshrc so every terminal has it." },
    blocks: (o, t, n = "sopa") => [
      { text: `export ${TOKEN_ENV}="${t}"\n\ncodex mcp add ${n} --url ${mcpUrl(o)} \\\n  --bearer-token-env-var ${TOKEN_ENV}` },
      { title: { pt: "Ou direto em ~/.codex/config.toml", en: "Or straight into ~/.codex/config.toml" }, text: `[mcp_servers.${n}]\nurl = "${mcpUrl(o)}"\nbearer_token_env_var = "${TOKEN_ENV}"` },
    ],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    note: { pt: "O add testa a conexão antes de gravar. Dois cuidados: (1) no OpenClaw o servidor vale para TODOS os agentes do gateway — para cada agente ter só o seu, gere um token limitado ao projeto dele (Opções), registre com nome próprio (sopa-gnars) e negue os outros em agents.entries.<agente>.tools.deny, com o padrão \"sopa__*\"; (2) se o token estiver no ~/.openclaw/.env como ${VAR}, o gateway só lê o .env ao subir: depois de trocar o token, openclaw daemon restart (o mcp reload não basta).", en: "add probes the connection before saving. Two cautions: (1) in OpenClaw a server is visible to EVERY agent on the gateway — to give each agent only its own, generate a token limited to its project (Options), register it under its own name (sopa-gnars) and deny the others in agents.entries.<agent>.tools.deny with the pattern \"sopa__*\"; (2) if the token lives in ~/.openclaw/.env as ${VAR}, the gateway only reads .env at startup: after changing the token, run openclaw daemon restart (mcp reload is not enough)." },
    blocks: (o, t, n = "sopa") => [{ text: `openclaw mcp add ${n} --url ${mcpUrl(o)} \\\n  --transport streamable-http \\\n  --header "Authorization=Bearer ${t}"\n\nopenclaw mcp reload` }],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    blocks: (o, t, n = "sopa") => [{ text: `gemini mcp add --transport http --scope user ${n} ${mcpUrl(o)} \\\n  -H "Authorization: Bearer ${t}"` }],
  },
  {
    id: "cursor",
    label: "Cursor",
    note: { pt: "Em ~/.cursor/mcp.json (vale para todos os projetos) ou .cursor/mcp.json na pasta do projeto.", en: "In ~/.cursor/mcp.json (every project) or .cursor/mcp.json inside one project." },
    blocks: (o, t, n = "sopa") => [{ text: json({ mcpServers: { [n]: { url: mcpUrl(o), headers: { Authorization: `Bearer ${t}` } } } }) }],
  },
  {
    id: "vscode",
    label: "VS Code",
    note: { pt: "Em .vscode/mcp.json, ou pelo comando \"MCP: Add Server\". Não faça commit desse arquivo com o token dentro.", en: "In .vscode/mcp.json, or through the \"MCP: Add Server\" command. Do not commit this file with the token in it." },
    blocks: (o, t, n = "sopa") => [{ text: json({ servers: { [n]: { type: "http", url: mcpUrl(o), headers: { Authorization: `Bearer ${t}` } } } }) }],
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    note: { pt: "O Claude Desktop só abre servidor MCP por stdio, então a conexão passa pela ponte mcp-remote (precisa de Node). Settings → Developer → Edit Config, e reinicie o app.", en: "Claude Desktop only opens stdio MCP servers, so the connection goes through the mcp-remote bridge (needs Node). Settings → Developer → Edit Config, then restart the app." },
    blocks: (o, t, n = "sopa") => [{ text: json({ mcpServers: { [n]: { command: "npx", args: ["-y", "mcp-remote", mcpUrl(o), "--header", "Authorization:${AUTH_HEADER}"], env: { AUTH_HEADER: `Bearer ${t}` } } } }) }],
  },
];
