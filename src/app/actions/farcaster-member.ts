"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { sponsorConfigured } from "@/lib/farcaster-sponsor";

export type MyFarcaster = {
  sponsorReady: boolean;
  connected: boolean;
  handle: string | null;
  status: string | null;
  username: string | null; // the member's Hive login — they're already on Hive via Keychain
};

export async function getMyFarcaster(): Promise<MyFarcaster> {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  const sponsorReady = sponsorConfigured();
  if (!who) return { sponsorReady, connected: false, handle: null, status: null, username: null };

  const row = await prisma.farcasterMemberSigner.findUnique({ where: { username: who.username } }).catch(() => null);
  return {
    sponsorReady,
    connected: row?.status === "approved",
    handle: row?.handle ?? null,
    status: row?.status ?? null,
    username: who.username,
  };
}

/** Disconnect the member's Farcaster signer. */
export async function disconnectMyFarcaster(): Promise<{ ok: boolean }> {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false };
  await prisma.farcasterMemberSigner
    .update({ where: { username: who.username }, data: { status: "revoked" } })
    .catch(() => {});
  return { ok: true };
}
