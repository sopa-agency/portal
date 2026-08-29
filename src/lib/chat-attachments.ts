import "server-only";

// Anexos do /chat.
//
// O QUE O AGENTE CONSEGUE VER, e por que a divisão é essa:
//
// O gateway aceita `input` como STRING e nada mais — testei mandar o formato
// multimodal (array com input_text/input_image) e ele devolve "Invalid input".
// Então não existe caminho para entregar uma imagem dentro do prompt.
//
// Daí as duas metades:
//
//   1. Arquivo de TEXTO (código, md, csv, json, log…) tem o conteúdo lido aqui
//      e colado no prompt. O agente lê de verdade, sem depender de rede.
//   2. O que não é texto (imagem, PDF, binário) fica guardado e vai como URL.
//      O agente do OpenClaw tem ferramentas e alcança a URL sozinho — o que ele
//      faz com o arquivo depois é capacidade dele, não promessa nossa.
//
// A interface diz qual dos dois aconteceu com cada arquivo. Anexo que o outro
// lado não consegue abrir e ninguém avisa é pior que anexo recusado.

import { randomBytes } from "node:crypto";

/** Teto por arquivo. Acima disso recusamos no upload, com o motivo. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Quantos arquivos por mensagem. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Quanto do texto de UM arquivo entra no prompt.
 *
 * Não é economia de banco — o arquivo inteiro fica guardado. É que o prompt
 * tem um limite prático no agente, e um CSV de 4 MB empurraria a pergunta da
 * pessoa para fora da janela. Cortamos com aviso visível no próprio prompt,
 * para o agente saber que está lendo um pedaço e poder pedir o resto.
 */
export const MAX_TEXT_CHARS_PER_FILE = 60_000;

/** Teto somado de todos os anexos de uma mensagem. */
export const MAX_TEXT_CHARS_TOTAL = 160_000;

const TEXTUAL_MIME =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|x-sh|sql|toml|graphql|x-httpd-php))/i;

const TEXTUAL_EXT =
  /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|ya?ml|toml|ini|env|cfg|conf|log|sql|graphql|html?|xml|svg|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|dockerfile|makefile|gitignore|prisma|lock)$/i;

/** Este arquivo é texto que dá para colar no prompt? */
export function looksTextual(name: string, mimeType: string): boolean {
  if (TEXTUAL_MIME.test(mimeType)) return true;
  if (TEXTUAL_EXT.test(name)) return true;
  // Sem extensão e sem mime útil: nomes conhecidos que são texto puro.
  return /^(dockerfile|makefile|procfile|readme|license)$/i.test(name.trim());
}

/**
 * Bytes que dizem ser texto realmente são texto?
 *
 * Um .csv exportado errado pode vir binário, e um byte nulo no meio derruba a
 * inserção no Postgres (a coluna é text). Melhor descobrir aqui e tratar o
 * arquivo como binário do que quebrar o envio inteiro por causa de um anexo.
 */
export function decodeText(buf: Buffer): string | null {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return null;
  const text = buf.toString("utf8");
  // U+FFFD em excesso = não era UTF-8.
  const bad = (text.slice(0, 4000).match(/�/g) ?? []).length;
  if (bad > 8) return null;
  return text;
}

export function newAttachmentToken(): string {
  return randomBytes(24).toString("base64url");
}

export type PromptAttachment = {
  id: string;
  token: string;
  name: string;
  mimeType: string;
  size: number;
  text: string | null;
};

function fence(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", py: "python", rb: "ruby",
    go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
    c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
    sh: "bash", bash: "bash", zsh: "bash", sql: "sql", json: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown", html: "html",
    css: "css", scss: "scss", xml: "xml", csv: "csv", prisma: "prisma",
  };
  return map[ext] ?? "";
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Monta o bloco de anexos do prompt.
 *
 * O agente recebe o conteúdo do que é texto e a URL do que não é, com o tipo e
 * o tamanho ao lado — assim ele decide se vale buscar antes de gastar uma
 * ferramenta nisso.
 */
export function buildAttachmentBlock(
  attachments: PromptAttachment[],
  origin: string,
): string {
  if (attachments.length === 0) return "";

  const parts: string[] = [];
  let budget = MAX_TEXT_CHARS_TOTAL;

  for (const att of attachments) {
    const head = `${att.name} (${att.mimeType || "tipo desconhecido"}, ${formatBytes(att.size)})`;

    if (att.text !== null) {
      let body = att.text;
      let note = "";
      if (body.length > MAX_TEXT_CHARS_PER_FILE) {
        body = body.slice(0, MAX_TEXT_CHARS_PER_FILE);
        note = `\n[cortado em ${MAX_TEXT_CHARS_PER_FILE} caracteres de ${att.text.length} — peça o resto se precisar]`;
      }
      if (body.length > budget) {
        body = body.slice(0, Math.max(0, budget));
        note = `\n[cortado: o conjunto de anexos passou de ${MAX_TEXT_CHARS_TOTAL} caracteres]`;
      }
      budget -= body.length;
      parts.push(`--- anexo: ${head} ---\n\`\`\`${fence(att.name)}\n${body}\n\`\`\`${note}`);
      continue;
    }

    const url = `${origin}/api/chat/attachment/${att.id}?t=${att.token}`;
    parts.push(
      `--- anexo: ${head} ---\nNão é texto, então não dá para colar aqui. Está em: ${url}\n` +
        `A URL é pública e não expira enquanto a conversa existir — busque se precisar do conteúdo.`,
    );
  }

  return `\n\n[Anexos desta mensagem: ${attachments.length}]\n${parts.join("\n\n")}`;
}
