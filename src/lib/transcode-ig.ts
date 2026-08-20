import "server-only";
import { spawn } from "node:child_process";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { uploadMediaToPinata } from "@/lib/social-publish";

// Transcode videos to an Instagram-safe MP4 before publishing, so a scheduled
// post never fails on a webm / odd-codec export. Runs wherever ffmpeg exists
// (the Mac PM2 worker); on hosts without ffmpeg (Vercel) it no-ops and returns
// the original URL — the scheduler's retry then lets a Mac tick handle it.

function ffPath(bin: "ffmpeg" | "ffprobe"): string | null {
  for (const p of [`/opt/homebrew/bin/${bin}`, `/usr/local/bin/${bin}`, `/usr/bin/${bin}`]) {
    if (existsSync(p)) return p;
  }
  return null; // not installed here
}

function run(bin: string, args: string[], timeoutMs = 5 * 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args);
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr }); });
  });
}

/** True if the video already meets IG's container/codec/pixel-format requirements. */
function isIgReady(probe: { streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string }[]; format?: { format_name?: string } }): boolean {
  const v = probe.streams?.find((s) => s.codec_type === "video");
  const a = probe.streams?.find((s) => s.codec_type === "audio");
  const fmt = probe.format?.format_name ?? "";
  const containerOk = /mp4|mov|m4a/.test(fmt);
  const videoOk = v?.codec_name === "h264" && (v.pix_fmt === "yuv420p" || v.pix_fmt === "yuvj420p");
  const audioOk = !a || a.codec_name === "aac"; // audio optional (IG allows silent)
  return containerOk && !!videoOk && audioOk;
}

/**
 * Ensure a single video URL is IG-publishable. Downloads it, and if it isn't
 * already H.264/AAC/MP4/yuv420p, transcodes and re-uploads to Pinata. Returns
 * the (possibly new) URL. Never throws — on any problem it returns the original.
 */
export async function ensureInstagramVideo(url: string): Promise<string> {
  const ffmpeg = ffPath("ffmpeg");
  const ffprobe = ffPath("ffprobe");
  if (!ffmpeg || !ffprobe) return url; // no ffmpeg here (e.g. Vercel) → leave as-is

  let dir: string | null = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "portal-skatehive" } });
    if (!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return url;

    dir = await mkdtemp(path.join(os.tmpdir(), "ig-transcode-"));
    const input = path.join(dir, "in");
    const output = path.join(dir, "out.mp4");
    await writeFile(input, buf);

    // Probe — skip transcoding if it's already IG-ready (saves time + a re-upload).
    const probeRes = await run(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", input], 60_000);
    if (probeRes.code === 0) {
      try {
        if (isIgReady(JSON.parse(probeRes.stdout))) return url;
      } catch { /* fall through to transcode */ }
    }

    // Transcode to the IG-safe baseline: H.264 high + yuv420p, AAC, faststart,
    // width capped at 1080, even dimensions, 30fps.
    const t = await run(ffmpeg, [
      "-y", "-i", input,
      "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-vf", "scale='min(1080,iw)':-2,fps=30",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      output,
    ]);
    if (t.code !== 0 || !existsSync(output)) {
      console.error(`[transcode-ig] ffmpeg failed (code ${t.code}) for ${url.slice(0, 80)} :: ${t.stderr.slice(-300)}`);
      return url;
    }

    const outBuf = await readFile(output);
    const file = new File([outBuf], `ig-${Date.now()}.mp4`, { type: "video/mp4" });
    const up = await uploadMediaToPinata(file);
    if (!up.ok) {
      console.error(`[transcode-ig] re-upload failed: ${up.error}`);
      return url;
    }
    console.log(`[transcode-ig] transcoded ${url.slice(0, 60)} → ${Math.round(outBuf.length / 1024)}KB mp4`);
    return up.url;
  } catch (err) {
    console.error("[transcode-ig]", err instanceof Error ? err.message : String(err));
    return url;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Map a post's media URLs, transcoding any videos to IG-safe MP4. */
export async function ensureInstagramMedia(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(async (u) => (await isVideoUrl(u)) ? ensureInstagramVideo(u) : u));
}

async function isVideoUrl(url: string): Promise<boolean> {
  if (/\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|&|$)/i.test(url)) return true;
  if (/\.(jpe?g|png|gif|webp|heic|heif)(\?|#|&|$)/i.test(url)) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    return (res.headers.get("content-type") ?? "").startsWith("video/");
  } catch {
    return false;
  }
}
