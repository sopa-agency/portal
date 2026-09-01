import { NextRequest, NextResponse } from "next/server";
import { verifyMessage } from "viem";
import {
  CHALLENGE_COOKIE,
  SESSION_COOKIE,
  cookieDomainFor,
  SESSION_MAX_AGE,
  signSession,
  verifyChallenge,
} from "@/lib/auth";
import { getAccess } from "@/lib/team-access";
import { prisma } from "@/lib/prisma";
import { resolveHasAvatar } from "@/lib/team-roster";
import { getActiveProject } from "@/projects/index";
import { lookupWalletLogin, markWalletLogin } from "@/lib/wallet-login";

export const runtime = "nodejs";

// Entrar com carteira Ethereum. Mesmo desenho do login por Hive logo ao lado:
// o servidor emite um nonce assinado em cookie, a pessoa assina esse nonce com
// a chave dela, e o servidor confere. O que muda é só a criptografia.
//
// A ORDEM DAS PORTAS IMPORTA, e ela é: assinatura → allowlist → acesso ao
// portal. Conferir a allowlist antes da assinatura transformaria esta rota num
// oráculo: quem quisesse saber se um endereço tem acesso bastaria perguntar,
// sem provar nada. Primeiro prove que a carteira é sua; só então falamos dela.

type Body = { address?: unknown; signature?: unknown };

export async function POST(req: NextRequest) {
  const project = await getActiveProject();
  const body = (await req.json().catch(() => null)) as Body | null;
  const address = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  if (!/^0x[0-9a-f]{40}$/.test(address) || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "address and signature required" }, { status: 400 });
  }

  const nonce = await verifyChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!nonce) {
    return NextResponse.json({ error: "Desafio expirado. Recarregue a página e tente de novo." }, { status: 400 });
  }

  // 1. A assinatura. `verifyMessage` recupera o endereço do EIP-191 e compara —
  //    então assinar o nonce prova posse da chave daquele endereço.
  let valida = false;
  try {
    valida = await verifyMessage({ address: address as `0x${string}`, message: nonce, signature: signature as `0x${string}` });
  } catch {
    valida = false;
  }
  if (!valida) {
    return NextResponse.json({ error: "Assinatura não confere com esse endereço." }, { status: 401 });
  }

  // 2. A allowlist. Ver src/lib/wallet-login.ts para o motivo de ela existir
  //    separada do contato "Wallet" da página Team.
  const achado = await lookupWalletLogin(address);
  if (achado.state === "unread") {
    // Indisponibilidade NÃO vira "você não está na lista". Negar o acesso é
    // certo; dizer o motivo errado, não.
    return NextResponse.json({ error: "Não consegui verificar a lista de acesso agora. Tente de novo." }, { status: 503 });
  }
  if (achado.state === "unknown") {
    return NextResponse.json(
      { error: "Esta carteira não está cadastrada para entrar. Peça a um admin para adicioná-la." },
      { status: 403 },
    );
  }
  if (achado.state === "locked") {
    return NextResponse.json(
      { error: "Esta carteira está cadastrada mas ainda não foi liberada. Peça a um admin para desbloquear." },
      { status: 403 },
    );
  }

  const username = achado.username;

  // 3. E o acesso ao portal, pela MESMA porta do login por Hive. A carteira diz
  //    quem você é; quem decide se você entra neste portal continua sendo o
  //    Team. Sem isto, entrar por carteira seria um atalho por fora da
  //    autorização — a porta dos fundos de sempre.
  const access = await getAccess(username, project);
  if (!access.allowed) {
    return NextResponse.json(
      { error: `@${username} não tem acesso ao portal ${project.name}. Peça a um admin para te adicionar.` },
      { status: 403 },
    );
  }

  await markWalletLogin(address);

  try {
    const hasAvatar = await resolveHasAvatar(username).catch(() => null);
    await prisma.memberActivity.upsert({
      where: { username },
      update: {
        lastLoginAt: new Date(),
        lastLoginProject: project.slug,
        loginCount: { increment: 1 },
        ...(hasAvatar === null ? {} : { hasAvatar }),
      },
      create: {
        username,
        lastLoginAt: new Date(),
        lastLoginProject: project.slug,
        loginCount: 1,
        ...(hasAvatar === null ? {} : { hasAvatar }),
      },
    });
  } catch {
    /* tracking is non-critical */
  }

  const token = await signSession({ username });
  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    ...((d) => (d ? { domain: d } : {}))(cookieDomainFor(req.headers.get("host"))),
  });
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
