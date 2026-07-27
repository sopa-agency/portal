import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sopa } from "@/projects";

// ---------------------------------------------------------------------------
// PUBLIC feed da timeline coletiva do site da SOPA (site-sopa, repo separado).
//
// Diferente de /api/sopa/site-data, que é assado no BUILD: o feed muda o dia
// inteiro, então o site busca este endpoint em RUNTIME, paginado por cursor.
// CORS aberto porque o site é estático e não tem sessão pra apresentar.
//
// Só sai daqui o que passou pelos dois filtros: autor no roster do site e post
// não escondido pela moderação (hidden=false).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const MAX_LIMIT = 40;

export type FeedKind = "snap" | "blog" | "cast";
export type FeedMedia = { type: "image" | "video" | "embed"; url: string };

/**
 * O formato do post, que mudaria o peso visual na timeline. Derivado em vez de
 * guardado: no Farcaster tudo é cast; no Hive, o permlink de snap é `snap-…`
 * (convenção do SkateHive) e o resto é blog long-form.
 */
function kindOf(hash: string, platform: string): FeedKind {
  if (platform === "farcaster") return "cast";
  return /\/snap-/.test(hash) ? "snap" : "blog";
}

/**
 * Post do Hive abre no SkateHive, não no peakd — é a casa da comunidade e o
 * player de vídeo de lá entende o conteúdo. O hash já é "hive:autor/permlink",
 * então sai daqui pronto e a UI não precisa parsear URL.
 */
function permalink(hash: string, platform: string, stored: string | null): string | null {
  if (platform !== "hive") return stored;
  const m = /^hive:([^/]+)\/(.+)$/.exec(hash);
  return m ? `https://skatehive.app/post/${m[1]}/${m[2]}` : stored;
}

function parseMedia(raw: string | null): FeedMedia[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((m) => m && typeof m.url === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(sp.get("limit")) || 20));
    const platform = sp.get("platform");
    const author = sp.get("author")?.toLowerCase().replace(/^@/, "");

    // Cursor = postedAt do último item da página anterior (ISO). Descendente,
    // então a próxima página é tudo que for MAIS ANTIGO que ele.
    const rawCursor = sp.get("cursor");
    const cursor = rawCursor ? new Date(rawCursor) : null;
    if (cursor && Number.isNaN(cursor.getTime())) {
      return NextResponse.json({ ok: false, error: "cursor inválido" }, { status: 400, headers: CORS });
    }

    const roster = sopa.allowlist.map((u) => u.toLowerCase());
    const rows = await prisma.farcasterTrailCast.findMany({
      where: {
        hidden: false,
        authorSlug: { in: author && roster.includes(author) ? [author] : roster },
        ...(platform === "hive" || platform === "farcaster" ? { platform } : {}),
        ...(cursor ? { postedAt: { lt: cursor } } : {}),
      },
      orderBy: { postedAt: "desc" },
      // +1 pra saber se existe próxima página sem fazer um count.
      take: limit + 1,
      select: {
        hash: true, platform: true, authorSlug: true, authorHandle: true,
        text: true, url: true, postedAt: true, mediaJson: true,
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = page.map((r) => ({
      id: r.hash,
      kind: kindOf(r.hash, r.platform),
      platform: r.platform === "hive" ? ("hive" as const) : ("farcaster" as const),
      author: r.authorSlug,
      handle: r.authorHandle ?? r.authorSlug,
      text: r.text,
      url: permalink(r.hash, r.platform, r.url),
      postedAt: r.postedAt.toISOString(),
      media: parseMedia(r.mediaJson),
    }));

    return NextResponse.json(
      {
        ok: true,
        items,
        nextCursor: hasMore ? page[page.length - 1].postedAt.toISOString() : null,
      },
      { headers: { ...CORS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Falha ao carregar o feed." }, { status: 500, headers: CORS });
  }
}
