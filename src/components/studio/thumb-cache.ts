// SkateHive video thumbnail cache — extracted from video-editor.tsx (behavior
// unchanged). Generates a single frame per video on demand (capped to 3 in
// flight), keyed by the immutable IPFS CID so thumbnails survive reloads and
// the proxy path. Callers pass already-proxied (safe) URLs.

const THUMB_STORE_KEY = "studio-video:thumbs:v1";
const THUMB_STORE_MAX = 200;
const thumbCache = new Map<string, string>();

function thumbKey(url: string): string {
  const m = url.match(/\/ipfs\/([\w-]+)/);
  return m ? m[1] : url.replace(/^.*[?&]url=/, "").slice(0, 200);
}

/** Synchronous cache read (null if not generated yet). */
export function getCachedThumb(url: string): string | null {
  return thumbCache.get(thumbKey(url)) ?? null;
}

export function hydrateThumbCache() {
  if (typeof window === "undefined" || thumbCache.size) return;
  try {
    const raw = window.localStorage.getItem(THUMB_STORE_KEY);
    if (!raw) return;
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      thumbCache.set(k, v);
    }
  } catch {
    /* ignore corrupt cache */
  }
}
hydrateThumbCache();

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistThumbCache() {
  if (typeof window === "undefined") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const entries = [...thumbCache.entries()].slice(-THUMB_STORE_MAX);
      window.localStorage.setItem(THUMB_STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      /* quota — fine, memory cache still serves the session */
    }
  }, 800);
}

const thumbQueue: { url: string; resolve: (v: string | null) => void }[] = [];
let thumbWorkers = 0;

/** `url` is the proxied (same-origin) URL; the cache keys by CID. */
export function requestThumb(url: string): Promise<string | null> {
  const cached = thumbCache.get(thumbKey(url));
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    thumbQueue.push({ url, resolve });
    pumpThumbs();
  });
}

function pumpThumbs() {
  while (thumbWorkers < 3 && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    const key = thumbKey(job.url);
    thumbWorkers++;
    void (async () => {
      try {
        const hit = thumbCache.get(key);
        if (hit) {
          job.resolve(hit);
          return;
        }
        const v = document.createElement("video");
        v.crossOrigin = "anonymous";
        v.muted = true;
        v.preload = "metadata"; // only the frame we seek to gets range-fetched
        v.src = job.url;
        await new Promise<void>((res) => {
          v.onloadeddata = () => res();
          v.onerror = () => res();
          setTimeout(res, 8000);
        });
        if (!v.videoWidth) {
          job.resolve(null);
          return;
        }
        v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
        await new Promise<void>((res) => {
          v.onseeked = () => res();
          setTimeout(res, 1500);
        });
        const c = document.createElement("canvas");
        c.width = 112;
        c.height = 64;
        const ctx = c.getContext("2d");
        if (!ctx) {
          job.resolve(null);
          return;
        }
        const vr = v.videoWidth / v.videoHeight;
        const cr = c.width / c.height;
        let dw = c.width, dh = c.height, dx = 0, dy = 0;
        if (vr > cr) { dh = c.height; dw = c.height * vr; dx = (c.width - dw) / 2; }
        else { dw = c.width; dh = c.width / vr; dy = (c.height - dh) / 2; }
        ctx.drawImage(v, dx, dy, dw, dh);
        const dataUrl = c.toDataURL("image/jpeg", 0.6);
        thumbCache.set(key, dataUrl);
        persistThumbCache();
        v.src = "";
        job.resolve(dataUrl);
      } catch {
        job.resolve(null);
      } finally {
        thumbWorkers--;
        pumpThumbs();
      }
    })();
  }
}

/** Eagerly warm thumbnails for a batch of (already-safe) urls (the Sync button). */
export function warmThumbnails(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = urls.length;
  if (total === 0) return Promise.resolve();
  let done = 0;
  return new Promise((resolve) => {
    for (const u of urls) {
      void requestThumb(u).finally(() => {
        done++;
        onProgress?.(done, total);
        if (done === total) resolve();
      });
    }
  });
}
