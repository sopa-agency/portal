import "server-only";
import type { ProjectConfig } from "@/projects/types";
import { brandEnv } from "@/lib/brand-env";
import { prisma } from "@/lib/prisma";

// Resolve a project's Farcaster signer. Priority:
//   1. A DB-stored signer approved via Sign In With Neynar (Settings → Connect).
//   2. The per-project / global NEYNAR_SIGNER_UUID env var (legacy path).
// The DB wins so a portal admin can (re)connect Farcaster without a redeploy.
//
// NOTE: the signer is identity-bearing — brandEnv() already refuses to fall
// back to the global SkateHive signer from another brand, so env resolution
// here is brand-safe. The DB row is scoped by projectSlug, so it's safe too.

export type ResolvedSigner = {
  signerUuid: string;
  /** where it came from — for diagnostics/UI copy */
  source: "db" | "env";
  username?: string | null;
  fid?: number | null;
};

export async function resolveFarcasterSigner(
  project: ProjectConfig | undefined,
): Promise<ResolvedSigner | null> {
  if (project?.slug) {
    const row = await prisma.farcasterSigner
      .findUnique({ where: { projectSlug: project.slug } })
      .catch(() => null);
    if (row && row.status === "approved" && row.signerUuid.trim()) {
      return { signerUuid: row.signerUuid.trim(), source: "db", username: row.username, fid: row.fid };
    }
  }
  const env = brandEnv(project, "NEYNAR_SIGNER_UUID");
  if (env) return { signerUuid: env, source: "env" };
  return null;
}

/** Cheap presence check for the connection status UI (no signer value leaked). */
export async function hasFarcasterSigner(project: ProjectConfig | undefined): Promise<ResolvedSigner["source"] | null> {
  const r = await resolveFarcasterSigner(project);
  return r?.source ?? null;
}
