// Client-safe media proxy resolver.
//
// The studio + magazine editors load cross-origin IPFS media (video frames,
// cover photos) into a <canvas>; without CORS headers the canvas taints and
// toBlob()/getImageData() throw. Historically we proxied these same-origin
// through Vercel routes (/api/studio/video-proxy, /api/brain/image-proxy),
// which streamed every byte of every video/image through Vercel's bandwidth.
//
// When NEXT_PUBLIC_MEDIA_PROXY_URL is set — the Tailscale Funnel /media mount on
// minivlad (127.0.0.1:18790, the brain-file-server) — media streams from there
// instead, with CORS + Range enabled, so Vercel carries none of those bytes.
// Unset ⇒ the same-origin Vercel routes still work (safe fallback when the Mac
// is offline). Mirrors the NEXT_PUBLIC_PRESENCE_WS_URL no-op pattern.
//
// NOTE: NEXT_PUBLIC_* is inlined at build time, so flipping this env on Vercel
// takes effect on the next deploy.
const BASE = process.env.NEXT_PUBLIC_MEDIA_PROXY_URL?.replace(/\/+$/, "");

// Both editors hit the SAME /media endpoint (it is content-type agnostic); the
// two helpers differ only in their same-origin fallback route.
export function videoProxyUrl(url: string): string {
  if (BASE) return `${BASE}?url=${encodeURIComponent(url)}`;
  return `/api/studio/video-proxy?url=${encodeURIComponent(url)}`;
}

export function imageProxyUrl(url: string): string {
  if (BASE) return `${BASE}?url=${encodeURIComponent(url)}`;
  return `/api/brain/image-proxy?url=${encodeURIComponent(url)}`;
}
