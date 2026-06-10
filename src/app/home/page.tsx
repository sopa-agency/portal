import type { Metadata } from "next";
import { HomeClient } from "./home-client";

export const metadata: Metadata = {
  title: "Reelflip",
  description:
    "Não é sobre andar de skate. É sobre enxergar como quem anda. Marca editorial que aplica o olhar do skate à cultura.",
};

/**
 * Public homepage served at the apex domain (reelflip.com) — the proxy
 * rewrites "/" there to this route and bypasses the session gate. Everything
 * else on the apex redirects back here; the portals live on the subdomains.
 */
export default function HomePage() {
  return <HomeClient />;
}
