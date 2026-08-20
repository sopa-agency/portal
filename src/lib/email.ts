import "server-only";

import type { ProjectConfig } from "@/projects/types";

export type SendEmailOptions = {
  to: string;
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Calendar invite (nodemailer icalEvent): method + raw ICS content. */
  icalEvent?: { method: string; content: string };
};

export type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string; notConfigured?: boolean };

/**
 * Shared helper: resolve per-project SMTP credentials and send an email via
 * nodemailer. Falls back to global SMTP_* / EMAIL_* env vars when the
 * project-specific ones aren't set.
 *
 * Returns { ok: false, notConfigured: true } gracefully when the mailbox has
 * not been set up yet (missing host/user/pass) so the UI can show a helpful
 * "not configured" message instead of a crash.
 */
type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string };

/**
 * Resolve a COHERENT SMTP config (host + user + pass from the SAME source) by
 * tier: the project's own (`${PREFIX}_*`) → global (`SMTP_*`/`EMAIL_*`) →
 * SkateHive (`SKATEHIVE_*`). The SkateHive mailbox is the shared fallback so
 * portals without their own SMTP (Gnars/Reelflip) still send.
 */
function resolveSmtp(prefix?: string): SmtpConfig | null {
  const tiers: (string | null)[] = [prefix ?? null, null, "SKATEHIVE"];
  for (const t of tiers) {
    const get = (name: string) => (t ? process.env[`${t}_${name}`] : process.env[name]);
    const host = get("SMTP_HOST");
    const user = get("EMAIL_USER");
    const pass = get("EMAIL_PASS");
    if (host && user && pass) {
      return {
        host,
        port: parseInt(get("SMTP_PORT") ?? "587", 10),
        secure: (get("SMTP_SECURE") ?? "false") === "true",
        user,
        pass,
        from: get("EMAIL_FROM") ?? user,
      };
    }
  }
  return null;
}

export async function sendProjectEmail(
  project: Pick<ProjectConfig, "name" | "agent">,
  { to, bcc, subject, html, text, icalEvent }: SendEmailOptions,
): Promise<SendEmailResult> {
  const prefix = project.agent.gatewayEnvPrefix;
  const smtp = resolveSmtp(prefix);

  if (!smtp) {
    return {
      ok: false,
      error: `Email is not configured — set ${prefix}_SMTP_HOST / ${prefix}_EMAIL_USER / ${prefix}_EMAIL_PASS (or the shared SKATEHIVE_* mailbox).`,
      notConfigured: true,
    };
  }
  const { host, port, secure, user, pass, from: fromEnv } = smtp;

  // Add a display name prefix to the from address when not already present.
  const from = fromEnv.includes("<") ? fromEnv : `${project.name} <${fromEnv}>`;

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    await transporter.sendMail({ from, to, bcc, subject, html, text, ...(icalEvent ? { icalEvent } : {}) });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send email.",
    };
  }
}

/**
 * Check whether SMTP is configured for a project, without exposing any secret
 * values. Returns true only if host + user + pass are all set.
 */
export function isEmailConfigured(
  project: Pick<ProjectConfig, "agent">,
): boolean {
  return resolveSmtp(project.agent.gatewayEnvPrefix) !== null;
}
