"use server";

import { cookies } from "next/headers";
import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getActiveProject } from "@/projects/index";

// Signed-URL handshake for Zine Studio asset uploads, gated by the zineStudio
// flag (works regardless of Post Creator / lab).
export async function signZineMediaUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    if (!project.zineStudio) return { ok: false, error: "Zine Studio not enabled for this project." };
    const cookieStore = await cookies();
    const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
    if (!session) return { ok: false, error: "Unauthorized." };
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
