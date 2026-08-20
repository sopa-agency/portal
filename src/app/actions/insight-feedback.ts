"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { prisma } from "@/lib/prisma";
import {
  feedbackScope,
  getFeedbackNotes,
  type FeedbackKind,
  type FeedbackNote,
} from "@/lib/insight-feedback";

async function authed() {
  const project = await getActiveProject();
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  return session ? { project, username: session.username } : null;
}

export async function listInsightFeedback(
  kind: FeedbackKind,
  key?: string,
): Promise<FeedbackNote[]> {
  const a = await authed();
  if (!a) return [];
  return getFeedbackNotes(feedbackScope(kind, a.project.slug, key));
}

export async function addInsightFeedback(
  kind: FeedbackKind,
  key: string | undefined,
  note: string,
): Promise<{ ok: true; notes: FeedbackNote[] } | { ok: false; error: string }> {
  const a = await authed();
  if (!a) return { ok: false, error: "Unauthorized" };
  const trimmed = note.trim();
  if (!trimmed) return { ok: false, error: "Feedback can't be empty" };
  const scope = feedbackScope(kind, a.project.slug, key);
  await prisma.insightFeedback.create({
    data: { scope, note: trimmed, createdBy: a.username },
  });
  return { ok: true, notes: await getFeedbackNotes(scope) };
}

export async function removeInsightFeedback(
  id: string,
  kind: FeedbackKind,
  key?: string,
): Promise<{ ok: true; notes: FeedbackNote[] } | { ok: false; error: string }> {
  const a = await authed();
  if (!a) return { ok: false, error: "Unauthorized" };
  await prisma.insightFeedback.delete({ where: { id } }).catch(() => null);
  return { ok: true, notes: await getFeedbackNotes(feedbackScope(kind, a.project.slug, key)) };
}
