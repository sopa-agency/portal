import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve o arquivo anexado.
//
// Esta é a ÚNICA rota do chat que não exige sessão, e é de propósito: quem
// busca aqui é o agente, que faz um GET limpo do outro lado do funnel e não
// carrega cookie de ninguém. A credencial é o `?t=` — um token aleatório de 24
// bytes gravado na linha. Sem ele, 404.
//
// 404 e não 403: com 403 a resposta confirma que o id existe, e um id existente
// é meio caminho para adivinhar o resto. Aqui as duas negativas são iguais.

type Ctx = { params: Promise<{ id: string }> };

function tokenMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  // Comprimento diferente já é "não" — timingSafeEqual exige tamanhos iguais.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";

  const att = await prisma.chatAttachment.findUnique({ where: { id } });
  if (!att || !tokenMatches(att.token, token)) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  // Texto foi guardado como texto; o resto, como bytes.
  const body: Buffer | null = att.data
    ? Buffer.from(att.data)
    : att.text !== null
      ? Buffer.from(att.text, "utf8")
      : null;
  if (!body) return NextResponse.json({ ok: false, error: "Empty." }, { status: 404 });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Length": String(body.length),
      // `inline` para imagem abrir na aba; o nome sobrevive ao download.
      "Content-Disposition": `inline; filename="${att.name.replace(/["\\]/g, "")}"`,
      // Privado e sem indexação: a URL é capacidade, não conteúdo público.
      "Cache-Control": "private, max-age=3600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
