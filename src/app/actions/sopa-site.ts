"use server";

import { getActiveProject } from "@/projects/index";

// ---------------------------------------------------------------------------
// SOPA public-site publishing. Triggers the static site's (site-sopa) Vercel
// Deploy Hook so it rebuilds against the latest portal data. SOPA-only; the
// hook URL is a server secret and never reaches the client.
// ---------------------------------------------------------------------------

export async function publishSite(): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getActiveProject();
  if (project.slug !== "sopa") {
    return { ok: false, error: "Publicar site só está disponível no portal da SOPA." };
  }

  const url = process.env.SOPA_SITE_DEPLOY_HOOK_URL;
  if (!url) {
    return { ok: false, error: "Deploy hook não configurado (SOPA_SITE_DEPLOY_HOOK_URL)." };
  }

  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      return { ok: false, error: `Deploy hook retornou ${res.status}.` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao acionar o deploy." };
  }
}
