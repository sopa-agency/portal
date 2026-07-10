import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that must NOT be bundled/transformed by Turbopack:
  // - @resvg/resvg-js: native addon (Studio's SVG→PNG renderer).
  // - node-ical: pulls in temporal-polyfill, whose heavy BigInt use breaks when
  //   the bundler transforms it ("h.BigInt is not a function" at build-time page
  //   data collection for /reunioes). Externalizing makes Node require() it at
  //   runtime, where BigInt is a global and works.
  serverExternalPackages: ["@resvg/resvg-js", "node-ical"],
  // The render route reads brand fonts/assets from disk at runtime; file
  // tracing can't see those dynamic paths, so include them explicitly or the
  // Vercel function 500s with ENOENT.
  outputFileTracingIncludes: {
    "/api/studio/render": ["./public/studio/**/*", "./node_modules/@fontsource/inter/files/*"],
    // Briefings read prompts/{agentSlug}.md via a DYNAMIC path, which file
    // tracing can't resolve — bundle the whole dir so the Vercel function
    // doesn't ENOENT (e.g. "Cannot read prompt for secretario").
    "/**": ["./prompts/**/*"],
  },
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
    // The proxy buffers request bodies with a 10MB default cap — bigger bodies
    // are silently TRUNCATED ("Unexpected end of form" in the upload action).
    // Must match the server-action limit below or the fallback upload path
    // breaks for videos.
    proxyClientMaxBodySize: "110mb",
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
