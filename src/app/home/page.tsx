import type { Metadata } from "next";
import Script from "next/script";
import { ReelflipMagazineClient } from "./reelflip-magazine-client";
import { getReelflipMagazine } from "@/lib/reelflip-magazine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reelflip — a revista",
  description:
    "O arquivo do @reelflip em formato de revista interativa. Não é sobre andar de skate. É sobre enxergar como quem anda.",
};

// GA4 measurement id for the PUBLIC site (reelflip.com). Deliberately loaded
// only on this route — the portals are internal tools and team traffic would
// just pollute the property.
const GA_MEASUREMENT_ID = "G-EB83SJZ8E2";

/**
 * Public homepage served at the apex domain (reelflip.com) — the proxy
 * rewrites "/" there to this route and bypasses the session gate. Everything
 * else on the apex redirects back here; the portals live on the subdomains.
 */
export default async function HomePage() {
  const posts = await getReelflipMagazine();
  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
      <ReelflipMagazineClient posts={posts} />
    </>
  );
}
