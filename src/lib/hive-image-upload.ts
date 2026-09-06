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

export async function uploadImagemHive(
  file: File,
  project: ProjectConfig,
): Promise<ResultadoUpload> {
  const conta = brandEnv(project, "HIVE_POSTING_ACCOUNT") ?? project.hive?.account;
  const chave = brandEnv(project, "HIVE_POSTING_KEY");
  if (!conta || !chave) {
    return { ok: false, error: "HIVE_POSTING_ACCOUNT ou HIVE_POSTING_KEY não configurados." };
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
