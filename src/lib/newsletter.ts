import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Newsletter plumbing for campaign email blasts.
//
// Recipients come from the Supabase userbase (emails linked to SkateHive app
// accounts); subscription state lives in OUR Neon db (NewsletterPref) on an
// OPT-OUT model — everyone is in until they click the unsubscribe link.
// ---------------------------------------------------------------------------

/** HMAC token proving an unsubscribe link was minted by us for this email. */
export function unsubscribeToken(email: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not set — cannot mint unsubscribe tokens.");
  return createHmac("sha256", secret)
    .update(`newsletter-unsub:${email.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  try {
    return unsubscribeToken(email) === token.trim();
  } catch {
    return false;
  }
}

/** Public base URL of a project's portal, where /api/newsletter lives. */
export function portalBaseUrl(project: ProjectConfig): string {
  const override = process.env.NEWSLETTER_PUBLIC_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return `https://${project.subdomain ?? project.slug}.reelflip.com`;
}

export function unsubscribeUrl(project: ProjectConfig, email: string): string {
  const e = email.trim().toLowerCase();
  return `${portalBaseUrl(project)}/api/newsletter/unsubscribe?email=${encodeURIComponent(e)}&token=${unsubscribeToken(e)}`;
}

export type BlastRecipient = { email: string; username: string | null };

/**
 * Userbase emails minus explicit unsubscribes, deduped by lowercase email.
 * Throws with a clear message when the userbase isn't configured.
 */
export async function resolveBlastRecipients(): Promise<BlastRecipient[]> {
  const { listUsersWithEmail } = await import("@/app/actions/userbase");
  const result = await listUsersWithEmail();
  if (!result.ok) throw new Error(result.error);

  const seen = new Map<string, BlastRecipient>();
  for (const u of result.users) {
    const email = u.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.set(email, { email, username: u.handle ?? u.displayName ?? null });
  }

  const optedOut = await prisma.newsletterPref.findMany({
    where: { subscribed: false },
    select: { email: true },
  });
  for (const { email } of optedOut) seen.delete(email.toLowerCase());

  return [...seen.values()];
}

/** Footer appended to every blast email, with the personalized opt-out link. */
export function blastFooterHtml(project: ProjectConfig, email: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" ` +
    `style="padding:24px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9ca3af;">` +
    `You're receiving this because your email is linked to your ${project.name} account.<br/>` +
    `<a href="${unsubscribeUrl(project, email)}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>` +
    `</td></tr></table>`
  );
}
