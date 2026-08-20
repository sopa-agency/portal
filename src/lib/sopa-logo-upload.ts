"use client";

import { signSopaLogoUpload } from "@/app/actions/sopa-boards";

/**
 * Direct browser→Pinata logo upload via the SOPA-scoped signed URL. SOPA has no
 * Post Creator, so the shared post-creator uploader (whose authGate requires it)
 * can't be used here. Shared by the portfolio and the org-chart card dialogs.
 */
export async function uploadSopaLogo(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signSopaLogoUpload(file.name, file.size, file.type);
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
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
