import type { ProjectConfig } from "@/projects/types";

/**
 * Beautiful, inspiring HTML email for the "tasks digest" the team dialog sends a
 * member. NOT a plain list — it's branded with the project assets + accent, the
 * sender/recipient Hive avatars, a starred hero task ("most important"), and a
 * personal note. Built with inline styles + table layout so it survives Gmail,
 * Apple Mail and Outlook. Returns both `html` and a `text` fallback.
 */

export type EmailTask = {
  id: string;
  title: string;
  status: string;
  board?: string;
  priority?: string;
  number?: number;
  /** Absolute link that opens the card in the portal (built by the caller). */
  url?: string;
  /** The single starred "most important" task — rendered as a hero. */
  important?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Hive avatars are reliable absolute PNGs — render in every email client. */
function hiveAvatar(username: string, size: "small" | "medium" = "small"): string {
  return `https://images.hive.blog/u/${encodeURIComponent(username)}/avatar/${size}`;
}

/** Pick black or white text for contrast on a solid accent color. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "").trim();
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (n.length < 6) return "#0a0a0a";
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0a0a0a" : "#ffffff";
}

/** Only raster logos render in email — SVG is stripped by most clients. */
function rasterLogoUrl(origin: string, project: ProjectConfig): string | null {
  const logo = project.theme?.logo;
  if (!logo || !origin) return null;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(logo)) return null;
  return `${origin}${logo}`;
}

function chip(text: string, bg: string, color: string, border: string): string {
  return `<span style="display:inline-block;background:${bg};color:${color};border:1px solid ${border};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;line-height:1.6;margin:0 4px 4px 0;white-space:nowrap;">${esc(text)}</span>`;
}

function taskChips(t: EmailTask): string {
  const out: string[] = [];
  if (t.board) out.push(chip(t.board, "#eef6da", "#3f6212", "#d6e8b0"));
  out.push(chip(t.status, "#f4f4f5", "#52525b", "#e4e4e7"));
  if (t.priority) out.push(chip(t.priority, "#fff7ed", "#9a3412", "#fed7aa"));
  if (t.number) out.push(chip(`#${t.number}`, "#fafafa", "#a1a1aa", "#f0f0f0"));
  return out.join("");
}

