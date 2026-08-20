"use server";

import { revalidatePath } from "next/cache";

/**
 * Force-refresh the treasury data: bust the /treasury route's cached fetches so
 * the next render re-pulls live balances/prices (instead of the 5-min cached
 * copy). Works across serverless instances (shared cache), unlike an in-process
 * cache. The fetches still carry the "treasury" tag for future tag-based busts.
 */
export async function refreshTreasury(): Promise<{ ok: true }> {
  revalidatePath("/treasury");
  return { ok: true };
}
