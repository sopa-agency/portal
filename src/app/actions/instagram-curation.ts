"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authorize } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import {
  fetchInstagramCommentThreads,
  replyToInstagramComment,
  setInstagramCommentHidden,
  type IgPostThread,
} from "@/lib/instagram-publish";

async function gate() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const who = await authorize(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!who) return { ok: false as const, error: "Não autorizado." };
  return { ok: true as const, project };
}

export async function listInstagramComments(): Promise<
  { ok: true; threads: IgPostThread[]; project: string; selfUsername: string } | { ok: false; error: string }
> {
  const g = await gate();
  if (!g.ok) return g;
  const res = await fetchInstagramCommentThreads(g.project);
  if (!res.ok) return res;
  return { ok: true, threads: res.threads, project: g.project.name, selfUsername: res.selfUsername };
}

export async function postInstagramReply(
  commentId: string,
  message: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  return replyToInstagramComment(g.project, commentId, message);
}

export async function toggleInstagramCommentHidden(
  commentId: string,
  hidden: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  return setInstagramCommentHidden(g.project, commentId, hidden);
}
