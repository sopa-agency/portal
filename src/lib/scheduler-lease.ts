// The scheduler's heartbeat lease, split out from scheduler-core on purpose.
//
// scheduler-core imports the entire publishing pipeline — ffmpeg transcoding
// (child_process), the Instagram/Facebook clients, both tweet action modules.
// Anything that only needs to ASK about the lease shouldn't drag all that into
// its bundle, so the lease lives here with prisma as its only dependency, and
// scheduler-core imports back from this file.
import "server-only";
import { prisma } from "@/lib/prisma";

/** How long the Mac's heartbeat stays valid before Vercel takes over. */
export const MAC_LEASE_GRACE_MS = 6 * 60 * 1000;

/**
 * Can the host that publishes write cross-post results back to the app's queue?
 *
 * The curation UI runs on Vercel; publishing runs on the Mac worker. Different
 * processes, different environments — so the publisher records its own answer on
 * every tick and the UI reads it here.
 *
 * "unknown" is deliberately distinct from "unconfigured": with no recent tick
 * there's nothing to conclude, and warning on a portal whose worker simply isn't
 * running would teach people to dismiss the warning that matters.
 */
export async function crossPostPublisherHealth(
  now: number = Date.now(),
): Promise<"ready" | "unconfigured" | "unknown"> {
  const lease = await prisma.schedulerLease.findUnique({ where: { id: "singleton" } });
  if (!lease?.lastMacTickAt) return "unknown";
  if (now - lease.lastMacTickAt.getTime() > MAC_LEASE_GRACE_MS) return "unknown";
  if (!lease.crossPostReadyAt) return "unconfigured";
  // A ready-stamp older than the heartbeat means the host stopped reporting it.
  return lease.crossPostReadyAt.getTime() >= lease.lastMacTickAt.getTime() - MAC_LEASE_GRACE_MS
    ? "ready"
    : "unconfigured";
}
