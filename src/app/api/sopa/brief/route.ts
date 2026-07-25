import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publishToDiscord } from "@/lib/social-publish";
import { sopa } from "@/projects";

// ---------------------------------------------------------------------------
// PUBLIC write endpoint for the static SOPA site's contact form (site-sopa,
// separate repo). Open to the internet and CORS-open — the site is static, so
// there is no session to gate on. Every field is untrusted: lengths are capped,
// the payload is never echoed back, and a honeypot field drops the obvious bots.
// Tenant-independent (imports the sopa config directly) because the static site
// may hit any host. Whitelisted in the middleware (see src/proxy.ts).
//
// The brief is stored first and pinged to Discord second: a Discord outage must
// never lose a lead, so a failed notification still returns ok.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Trim + hard-cap a free-text field. Returns "" for anything non-string. */
function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Cap a string[] both in length and per-item size, dropping non-strings. */
function strArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map((s) => s.trim().slice(0, maxLen));
}

type Body = {
  name?: unknown;
  contact?: unknown;
  types?: unknown;
  budget?: unknown;
  deadline?: unknown;
  message?: unknown;
  /** honeypot — real people never see this field, so a filled one is a bot */
  website?: unknown;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Payload inválido." }, { status: 400, headers: CORS });
    }

    // Honeypot: pretend it worked so the bot doesn't retry with a new shape.
    if (str(body.website, 200)) {
      return NextResponse.json({ ok: true }, { headers: CORS });
    }

    const name = str(body.name, 120);
    const contact = str(body.contact, 200);
    const message = str(body.message, 4000);
    const types = strArray(body.types, 10, 60);
    const budget = str(body.budget, 60) || null;
    const deadline = str(body.deadline, 60) || null;

    if (!name || !contact || message.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Preencha nome, contato e uma mensagem com pelo menos 10 caracteres." },
        { status: 400, headers: CORS },
      );
    }

    const brief = await prisma.sopaBrief.create({
      data: { name, contact, types, budget, deadline, message },
      select: { id: true, createdAt: true },
    });

    // Best-effort ping. The brief is already safe in the DB at this point.
    const lines = [
      "**Novo brief pelo site** 🍲",
      `**de:** ${name} — ${contact}`,
      types.length ? `**o que é:** ${types.join(", ")}` : null,
      budget || deadline ? `**orçamento:** ${budget ?? "—"} · **prazo:** ${deadline ?? "—"}` : null,
      "",
      message,
    ].filter((l): l is string => l !== null);
    await publishToDiscord(lines.join("\n"), sopa).catch(() => undefined);

    return NextResponse.json({ ok: true, id: brief.id }, { headers: CORS });
  } catch {
    // Never leak the internal error to an anonymous caller.
    return NextResponse.json({ ok: false, error: "Falha ao enviar o brief." }, { status: 500, headers: CORS });
  }
}
