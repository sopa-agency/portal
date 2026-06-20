// Portals participating in the Farcaster curation trail. Each must have an
// approved Neynar signer (DB FarcasterSigner or ${PREFIX}_NEYNAR_SIGNER_UUID).
// The worker (scripts/farcaster-trail-worker.js) keeps its own copy with fids.
export const TRAIL_SLUGS: readonly string[] = ["skatehive", "gnars", "reelflip"];

export function isTrailParticipant(slug: string): boolean {
  return TRAIL_SLUGS.includes(slug);
}
