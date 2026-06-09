import "server-only";

import type { ProjectConfig } from "@/projects/types";

export type SendEmailOptions = {
  to: string;
  bcc?: string | string[];
  subject: string;
  html: string;
  text: string;
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
export async function sendProjectEmail(
  project: Pick<ProjectConfig, "name" | "agent">,
  { to, bcc, subject, html, text }: SendEmailOptions,
): Promise<SendEmailResult> {
  const prefix = project.agent.gatewayEnvPrefix;

  const host =
    (prefix ? process.env[`${prefix}_SMTP_HOST`] : undefined) ??
    process.env.SMTP_HOST;
  const portRaw =
    (prefix ? process.env[`${prefix}_SMTP_PORT`] : undefined) ??
    process.env.SMTP_PORT ??
    "587";
  const port = parseInt(portRaw, 10);
  const secureRaw =
    (prefix ? process.env[`${prefix}_SMTP_SECURE`] : undefined) ??
    process.env.SMTP_SECURE ??
    "false";
  const secure = secureRaw === "true";
  const user =
    (prefix ? process.env[`${prefix}_EMAIL_USER`] : undefined) ??
    process.env.EMAIL_USER;
  const pass =
    (prefix ? process.env[`${prefix}_EMAIL_PASS`] : undefined) ??
    process.env.EMAIL_PASS;
  const fromEnv =
    (prefix ? process.env[`${prefix}_EMAIL_FROM`] : undefined) ??
    process.env.EMAIL_FROM ??
    user;

  if (!host || !user || !pass) {
    return {
      ok: false,
      error: `Email is not configured for ${project.name} — set ${prefix}_SMTP_HOST / ${prefix}_EMAIL_USER / ${prefix}_EMAIL_PASS.`,
      notConfigured: true,
    };
  }

  // Add a display name prefix to the from address when not already present.
  const from =
    fromEnv?.includes("<")
      ? fromEnv
      : `${project.name} <${fromEnv}>`;

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    await transporter.sendMail({ from, to, bcc, subject, html, text });
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
  const prefix = project.agent.gatewayEnvPrefix;
  const host =
    (prefix ? process.env[`${prefix}_SMTP_HOST`] : undefined) ??
    process.env.SMTP_HOST;
  const user =
    (prefix ? process.env[`${prefix}_EMAIL_USER`] : undefined) ??
    process.env.EMAIL_USER;
  const pass =
    (prefix ? process.env[`${prefix}_EMAIL_PASS`] : undefined) ??
    process.env.EMAIL_PASS;
  return Boolean(host && user && pass);
}
