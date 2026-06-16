"use server";

import { createPinataSignedUploadUrl } from "@/lib/social-publish";
import { getActiveProject } from "@/projects/index";

// Signed-URL handshake for the Lab composer's media uploads, gated by the `lab`
// flag (so it works regardless of whether the project has Post Creator).
export async function signLabMediaUpload(
  filename: string,
  sizeBytes: number,
  mimeType: string,
): Promise<{ ok: true; url: string; gateway: string } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    if (!project.lab) return { ok: false, error: "Lab is not enabled for this project." };
    return await createPinataSignedUploadUrl(filename, sizeBytes, mimeType);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
