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
      // Default 1MB is too low for image uploads; uploadDraftImage caps at 8MB.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
