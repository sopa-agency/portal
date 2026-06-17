"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { getDriveFileContent } from "@/lib/google-drive";
import { uploadMediaToPinata } from "@/lib/social-publish";

/**
 * Import a Google Drive image file to Pinata IPFS and return the resulting
 * public URL. This is the bridge that lets the email builder use Drive images
 * in sent emails (which are delivered externally, so the image must be
 * publicly accessible — not just behind the auth-gated Drive proxy).
 *
 * Auth-gated: requires a valid session for the active project.
 * Project-scoped: uses the active project's Drive credentials.
 * Image-only: returns an error for non-image mimeTypes.
 */
export async function importDriveImageToPinata(
  fileId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    // Auth gate — same pattern as other project-scoped actions.
    const cookieStore = await cookies();
    const project = await getActiveProject();
    const session = await verifySession(
      cookieStore.get(SESSION_COOKIE)?.value,
      project,
    );
    if (!session) {
      return { ok: false, error: "Not authenticated." };
    }

    if (!fileId?.trim()) {
      return { ok: false, error: "No file ID provided." };
    }

    // Fetch the file content from Drive (uses project's service account).
    const content = await getDriveFileContent(project, fileId.trim());

    // Error result from getDriveFileContent
    if ("ok" in content && !content.ok) {
      return { ok: false, error: (content as { ok: false; error: string }).error };
    }

    // Must be a binary image.
    if (!("kind" in content) || content.kind !== "binary") {
      return { ok: false, error: "Not an image." };
    }
    if (!content.contentType.startsWith("image/")) {
      return { ok: false, error: "Not an image." };
    }

    // Decode base64 → Buffer → File → upload to Pinata.
    const buffer = Buffer.from(content.base64, "base64");
    // Derive a sensible extension from the content type.
    const ext = content.contentType.split("/")[1]?.split("+")[0] ?? "jpg";
    const fileName = `drive-image-${fileId.slice(0, 8)}.${ext}`;
    const file = new File([buffer], fileName, { type: content.contentType });

    return await uploadMediaToPinata(file);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to import image from Drive.",
    };
  }
}
