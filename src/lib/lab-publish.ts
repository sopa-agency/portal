import "server-only";
import type { ProjectConfig } from "@/projects/types";
import {
  HIVE_NODES,
  publishSnapToHive,
  publishCastToFarcaster,
  publishToBinanceSquare,
  publishToDiscord,
  type PublishResult,
} from "@/lib/social-publish";
import { brandEnv, brandEnvByPrefix } from "@/lib/brand-env";

// Centralized per-channel publish for the Lab — used by both publish-now
// (labPublishNow) and the scheduler (publishDueLabPosts). Stateless: each
// channel resolves its own credentials from the project/env.

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "post"
  );
}

// Hive Magazine root post — long-form markdown posted to the community.
async function publishHiveMag(text: string, project: ProjectConfig): Promise<PublishResult> {
  const account = brandEnv(project, "HIVE_POSTING_ACCOUNT");
  const key = brandEnvByPrefix(project.agent.gatewayEnvPrefix, "HIVE_POSTING_KEY");
  const community = project.hive.community;
  if (!account || !key) return { ok: false, error: "Hive posting account/key not set." };
  if (!community) return { ok: false, error: "No Hive community configured." };

  const lines = text.split("\n");
  const titleIdx = lines.findIndex((l) => l.trim());
  const title = (lines[titleIdx] ?? "Post").replace(/^#+\s*/, "").trim().slice(0, 255) || "Post";
  const permlink = `${slugify(title)}-${Date.now().toString(36)}`;

  const { Client, PrivateKey } = await import("@hiveio/dhive");
  const client = new Client(HIVE_NODES);
  const op = [
    "comment",
    {
      parent_author: "",
      parent_permlink: community,
      author: account,
      permlink,
      title,
      body: text,
      json_metadata: JSON.stringify({
        app: `Marketing Portal ${project.name}`,
        format: "markdown",
        tags: [community],
      }),
    },
  ];
  await client.broadcast.sendOperations([op] as never[], PrivateKey.fromString(key));
  const frontend = project.hive.frontend ?? "https://peakd.com";
  return { ok: true, url: `${frontend}/@${account}/${permlink}`, ref: permlink };
}

// Email / newsletter blast — first non-empty line is the subject, rest the body.
async function publishEmailBlast(text: string, project: ProjectConfig): Promise<PublishResult> {
  const { resolveBlastRecipients, blastFooterHtml } = await import("@/lib/newsletter");
  const { sendProjectEmail } = await import("@/lib/email");

  const recipients = await resolveBlastRecipients();
  if (recipients.length === 0) return { ok: false, error: "No subscribed recipients." };

  const lines = text.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim());
  const subject =
    (lines[firstIdx] ?? project.name).replace(/^subject:\s*/i, "").trim().slice(0, 140) || project.name;
  const body = lines.slice(firstIdx + 1).join("\n").trim() || text;

  let sent = 0;
  const failed: string[] = [];
  for (const r of recipients) {
    const inner = body
      .split("\n")
      .map((l) => `<p style="margin:0 0 12px 0">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`)
      .join("");
    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;color:#111;max-width:640px;margin:0 auto;padding:24px">${inner}${blastFooterHtml(project, r.email)}</body></html>`;
    const res = await sendProjectEmail(project, { to: r.email, subject, html, text: body });
    if (res.ok) sent++;
    else failed.push(r.email);
    await new Promise((res2) => setTimeout(res2, 150));
  }
  return sent > 0
    ? { ok: true, ref: `${sent} enviado(s)${failed.length ? `, ${failed.length} falha(s)` : ""}` }
    : { ok: false, error: "All sends failed." };
}

export async function publishLabChannel(
  network: string,
  text: string,
  project: ProjectConfig,
): Promise<PublishResult> {
  switch (network) {
    case "hive":
      return publishSnapToHive(text, project);
    case "farcaster":
      return publishCastToFarcaster(text, project);
    case "binance":
      return publishToBinanceSquare(text, project);
    case "discord":
      return publishToDiscord(text, project);
    case "hive_mag":
      return publishHiveMag(text, project);
    case "email":
      return publishEmailBlast(text, project);
    default:
      return { ok: false, error: `"${network}" não suportado para publicar.` };
  }
}
