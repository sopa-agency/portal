import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { uploadImageToPinata } from "@/lib/social-publish";
import { uploadImagemHive } from "@/lib/hive-image-upload";
import { getActiveProject } from "@/projects";

/**
 * Uma imagem sobe, uma URL volta.
 *
 * Existe para o "colar print" da extensão de kanban: um card com a captura da
 * tela vale mais que três parágrafos descrevendo o que estava na tela. O card
 * do GitHub é markdown, então basta a URL.
 *
 * Vai para `images.hive.blog` — o mesmo lugar onde o SkateHive publica e onde as
 * imagens das campanhas já moram. É de graça e não consome cota nossa. O Pinata
 * fica como reserva, para o caso de o projeto ativo não ter chave de posting.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const LIMITE_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = sessionTokenFromRequest(req, cookieStore.get(SESSION_COOKIE)?.value);
  if (!(await verifySession(token))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Envie como multipart/form-data." }, { status: 400 });
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "Nenhuma imagem recebida." }, { status: 400 });
  }
  if (file.size > LIMITE_BYTES) {
    return NextResponse.json({ ok: false, error: "Imagem grande demais (máx. 15 MB)." }, { status: 413 });
  }

  const project = await getActiveProject();

  // Conta e chave podem vir do cliente (os ajustes da extensão). Quando vêm,
  // mandam — é a pessoa dizendo por qual conta ela quer publicar. Nunca são
  // registradas em log: chave de posting em log é chave vazada.
  const contaCliente = String(form.get("hiveAccount") ?? "").trim() || undefined;
  const chaveCliente = String(form.get("hiveKey") ?? "").trim() || undefined;

  const hive = await uploadImagemHive(file, project, { conta: contaCliente, chave: chaveCliente });
  if (hive.ok) return NextResponse.json({ ok: true, url: hive.url, via: "hive" });

  // Reserva: sem chave de posting no projeto ativo, ainda dá para publicar. O
  // motivo da primeira falha vai junto — senão o Pinata acaba mascarando uma
  // chave mal configurada que ninguém vai consertar.
  const pinata = await uploadImageToPinata(file);
  if (pinata.ok) return NextResponse.json({ ok: true, url: pinata.url, via: "pinata", avisoHive: hive.error });

  return NextResponse.json(
    { ok: false, error: `Hive: ${hive.error} · Pinata: ${pinata.error}` },
    { status: 502 },
  );
}
