import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { CHALLENGE_COOKIE, SESSION_COOKIE, verifyChallenge } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects/index";
import { canonico, identidades } from "@/lib/member-identity";

export const runtime = "nodejs";

/**
 * "Adicionar outra carteira à minha conta."
 *
 * As pessoas têm várias carteiras. Antes, a segunda só entrava se um admin
 * rodasse SQL — o que na prática significava que ela não entrava. Aqui a
 * própria pessoa adiciona, e a prova é a mesma do login: assinar o desafio.
 *
 * ── A ordem das portas ──────────────────────────────────────────────────────
 * sessão → assinatura → dono. Nessa ordem, e por motivos diferentes:
 *
 * 1. SESSÃO primeiro porque isto adiciona uma CREDENCIAL. Sem sessão isto
 *    seria um jeito de qualquer um cadastrar uma carteira em nome de alguém.
 * 2. ASSINATURA depois, porque cadastrar uma carteira que você não controla é
 *    cadastrar uma porta que não é sua — e uma porta cadastrada por engano
 *    continua aberta depois que o engano é esquecido.
 * 3. DONO por último, e só então: se o endereço já é de outra pessoa, isto
 *    recusa. Antes da assinatura, essa checagem viraria um oráculo — daria
 *    para varrer endereços perguntando de quem são, sem provar nada.
 *
 * A carteira nasce `enabled: true` de propósito. O segundo gesto do admin
 * existe para carteira que um admin cadastrou por alguém; aqui quem cadastrou
 * foi a própria pessoa, já autenticada, provando posse da chave. Pedir
 * liberação seria pedir que ela autorize a si mesma.
 */
export async function POST(req: NextRequest) {
  const project = await getActiveProject();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, project);
  if (!session) return NextResponse.json({ error: "Entre primeiro." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { address?: unknown; signature?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!/^0x[0-9a-f]{40}$/.test(address) || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "address e signature são obrigatórios" }, { status: 400 });
  }

  const nonce = await verifyChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!nonce) return NextResponse.json({ error: "Desafio expirado. Recarregue e tente de novo." }, { status: 400 });

  let valida = false;
  try {
    valida = await verifyMessage({ address: address as `0x${string}`, message: nonce, signature: signature as `0x${string}` });
  } catch {
    valida = false;
  }
  if (!valida) return NextResponse.json({ error: "A assinatura não confere com esse endereço." }, { status: 401 });

  const eu = await canonico(session.username);
  const jaExiste = await prisma.walletLogin.findUnique({ where: { address } }).catch(() => null);
  if (jaExiste) {
    // Já é sua (por qualquer um dos seus logins): idempotente, não erro.
    const meus = await identidades(eu);
    if (meus.includes(jaExiste.username.toLowerCase())) {
      if (!jaExiste.enabled) {
        await prisma.walletLogin.update({ where: { address }, data: { enabled: true } }).catch(() => null);
      }
      return NextResponse.json({ ok: true, address, already: true });
    }
    // De outra pessoa: recusa sem dizer de QUEM. O endereço é público, a
    // ligação com um nome não é.
    return NextResponse.json({ error: "Este endereço já está cadastrado em outra conta." }, { status: 409 });
  }

  try {
    await prisma.walletLogin.create({
      data: { address, username: eu, enabled: true, source: "self", addedBy: eu },
    });
  } catch {
    return NextResponse.json({ error: "Não consegui gravar agora. Tente de novo." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, address });
}

/** As carteiras da pessoa logada — para a tela listar o que ela já tem. */
export async function GET(req: NextRequest) {
  const project = await getActiveProject();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, project);
  if (!session) return NextResponse.json({ error: "Entre primeiro." }, { status: 401 });
  const meus = await identidades(session.username);
  const linhas = await prisma.walletLogin
    .findMany({ where: { username: { in: meus } }, select: { address: true, enabled: true, lastLoginAt: true, source: true } })
    .catch(() => null);
  if (!linhas) return NextResponse.json({ error: "Não consegui ler agora." }, { status: 503 });
  return NextResponse.json({ ok: true, wallets: linhas });
}
