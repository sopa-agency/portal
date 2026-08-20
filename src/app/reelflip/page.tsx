import type { Metadata } from "next";
import Script from "next/script";
import { ReelflipMagazineClient } from "./reelflip-magazine-client";
import { getReelflipMagazine } from "@/lib/reelflip-magazine";

// The public reelflip.com apex magazine. The proxy rewrites the apex "/" to this
// route (cookie stripped, no session gate); it is NOT the shared /home route, so
// the portals' /home stays untouched.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reelflip",
  description:
    "O arquivo do @reelflip em formato de revista interativa. Não é sobre andar de skate. É sobre enxergar como quem anda.",
  openGraph: {
    title: "Reelflip",
    description:
      "O arquivo do @reelflip em formato de revista interativa. Não é sobre andar de skate. É sobre enxergar como quem anda.",
  },
  twitter: { title: "Reelflip" },
};

// GA4 for the PUBLIC site (reelflip.com) — same property as the linktree.
const GA_MEASUREMENT_ID = "G-EB83SJZ8E2";

export default async function ReelflipMagazinePage() {
  const posts = await getReelflipMagazine();
  return (
    <>
      <Script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
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
