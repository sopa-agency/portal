import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LIMITS, MIN_PITCH, QUESTIONS, labelFor } from "@/lib/app-idea-options";
import { publishToDiscord } from "@/lib/social-publish";
import { sopa } from "@/projects";

// ---------------------------------------------------------------------------
// Endpoint PÚBLICO de escrita do formulário /app-idea. Sem sessão: a página é
// feita pra ser mandada por link pra quem não tem conta no portal. Logo, TODO
// campo é hostil até prova em contrário — tamanho capado, múltipla escolha
// validada contra a lista fechada, honeypot, e um teto por origem.
//
// Tenant-independente (importa o config da sopa direto) porque o link pode ser
// aberto em qualquer host. Liberado no proxy (ver src/proxy.ts).
//
// Grava primeiro, avisa no Discord depois: uma queda do Discord não pode perder
// um pedido, então a notificação falhar ainda devolve ok — mesma ordem do
// /api/sopa/brief.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Teto por origem numa janela — o suficiente pra pessoa reenviar corrigindo,
 *  pouco o bastante pra um script não encher a fila de triagem. */
const MAX_PER_IP = 5;
const WINDOW_MS = 60 * 60 * 1000;

/** Trim + corte duro de campo livre. Não-string vira "". */
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * O IP nunca é guardado cru: um visitante anônimo não pediu pra deixar dado
 * pessoal aqui, e a única coisa que precisamos dele é "já vi essa origem antes?"
 * — pergunta que o hash responde igual. Salgado com SESSION_SECRET porque IPv4
 * tem entropia baixa demais pra um SHA-256 pelado significar alguma coisa.
 */
function hashIp(req: NextRequest): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip")?.trim();
  const salt = process.env.SESSION_SECRET;
  if (!ip || !salt) return null;
  return createHash("sha256").update(`${ip}|${salt}`).digest("hex");
}

type Body = Record<string, unknown> & {
  /** honeypot — ninguém de verdade vê este campo, então preenchido = robô */
  website?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) return NextResponse.json({ ok: false, error: "Payload inválido." }, { status: 400 });

    // Honeypot: finge que deu certo pra o robô não voltar com outro formato.
    if (str(body.website, 200)) return NextResponse.json({ ok: true });

    const name = str(body.name, LIMITS.name);
    const contact = str(body.contact, LIMITS.contact);
    const pitch = str(body.pitch, LIMITS.pitch);
    const successCriteria = str(body.successCriteria, LIMITS.successCriteria);
    const references = str(body.references, LIMITS.references);

    // Múltipla escolha só aceita o que a própria tela oferece. Sem isto, o
    // campo "kind" viraria texto livre com passo extra.
    const choices: Record<string, string> = {};
    for (const q of QUESTIONS) {
      const picked = str(body[q.id], 60);
      if (!q.choices.some((c) => c.value === picked)) {
        return NextResponse.json({ ok: false, error: `Responda: ${q.title}` }, { status: 400 });
      }
      choices[q.id] = picked;
    }

    if (!name || !contact || pitch.length < MIN_PITCH || !successCriteria) {
      return NextResponse.json(
        { ok: false, error: "Faltou nome, contato, o pedido escrito ou o critério de sucesso." },
        { status: 400 },
      );
    }

    const ipHash = hashIp(req);
    if (ipHash) {
      // Falha de leitura aqui NÃO conta como "não tem nada": se o banco não
      // responde, o insert logo abaixo também não vai, e é ele quem devolve o
      // erro. Fechar a porta por uma contagem que não pôde ser feita custaria
      // um pedido real pra impedir um abuso hipotético.
      const recent = await prisma.appIdea
        .count({ where: { ipHash, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } })
        .catch(() => null);
      if (recent !== null && recent >= MAX_PER_IP) {
        return NextResponse.json(
          { ok: false, error: "Você já mandou vários pedidos agora há pouco. Espere uma hora e continue por lá." },
          { status: 429 },
        );
      }
    }

    const idea = await prisma.appIdea.create({
      data: {
        name,
        contact,
        kind: choices.kind,
        audience: choices.audience,
        existing: choices.existing,
        urgency: choices.urgency,
        budget: choices.budget,
        pitch,
        successCriteria,
        references,
        ipHash,
      },
      select: { id: true },
    });

    // Ping best-effort. O pedido já está salvo neste ponto.
    const lines = [
      "**Novo pedido de app** 🛠️",
      `**de:** ${name} — ${contact}`,
      `**o que:** ${labelFor("kind", choices.kind)} · **pra quem:** ${labelFor("audience", choices.audience)}`,
      `**prazo:** ${labelFor("urgency", choices.urgency)} · **orçamento:** ${labelFor("budget", choices.budget)}`,
      "",
      pitch,
      "",
      `**funcionou quando:** ${successCriteria}`,
    ];
    await publishToDiscord(lines.join("\n"), sopa).catch(() => undefined);

    return NextResponse.json({ ok: true, id: idea.id });
  } catch {
    // Nunca vaza o erro interno pra quem chamou anonimamente.
    return NextResponse.json({ ok: false, error: "Falha ao enviar o pedido." }, { status: 500 });
  }
}
