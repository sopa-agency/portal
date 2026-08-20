"use client";

import { signPostMediaUpload } from "@/app/actions/post-creator";

/**
 * Direct browser→Pinata upload: ask the server for a short-lived signed URL,
 * then POST the file straight to Pinata. The media never flows through the
 * Next server, so big videos aren't capped by server-action body limits.
 * Shared by the Post Creator and the Studio video editor (project saves).
 */
export async function uploadMediaDirectClient(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signPostMediaUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata upload HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    // ?filename= keeps the original extension on the CID URL so consumers
    // can tell videos from images.
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
