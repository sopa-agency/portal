import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "100.101.51.48",
    "192.168.15.5",
    "minivlad",
    "minivlad.local",
    "minivlad.tail83ea3e.ts.net",
    // Wildcard-DNS hosts used to fake per-tenant subdomains over Tailscale
    // (single dev server on :3010 serves all tenants by Host header).
    "*.100.101.51.48.nip.io",
    "*.minivlad.test",
    "*.localhost",
    // Temporary Cloudflare quick tunnels (*.trycloudflare.com) for friend previews.
    "*.trycloudflare.com",
  ],
  experimental: {
    serverActions: {
      // Media uploads prefer the direct browser→Pinata signed-URL path, which
      // never touches this transport. This limit only governs the FALLBACK
      // through-the-server route, sized to carry a 100MB Reels video locally.
      // (On Vercel the platform request cap still applies to the fallback.)
      bodySizeLimit: "110mb",
    },
  },
};

export default nextConfig;
