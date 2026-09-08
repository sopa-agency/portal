// The "We Miss You" win-back email, defined in code instead of drafted by the
// AI. It is short, bilingual (PT first, EN below — we don't know each reader's
// language, see resolveOutreachAudience), has no newsletter hero, and carries
// per-recipient tokens that src/app/actions/outreach.ts fills at send time.
//
// The only campaign-specific content is the "what's changed" list, pulled
// verbatim from the brief (see whatsNewFromBrief). Everything else is fixed so
// the email is the same every month and can be checked once.

import {
  DEFAULT_EMAIL_BRAND,
  newId,
  type EmailBlock,
  type EmailBrand,
  type EmailDocument,
  type EmailSection,
} from "@/lib/campaign-email";
import type { ProjectConfig } from "@/projects/types";

/** Tokens the outreach sender replaces per recipient (also listed in the brief seed). */
export const WE_MISS_YOU_TOKENS = {
  first_name: "{{first_name}}",
  username: "{{username}}",
  last_post_date: "{{last_post_date}}",
  last_post_date_pt: "{{last_post_date_pt}}",
  // Expands to `, "Title",` (title linked to the post) or to "" when the
  // account only ever commented — the sentence must read well either way.
  last_post_link: "{{last_post_link}}",
} as const;

export type WhatsNewItem = { pt: string; en: string };

/** Heading of the brief section the email's list is read from. */
export const WHATS_NEW_HEADING = "What's changed since you were last here";

const PLACEHOLDER_ITEMS: WhatsNewItem[] = [
  { pt: "[[novidade 1 em português]]", en: "[[the same in English]]" },
  { pt: "[[novidade 2 em português]]", en: "[[the same in English]]" },
];

/**
 * Read the "what's changed" bullets from the brief. Each bullet is written as
 * "texto em português / the same in English"; a bullet with no " / " is used
 * in both languages as-is. Bullets still holding [[placeholders]] are kept so
 * they surface in the email (the sender refuses to send while any remain).
 */
export function whatsNewFromBrief(brief: string): WhatsNewItem[] {
  const lines = brief.split("\n");
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.toLowerCase().includes(WHATS_NEW_HEADING.toLowerCase()));
  if (start === -1) return PLACEHOLDER_ITEMS;
  const items: WhatsNewItem[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) break;
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const text = m[1].trim();
    if (!text) continue;
    const [pt, en] = text.split(/\s+\/\s+/, 2);
    items.push({ pt: pt.trim(), en: (en ?? pt).trim() });
  }
  return items.length > 0 ? items : PLACEHOLDER_ITEMS;
}

export function emailBrandFor(project: ProjectConfig): EmailBrand {
  return {
    name: project.name,
    url: project.hive.frontend ?? DEFAULT_EMAIL_BRAND.url,
    accent: project.theme.accentDark,
    accentDark: project.theme.accentLight,
  };
}

const INK = "#0a0a0a";
const BODY = "#404040";
const MUTED = "#737373";

function heading(text: string, level: 1 | 2 | 3 = 1): EmailBlock {
  return { id: newId("h"), type: "heading", level, text, align: "left", color: INK };
}
function text(html: string, color = BODY): EmailBlock {
  return { id: newId("t"), type: "text", html, align: "left", color };
}
function list(items: string[]): EmailBlock {
  return { id: newId("li"), type: "list", ordered: false, items };
}
function button(label: string, href: string, brand: EmailBrand): EmailBlock {
  return { id: newId("btn"), type: "button", label, href, bg: brand.accentDark, color: "#ffffff", align: "left" };
}
function divider(): EmailBlock {
  return { id: newId("div"), type: "divider", color: "#e5e5e5", thickness: 1 };
}
function section(blocks: EmailBlock[]): EmailSection {
  return { id: newId("sec"), background: "#ffffff", paddingY: 28, paddingX: 32, columns: [{ id: newId("col"), blocks }] };
}

export type WeMissYouOptions = {
  whatsNew?: WhatsNewItem[];
  /** Who signs the email — a person, not the brand. Shown as "— {signoff}". */
  signoff?: { name: string; handle: string };
};

/**
 * Build the bilingual win-back email as an editable block document. The
 * sender substitutes the tokens per recipient; the block editor shows them raw.
 */
export function createWeMissYouEmail(brand: EmailBrand, opts: WeMissYouOptions = {}): EmailDocument {
  const items = opts.whatsNew && opts.whatsNew.length > 0 ? opts.whatsNew : PLACEHOLDER_ITEMS;
  const signoff = opts.signoff ?? { name: "Vlad", handle: "xvlad" };
  const signHtml = `— ${signoff.name} ([@${signoff.handle}](${brand.url}/@${signoff.handle})), ${brand.name}`;
  const { first_name, last_post_date, last_post_date_pt, last_post_link } = WE_MISS_YOU_TOKENS;

  const pt = section([
    heading(`E aí, ${first_name}`),
    text(
      `Seu último post na ${brand.name}${last_post_link} foi em ${last_post_date_pt}. A gente reparou que você sumiu. A pista continua aberta.`,
    ),
    heading("O que mudou desde então", 2),
    list(items.map((i) => i.pt)),
    text(
      `Se soltar um clipe nas próximas duas semanas, ele entra na próxima Weekly Stoken e o @skatehive manda um tip de boas-vindas no post. Sem pressão: um clipe de celular já conta.`,
    ),
    button("Postar um clipe", brand.url, brand),
    text(signHtml, MUTED),
    divider(),
  ]);

  const en = section([
    heading(`Hey ${first_name}`),
    text(
      `Your last ${brand.name} post${last_post_link} was on ${last_post_date}. We noticed you've been away. The spot is still open.`,
    ),
    heading("What's changed since", 2),
    list(items.map((i) => i.en)),
    text(
      `Drop a clip in the next two weeks and it goes in the next Weekly Stoken, with a welcome-back tip from @skatehive on the post. No pressure: a phone clip counts.`,
    ),
    button("Post a clip", brand.url, brand),
    text(signHtml, MUTED),
  ]);

  return {
    version: 1,
    subject: `Cadê você, ${first_name}? / Long time, ${first_name}?`,
    preheader: `Seu último post foi em ${last_post_date_pt} · Your last post was on ${last_post_date}`,
    pageBackground: "#f4f4f5",
    contentBackground: "#ffffff",
    contentWidth: 600,
    textColor: "#171717",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sections: [pt, en],
  };
}
