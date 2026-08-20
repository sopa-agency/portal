import { NextRequest } from "next/server";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { cookies } from "next/headers";
import { CardArtwork, spotMapsUrl, spotQrUrl } from "@/components/studio/card-artwork";
import QRCode from "qrcode";
import { ZCard } from "@/lib/studio/schema";
import { migrateSubtitle } from "@/lib/studio/parse-script";
import { CARD_W, CARD_H } from "@/lib/studio/tokens";
import { loadFonts, loadAssets, resolveImg } from "@/lib/studio/render-assets.server";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

export const runtime = "nodejs";

// POST { card: Card } -> image/png 1080x1350. Session-gated (the proxy already
// blocks anonymous traffic; this is defense in depth for direct invocations).
export async function POST(req: NextRequest) {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    const parsed = ZCard.safeParse(body?.card);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "card inválido" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }
    let card = migrateSubtitle(parsed.data);
    const origImg = "imagem" in card ? card.imagem : null;
    if ("imagem" in card && card.imagem) {
      const resolved = await resolveImg(card.imagem);
      // DIAGNOSTIC: if resolved still === the raw http URL, the server couldn't
      // fetch/normalize the image → Satori will render it blank or fail.
      const embedded = !!resolved && resolved.startsWith("data:");
      console.log(
        `[studio/render] tipo=${card.tipo} img=${origImg?.slice(0, 90)} embedded=${embedded}${embedded ? ` bytes≈${Math.round((resolved!.length * 0.75) / 1024)}KB` : " (FELL BACK TO RAW URL)"}`,
      );
      card = { ...card, imagem: resolved };
    }
    const [fonts, assets] = await Promise.all([loadFonts(), loadAssets()]);

    // Spot cards: QR → the spot's skatehive.app page (falls back to Google Maps
    // for legacy cards without a permlink). Replaces the raw location code.
    let renderAssets = assets;
    if (card.tipo === "spot" && (card.spotPermlink || card.spotLocation)) {
      const url =
        card.spotAuthor && card.spotPermlink
          ? spotQrUrl(card.spotAuthor, card.spotPermlink, card.spotLocation)
          : spotMapsUrl(card.spotLocation);
      const spotQr = await QRCode.toDataURL(url, { margin: 1, width: 300 }).catch(() => "");
      if (spotQr) renderAssets = { ...assets, spotQr };
    }

    const svg = await satori(CardArtwork({ card, assets: renderAssets }) as React.ReactElement, {
      width: CARD_W,
      height: CARD_H,
      fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
    });

    const png = new Resvg(svg, { fitTo: { mode: "width", value: CARD_W } }).render().asPng();
    // Output JPEG: Instagram's content-publishing API is happiest with JPEG, and
    // it's much smaller than PNG → Meta ingests the container faster (fewer
    // "Media ID is not available" timeouts).
    const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    console.log(`[studio/render] OK tipo=${card.tipo} jpeg=${Math.round(jpeg.length / 1024)}KB`);
    return new Response(new Uint8Array(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Surfaces the real failure in Vercel runtime logs (the 400 body only
    // reaches the browser console).
    console.error("[studio/render]", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
