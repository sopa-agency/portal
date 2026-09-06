import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionTokenFromRequest } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { uploadImageToPinata } from "@/lib/social-publish";

/**
 * Uma imagem sobe, uma URL volta.
 *
 * Existe para o "colar print" da extensão de kanban: um card com a captura da
 * tela vale mais que três parágrafos descrevendo o que estava na tela. O card
 * do GitHub é markdown, então basta a URL.
 *
 * O trabalho pesado já existia em `uploadImageToPinata` (o mesmo caminho que as
 * campanhas usam); aqui só entra a autenticação.
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

  const r = await uploadImageToPinata(file);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, url: r.url });
}
