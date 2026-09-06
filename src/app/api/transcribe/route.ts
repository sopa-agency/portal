import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";

/**
 * Áudio -> texto, para o ditado da extensão de kanban.
 *
 * Por que isto existe no servidor, e não no navegador: a `SpeechRecognition` do
 * Chrome parece local, mas não é — ela manda o áudio para os servidores do
 * Google e, a partir de uma origem `chrome-extension://`, o serviço recusa a
 * requisição com o erro `network`. Não há como consertar isso no cliente.
 *
 * Então o áudio sobe para cá e vai para a API de transcrição. Isso precisa ser
 * dito em voz alta na interface: o áudio SAI da máquina de quem fala.
 */

export const runtime = "nodejs";
/** Ditar uma tarefa leva segundos; um minuto de folga cobre com sobra. */
export const maxDuration = 60;

const LIMITE_BYTES = 20 * 1024 * 1024;
const MODELO = process.env.TRANSCRIBE_MODEL?.trim() || "whisper-1";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = sessionTokenFromRequest(req, cookieStore.get(SESSION_COOKIE)?.value);
  if (!(await verifySession(token))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const chave = process.env.OPENAI_API_KEY?.trim();
  if (!chave) {
    // Mensagem para humano, não para log: quem vê isso é quem acabou de falar.
    return NextResponse.json(
      { ok: false, error: "Transcrição não está configurada no portal (falta OPENAI_API_KEY)." },
      { status: 503 },
    );
  }

  let entrada: FormData;
  try {
    entrada = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Envie o áudio como multipart/form-data." }, { status: 400 });
  }

  const audio = entrada.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ ok: false, error: "Nenhum áudio recebido." }, { status: 400 });
  }
  if (audio.size > LIMITE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Áudio grande demais. Grave trechos mais curtos." },
      { status: 413 },
    );
  }

  const idioma = String(entrada.get("idioma") ?? "").slice(0, 5);

  const saida = new FormData();
  saida.append("file", audio, audio.name || "ditado.webm");
  saida.append("model", MODELO);
  // Dizer o idioma melhora bastante a transcrição e evita que uma frase curta em
  // português seja lida como outra língua.
  if (idioma) saida.append("language", idioma.split("-")[0]!);

  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${chave}` },
      body: saida,
      signal: AbortSignal.timeout(50_000),
    });
    if (!r.ok) {
      const detalhe = await r.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `A transcrição respondeu ${r.status}.`, detalhe: detalhe.slice(0, 300) },
        { status: 502 },
      );
    }
    const json = (await r.json()) as { text?: string };
    const texto = (json.text ?? "").trim();
    if (!texto) {
      // Silêncio não é erro: a pessoa pode ter gravado sem falar, e dizer isso é
      // mais útil que devolver uma string vazia sem explicação.
      return NextResponse.json({ ok: true, text: "", vazio: true });
    }
    return NextResponse.json({ ok: true, text: texto });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Falha ao transcrever." },
      { status: 502 },
    );
  }
}
