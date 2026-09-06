import { createHash } from "node:crypto";
import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";

/**
 * Sobe uma imagem para `images.hive.blog`, o mesmo lugar onde o SkateHive
 * publica.
 *
 * Por que aqui e não no Pinata: é de graça, não tem cota nossa para estourar, e
 * é o host que as imagens das campanhas já usam — inclusive as do post da
 * Morpheus. Uma imagem a menos em dois lugares diferentes.
 *
 * **Uma conta só para todo print.** `IMAGE_UPLOAD_HIVE_ACCOUNT` + `_KEY` mandam
 * em qualquer upload, independentemente do projeto do card. Sem isso, um print
 * de bug do Gnars subiria por uma conta e o do SkateHive por outra, e achar uma
 * imagem depois viraria adivinhação. A conta do projeto fica como último
 * recurso, para o caso de a padrão não estar configurada.
 *
 * O protocolo é peculiar e não está documentado em lugar óbvio, então fica
 * escrito: o serviço não usa token. Ele confia numa ASSINATURA da própria
 * imagem, feita com a chave de posting da conta.
 *
 *   1. digest = sha256("ImageSigningChallenge" ++ bytes da imagem)
 *   2. assinatura = posting_key.sign(digest)
 *   3. POST https://images.hive.blog/<conta>/<assinatura>  (multipart, campo "file")
 *
 * O prefixo "ImageSigningChallenge" existe para que essa assinatura NÃO possa
 * ser reaproveitada como assinatura de transação na cadeia — é um domínio
 * separado. Não remova.
 */

const BASE = "https://images.hive.blog";
const DESAFIO = Buffer.from("ImageSigningChallenge");

export type ResultadoUpload = { ok: true; url: string } | { ok: false; error: string };

/**
 * A conta padrão de imagens, e de onde ela vem, em ordem:
 *   1. `IMAGE_UPLOAD_HIVE_ACCOUNT` / `IMAGE_UPLOAD_HIVE_KEY` — a nossa, fixa
 *   2. `HIVE_POSTING_ACCOUNT` / `HIVE_POSTING_KEY` — a global do portal
 *   3. a do projeto do card — último recurso
 *
 * O par tem de vir da MESMA fonte: conta de um lugar e chave de outro é o erro
 * que devolve 400 sem dizer por quê, e custa uma hora para achar.
 */
function credenciais(project: ProjectConfig): { conta: string; chave: string } | null {
  const fontes: [string | undefined, string | undefined][] = [
    [process.env.IMAGE_UPLOAD_HIVE_ACCOUNT, process.env.IMAGE_UPLOAD_HIVE_KEY],
    [process.env.HIVE_POSTING_ACCOUNT, process.env.HIVE_POSTING_KEY],
    [brandEnv(project, "HIVE_POSTING_ACCOUNT") ?? project.hive?.account, brandEnv(project, "HIVE_POSTING_KEY")],
  ];
  for (const [conta, chave] of fontes) {
    const c = conta?.trim(), k = chave?.trim();
    if (c && k) return { conta: c, chave: k };
  }
  // A conta padrão pode vir sozinha e emprestar a chave global — é o caso comum,
  // porque a chave já está no ambiente com o nome antigo.
  const soConta = process.env.IMAGE_UPLOAD_HIVE_ACCOUNT?.trim();
  const chaveGlobal = process.env.HIVE_POSTING_KEY?.trim();
  if (soConta && chaveGlobal) return { conta: soConta, chave: chaveGlobal };
  return null;
}

/**
 * A chave assina mesmo por essa conta?
 *
 * Conta de uma fonte e chave de outra devolvem `400 bad_request` — um erro que
 * não diz nada e custa uma hora. Aqui a pergunta é feita à cadeia antes do
 * upload, e a resposta vira uma frase que aponta o problema.
 *
 * O resultado fica em memória: dentro de uma instância, a mesma dupla não
 * precisa ser conferida duas vezes.
 */
const paresConferidos = new Map<string, boolean>();

async function parConfere(conta: string, chave: string): Promise<boolean | null> {
  let publica: string;
  try {
    const { PrivateKey } = await import("@hiveio/dhive");
    publica = PrivateKey.fromString(chave).createPublic().toString();
  } catch {
    return false;
  }
  const cache = `${conta}:${publica}`;
  if (paresConferidos.has(cache)) return paresConferidos.get(cache)!;

  try {
    const r = await fetch("https://api.hive.blog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[conta]], id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { result?: { posting?: { key_auths?: [string, number][] } }[] };
    const conta0 = j.result?.[0];
    if (!conta0) return false;
    const bate = (conta0.posting?.key_auths ?? []).some(([k]) => k === publica);
    paresConferidos.set(cache, bate);
    return bate;
  } catch {
    // Não conseguir perguntar não é o mesmo que estar errado. Deixa passar e
    // que o próprio upload decida.
    return null;
  }
}

export async function uploadImagemHive(
  file: File,
  project: ProjectConfig,
): Promise<ResultadoUpload> {
  const cred = credenciais(project);
  if (!cred) {
    return { ok: false, error: "Nenhuma conta de imagem configurada (IMAGE_UPLOAD_HIVE_ACCOUNT/_KEY)." };
  }
  const { conta, chave } = cred;

  const confere = await parConfere(conta, chave);
  if (confere === false) {
    return {
      ok: false,
      error: `A chave configurada não assina por @${conta}. Conta e chave vieram de fontes diferentes — confira IMAGE_UPLOAD_HIVE_ACCOUNT e a chave correspondente.`,
    };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(Buffer.concat([DESAFIO, bytes])).digest();

  let assinatura: string;
  try {
    const { PrivateKey } = await import("@hiveio/dhive");
    assinatura = PrivateKey.fromString(chave).sign(digest).toString();
  } catch (e) {
    return { ok: false, error: `Chave de posting inválida: ${e instanceof Error ? e.message : e}` };
  }

  try {
    // Multipart, campo "file". Testado: corpo cru — com ou sem content-type —
    // devolve 400 bad_request. A assinatura é da imagem, não do envelope, então
    // o multipart não interfere no cálculo acima.
    const envelope = new FormData();
    envelope.append("file", new Blob([new Uint8Array(bytes)], { type: file.type || "image/png" }), file.name || "print.png");

    const r = await fetch(`${BASE}/${conta}/${assinatura}`, {
      method: "POST",
      body: envelope,
      signal: AbortSignal.timeout(45_000),
    });
    const texto = await r.text();
    if (!r.ok) return { ok: false, error: `images.hive.blog respondeu ${r.status}: ${texto.slice(0, 200)}` };

    let json: { url?: string; error?: string };
    try {
      json = JSON.parse(texto);
    } catch {
      return { ok: false, error: `Resposta inesperada: ${texto.slice(0, 200)}` };
    }
    if (!json.url) return { ok: false, error: json.error ?? "O serviço não devolveu URL." };
    return { ok: true, url: json.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar a imagem." };
  }
}
