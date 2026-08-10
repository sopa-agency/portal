import { NextRequest } from "next/server";
import React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { cookies } from "next/headers";
import { loadFonts, resolveImg } from "@/lib/studio/render-assets.server";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";

export const runtime = "nodejs";

// A dependency-free "quick image" generator (NOT the Reelflip card template):
// a background (image or accent) + a dark scrim + title + caption + accent bar.
// Renders horizontal / vertical / square so a campaign piece gets an on-brand
// image without needing Figma landscape assets.
//
// POST { orientation, title, caption, imageUrl?, accent? } -> image/jpeg

const DIMS: Record<string, { w: number; h: number }> = {
  landscape: { w: 1200, h: 675 },
  portrait: { w: 1080, h: 1350 },
  square: { w: 1080, h: 1080 },
};

const h = React.createElement;

export async function POST(req: NextRequest) {
  try {
    const project = await getActiveProject();
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const body = (await req.json()) as {
      orientation?: string;
      title?: string;
      caption?: string;
      imageUrl?: string;
      accent?: string;
    };
    const { w, h: ht } = DIMS[body.orientation ?? "landscape"] ?? DIMS.landscape;
    const accent = (body.accent || project.theme.accentDark || "#c8ff00").trim();
    const title = (body.title || "").trim();
    const caption = (body.caption || "").trim();

    let bg: string | null = null;
    if (body.imageUrl?.trim()) bg = await resolveImg(body.imageUrl.trim()).catch(() => null);

    const pad = Math.round(w * 0.055);
    const titleSize = Math.round(w * (ht > w ? 0.085 : 0.062));
    const capSize = Math.round(w * 0.03);

    const fonts = await loadFonts();
    const svg = await satori(
      h(
        "div",
        { style: { width: w, height: ht, display: "flex", position: "relative", backgroundColor: bg ? "#000" : "#0c0c0c", fontFamily: "Inter" } },
        bg ? h("img", { src: bg, style: { position: "absolute", top: 0, left: 0, width: w, height: ht, objectFit: "cover" } }) : null,
        h("div", { style: { position: "absolute", top: 0, left: 0, width: w, height: ht, display: "flex", backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.86) 100%)" } }),
        h(
          "div",
          { style: { position: "absolute", left: 0, bottom: 0, width: w, display: "flex", flexDirection: "column", padding: pad, boxSizing: "border-box" } },
          h("div", { style: { width: 84, height: 8, backgroundColor: accent, borderRadius: 4, marginBottom: 20 } }),
          title ? h("div", { style: { fontFamily: "Bazinga", fontSize: titleSize, color: "#fff", lineHeight: 1.02, display: "flex" } }, title) : null,
          caption ? h("div", { style: { fontSize: capSize, color: "#ededed", lineHeight: 1.35, marginTop: 18, maxWidth: Math.round(w * 0.82), display: "flex" } }, caption) : null,
        ),
        h("div", { style: { position: "absolute", top: pad, left: pad, fontSize: Math.round(w * 0.022), fontWeight: 700, color: accent, letterSpacing: 2, display: "flex" } }, project.name.toUpperCase()),
      ),
      { width: w, height: ht, fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })) },
    );

    const png = new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng();
    const jpeg = await sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[studio/quick]", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
}
