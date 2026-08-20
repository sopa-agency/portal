"use server";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects/index";
import { sendProjectEmail } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Send a task-reminder email (pre-filled from a Kanban task). */
export async function sendTaskReminder(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const project = await getActiveProject();
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Unauthorized." };

  const to = input.to.trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "Email inválido." };
  const subject = (input.subject.trim() || "Lembrete de tarefa").slice(0, 200);
  const body = input.body.trim().slice(0, 5000);

  const res = await sendProjectEmail(project, {
    to,
    subject,
    text: body,
    html: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
