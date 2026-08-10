"use server";

// Press Blast — send a campaign's Press Release to a curated list of crypto-media
// contacts (Bankless, BeInCrypto, …). Reuses the per-project SMTP sender; the
// contact list lives in PressContact. Sending is manual + confirm-guarded on the
// UI. Only async functions are exported (this is a "use server" file).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getActiveProject } from "@/projects";
import { isEmailConfigured, sendProjectEmail } from "@/lib/email";

export type PressContactRow = {
  id: string;
  outlet: string;
  email: string;
  status: string;
  sentAt: string | null;
  error: string | null;
};

export type PressBlastState = {
  contacts: PressContactRow[];
  emailConfigured: boolean;
  ownMailbox: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pressToEmail(content: string): { subject: string; html: string; text: string } {
  const trimmed = content.trim();
  const subject = (trimmed.split("\n")[0] || "Press release").trim();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = trimmed.split(/\n\s*\n/);
  const body = paras
    .map((p, i) =>
      i === 0
        ? `<h2 style="font-size:19px;margin:0 0 14px;color:#111">${esc(p.trim())}</h2>`
        : `<p style="margin:0 0 12px">${esc(p.trim()).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:640px">${body}</div>`;
  return { subject, html, text: trimmed };
}

/** Contacts + whether email can send for the active project. */
export async function getPressBlast(campaignId: string): Promise<PressBlastState> {
  const project = await getActiveProject();
  const rows = await prisma.pressContact
    .findMany({ where: { campaignId }, orderBy: { createdAt: "asc" } })
    .catch(() => []);
  const prefix = project.agent?.gatewayEnvPrefix;
  const ownMailbox = !!(prefix && process.env[`${prefix}_EMAIL_USER`] && process.env[`${prefix}_SMTP_HOST`]);
  return {
    contacts: rows.map((r) => ({ id: r.id, outlet: r.outlet, email: r.email, status: r.status, sentAt: r.sentAt?.toISOString() ?? null, error: r.error })),
    emailConfigured: isEmailConfigured(project),
    ownMailbox,
  };
}

export async function addPressContact(
  campaignId: string,
  outlet: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: "Email inválido." };
  try {
    const project = await getActiveProject();
    await prisma.pressContact.upsert({
      where: { campaignId_email: { campaignId, email: e } },
      create: { campaignId, outlet: outlet.trim() || e.split("@")[1], email: e, projectSlug: project.slug },
      update: { outlet: outlet.trim() || undefined },
    });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function removePressContact(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await prisma.pressContact.findUnique({ where: { id }, select: { campaignId: true } });
    await prisma.pressContact.delete({ where: { id } });
    if (c) revalidatePath(`/campaign-creator/${c.campaignId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send the press-release document to the pending contacts (or a single testTo).
 * Marks each contact sent/failed. Confirm-guarded on the UI side.
 */
export async function blastPressRelease(
  campaignId: string,
  documentId: string,
  opts?: { testTo?: string },
): Promise<{ ok: true; sent: number; failed: number } | { ok: false; error: string }> {
  try {
    const project = await getActiveProject();
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { content: true, campaignId: true, campaign: { select: { projectSlug: true } } },
    });
    if (!doc || doc.campaignId !== campaignId) return { ok: false, error: "Documento não encontrado." };
    if (doc.campaign.projectSlug !== project.slug) return { ok: false, error: "Acesso negado." };
    if (!doc.content.trim()) return { ok: false, error: "Press release vazio." };
    if (!isEmailConfigured(project)) return { ok: false, error: "Email não configurado pra esse projeto." };

    const { subject, html, text } = pressToEmail(doc.content);

    // Test send — one email, no status changes.
    if (opts?.testTo) {
      const to = opts.testTo.trim();
      if (!EMAIL_RE.test(to)) return { ok: false, error: "Email de teste inválido." };
      const r = await sendProjectEmail(project, { to, subject: `[TESTE] ${subject}`, html, text });
      return r.ok ? { ok: true, sent: 1, failed: 0 } : { ok: false, error: r.error };
    }

    const pending = await prisma.pressContact.findMany({ where: { campaignId, status: { not: "sent" } } });
    if (!pending.length) return { ok: false, error: "Nenhum contato pendente." };

    let sent = 0;
    let failed = 0;
    for (const c of pending) {
      const r = await sendProjectEmail(project, { to: c.email, subject, html, text });
      if (r.ok) {
        sent++;
        await prisma.pressContact.update({ where: { id: c.id }, data: { status: "sent", sentAt: new Date(), error: null } });
      } else {
        failed++;
        await prisma.pressContact.update({ where: { id: c.id }, data: { status: "failed", error: r.error } });
      }
      await new Promise((res) => setTimeout(res, 400)); // gentle pacing
    }
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, sent, failed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