export function renderTasksEmail(opts: {
  project: ProjectConfig;
  origin: string;
  senderUsername: string;
  recipientUsername: string;
  intro: string;
  tasks: EmailTask[];
}): { html: string; text: string } {
  const { project, origin, senderUsername, recipientUsername, intro, tasks } = opts;
  const accent = project.theme?.accentDark || "#a3e635";
  const onAccent = readableOn(accent);
  const logo = rasterLogoUrl(origin, project);
  const hero = tasks.find((t) => t.important);
  const others = tasks.filter((t) => t !== hero);
  const introHtml = intro.trim() ? esc(intro.trim()).replace(/\n/g, "<br/>") : "";

  // ── Header band (dark, branded) ─────────────────────────────────────────
  const header = `
    <tr>
      <td style="background:#0b0b0c;padding:26px 32px 22px;border-radius:16px 16px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              ${
                logo
                  ? `<img src="${logo}" alt="${esc(project.name)}" height="30" style="height:30px;display:block;border:0;"/>`
                  : `<span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.02em;">${esc(project.name)}</span>`
              }
            </td>
            <td style="text-align:right;vertical-align:middle;">
              <span style="color:${accent};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Team Brief</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="height:4px;background:${accent};line-height:4px;font-size:0;">&nbsp;</td></tr>`;

  // ── Greeting (recipient avatar) ─────────────────────────────────────────
  const greeting = `
    <tr>
      <td style="padding:30px 32px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;padding-right:14px;">
              <img src="${hiveAvatar(recipientUsername, "medium")}" width="52" height="52" alt="" style="width:52px;height:52px;border-radius:50%;display:block;border:2px solid ${accent};"/>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:22px;font-weight:800;color:#18181b;letter-spacing:-0.02em;">E aí, @${esc(recipientUsername)}! 👋</div>
              <div style="font-size:14px;color:#71717a;margin-top:2px;">Bora fazer acontecer — aqui está o que tá na sua mesa.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  // ── Personal note (the sender's draft) ──────────────────────────────────
  const note = introHtml
    ? `
    <tr>
      <td style="padding:14px 32px 0;">
        <div style="border-left:3px solid ${accent};background:#fafafa;border-radius:0 10px 10px 0;padding:12px 16px;font-size:15px;line-height:1.6;color:#27272a;">${introHtml}</div>
      </td>
    </tr>`
    : "";

  // ── Hero (starred) task ─────────────────────────────────────────────────
  const heroBlock = hero
    ? `
    <tr>
      <td style="padding:24px 32px 4px;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#a16207;margin-bottom:8px;">⭐ Prioridade nº 1</div>
        <div style="border:2px solid ${accent};border-radius:14px;padding:18px 20px;background:linear-gradient(180deg,#fffdf5,#ffffff);">
          <div style="font-size:18px;font-weight:800;color:#18181b;line-height:1.35;letter-spacing:-0.01em;">${esc(hero.title)}</div>
          <div style="margin-top:10px;">${taskChips(hero)}</div>
          ${
            hero.url
              ? `<div style="margin-top:16px;">
                  <a href="${esc(hero.url)}" style="display:inline-block;background:${accent};color:${onAccent};padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Abrir o card →</a>
                </div>`
              : ""
          }
        </div>
      </td>
    </tr>`
    : "";

  // ── Remaining tasks ─────────────────────────────────────────────────────
  const othersRows = others
    .map(
      (t) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
            <div style="font-size:15px;font-weight:600;color:#18181b;line-height:1.4;">
              ${t.url ? `<a href="${esc(t.url)}" style="color:#18181b;text-decoration:none;">${esc(t.title)}</a>` : esc(t.title)}
            </div>
            <div style="margin-top:6px;">${taskChips(t)}</div>
            ${t.url ? `<a href="${esc(t.url)}" style="font-size:13px;color:#3f6212;font-weight:600;text-decoration:none;">Abrir →</a>` : ""}
          </td>
        </tr>`,
    )
    .join("");
  const othersBlock = others.length
    ? `
    <tr>
      <td style="padding:24px 32px 4px;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#a1a1aa;margin-bottom:4px;">${hero ? "Mais na fila" : "Suas tarefas"}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${othersRows}</table>
      </td>
    </tr>`
    : "";

  // ── Signature (sender avatar) + footer ──────────────────────────────────
  const footer = `
    <tr>
      <td style="padding:28px 32px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-top:1px solid #ececec;width:100%;">
          <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td style="vertical-align:middle;padding-right:10px;width:36px;">
              <img src="${hiveAvatar(senderUsername)}" width="34" height="34" alt="" style="width:34px;height:34px;border-radius:50%;display:block;"/>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:14px;font-weight:700;color:#27272a;">@${esc(senderUsername)}</div>
              <div style="font-size:12px;color:#a1a1aa;">via o portal ${esc(project.name)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 28px;">
        <div style="font-size:11px;color:#c4c4c8;text-align:center;">Você recebeu isto porque faz parte do time ${esc(project.name)}. 🚀</div>
      </td>
    </tr>`;

  const html = `<!-- tasks digest -->
<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    ${header}
    ${greeting}
    ${note}
    ${heroBlock}
    ${othersBlock}
    ${footer}
  </table>
</div>`;

  // ── Plain-text fallback ─────────────────────────────────────────────────
  const lines: string[] = [`Oi @${recipientUsername},`];
  if (intro.trim()) lines.push("", intro.trim());
  if (hero) {
    lines.push("", `⭐ PRIORIDADE Nº 1: ${hero.title} — ${hero.status}`);
    if (hero.url) lines.push(`   ${hero.url}`);
  }
  if (others.length) {
    lines.push("", hero ? "Mais na fila:" : "Suas tarefas:");
    others.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title} — ${t.status}`);
      if (t.url) lines.push(`   ${t.url}`);
    });
  }
  lines.push("", `— @${senderUsername} via o portal ${project.name}`);
  const text = lines.join("\n");

  return { html, text };
}
