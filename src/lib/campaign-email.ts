// Structured email document used by the campaign email builder.
//
// The document is stored as a JSON string in `CampaignDocument.content`. When
// the content is not parseable, callers should treat it as legacy HTML and
// fall back to a read-only iframe preview / "Rebuild from blocks" flow.

export type Align = "left" | "center" | "right";

export type HeadingBlock = {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  align: Align;
  color: string;
};

export type TextBlock = {
  id: string;
  type: "text";
  html: string;
  align: Align;
  color: string;
};

export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  alt: string;
  align: Align;
  width: number;
  href?: string;
};

export type ButtonBlock = {
  id: string;
  type: "button";
  label: string;
  href: string;
  bg: string;
  color: string;
  align: Align;
};

export type DividerBlock = {
  id: string;
  type: "divider";
  color: string;
  thickness: number;
};

export type SpacerBlock = {
  id: string;
  type: "spacer";
  height: number;
};

export type ListBlock = {
  id: string;
  type: "list";
  ordered: boolean;
  items: string[];
};

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | ListBlock;

export type EmailColumn = {
  id: string;
  blocks: EmailBlock[];
};

export type EmailSection = {
  id: string;
  background: string;
  bannerSrc?: string;
  bannerAlt?: string;
  bannerHref?: string;
  paddingY: number;
  paddingX: number;
  columns: EmailColumn[];
};

export type EmailDocument = {
  version: 1;
  subject: string;
  preheader: string;
  pageBackground: string;
  contentBackground: string;
  contentWidth: number;
  textColor: string;
  fontFamily: string;
  sections: EmailSection[];
};

export type EmailParseResult =
  | { kind: "document"; document: EmailDocument }
  | { kind: "legacy_html"; html: string }
  | { kind: "empty" };

// SkateHive brand palette for email templates (inline hex, not theme tokens —
// email clients require literal colors).
export const SKATEHIVE_ACCENT = "#a3e635"; // lime-400
export const SKATEHIVE_ACCENT_DARK = "#65a30d"; // lime-600
export const SKATEHIVE_INK = "#0a0a0a";
export const SKATEHIVE_HERO_GRADIENT = "linear-gradient(90deg,#0a0a0a,#1f2937)";

export function newId(prefix = "id"): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export function newSection(columnCount = 1): EmailSection {
  return {
    id: newId("sec"),
    background: "#ffffff",
    paddingY: 24,
    paddingX: 24,
    columns: Array.from({ length: Math.min(3, Math.max(1, columnCount)) }, () => newColumn()),
  };
}

export function newColumn(): EmailColumn {
  return { id: newId("col"), blocks: [] };
}

export function newBlock(type: EmailBlock["type"]): EmailBlock {
  switch (type) {
    case "heading":
      return { id: newId("h"), type: "heading", level: 2, text: "New heading", align: "left", color: SKATEHIVE_INK };
    case "text":
      return { id: newId("t"), type: "text", html: "Write something here.", align: "left", color: "#404040" };
    case "image":
      return { id: newId("img"), type: "image", src: "", alt: "", align: "center", width: 100 };
    case "button":
      return { id: newId("btn"), type: "button", label: "Drop in", href: "https://skatehive.app", bg: SKATEHIVE_ACCENT_DARK, color: "#ffffff", align: "center" };
    case "divider":
      return { id: newId("div"), type: "divider", color: "#e5e5e5", thickness: 1 };
    case "spacer":
      return { id: newId("sp"), type: "spacer", height: 24 };
    case "list":
      return { id: newId("li"), type: "list", ordered: false, items: ["First item", "Second item", "Third item"] };
  }
}

export function createEmptyEmail(): EmailDocument {
  const heroSection: EmailSection = {
    id: newId("sec"),
    background: SKATEHIVE_HERO_GRADIENT,
    paddingY: 28,
    paddingX: 32,
    columns: [
      {
        id: newId("col"),
        blocks: [
          { id: newId("h"), type: "heading", level: 3, text: "SKATEHIVE UPDATE", align: "left", color: SKATEHIVE_ACCENT },
        ],
      },
    ],
  };

  const bodySection: EmailSection = {
    id: newId("sec"),
    background: "#ffffff",
    paddingY: 32,
    paddingX: 32,
    columns: [
      {
        id: newId("col"),
        blocks: [
          { id: newId("h"), type: "heading", level: 1, text: "{{first_name}}, your skate clips deserve a home", align: "left", color: SKATEHIVE_INK },
          { id: newId("t"), type: "text", html: "SkateHive is a community-owned skateboarding platform built on Hive. Post clips, get tipped in $HIVE, and connect with skaters worldwide — no algorithm, no ads.", align: "left", color: "#404040" },
          { id: newId("btn"), type: "button", label: "Drop your first clip", href: "https://skatehive.app", bg: SKATEHIVE_ACCENT_DARK, color: "#ffffff", align: "left" },
        ],
      },
    ],
  };

  return {
    version: 1,
    subject: "Your skate clips deserve a home",
    preheader: "Post, earn, repeat — on a platform owned by skaters.",
    pageBackground: "#f4f4f5",
    contentBackground: "#ffffff",
    contentWidth: 640,
    textColor: "#171717",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sections: [heroSection, bodySection],
  };
}

export function parseEmail(content: string | null | undefined): EmailParseResult {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return { kind: "empty" };
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<EmailDocument>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.sections)) {
        return { kind: "document", document: hydrate(parsed as EmailDocument) };
      }
    } catch {
      // fall through to legacy
    }
  }
  return { kind: "legacy_html", html: trimmed };
}

export function serializeEmail(doc: EmailDocument): string {
  return JSON.stringify(doc);
}

function hydrate(doc: EmailDocument): EmailDocument {
  return {
    version: 1,
    subject: doc.subject ?? "",
    preheader: doc.preheader ?? "",
    pageBackground: doc.pageBackground ?? "#f4f4f5",
    contentBackground: doc.contentBackground ?? "#ffffff",
    contentWidth: doc.contentWidth ?? 640,
    textColor: doc.textColor ?? "#171717",
    fontFamily: doc.fontFamily ?? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sections: (doc.sections ?? []).map((s) => ({
      id: s.id ?? newId("sec"),
      background: s.background ?? "#ffffff",
      bannerSrc: s.bannerSrc ?? undefined,
      bannerAlt: s.bannerAlt ?? "",
      bannerHref: s.bannerHref ?? undefined,
      paddingY: s.paddingY ?? 24,
      paddingX: s.paddingX ?? 24,
      columns: (s.columns ?? []).map((c) => ({
        id: c.id ?? newId("col"),
        blocks: (c.blocks ?? []).map((b) => ({ ...b, id: b.id ?? newId("b") })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// HTML render — used for the iframe preview and (eventually) export.
// Email clients want table-based layout + inline styles, so that's what we emit.
// ---------------------------------------------------------------------------

export function renderEmail(doc: EmailDocument): string {
  const sectionsHtml = doc.sections.map((s) => renderSection(s)).join("\n");
  const head = [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />",
    "<title>" + esc(doc.subject) + "</title>",
    "<style>",
    "  body { margin: 0; padding: 0; background: " + doc.pageBackground + "; font-family: " + doc.fontFamily + "; color: " + doc.textColor + "; -webkit-text-size-adjust: 100%; }",
    "  table { border-collapse: collapse; }",
    "  img { border: 0; display: block; max-width: 100%; height: auto; }",
    "  a { color: inherit; }",
    "  p { margin: 0 0 12px 0; }",
    "  ul, ol { margin: 0 0 12px 0; padding-left: 22px; }",
    "  li { margin: 0 0 6px 0; }",
    "  h1, h2, h3 { margin: 0 0 12px 0; line-height: 1.25; }",
    "</style>",
    "</head>",
    "<body>",
  ].join("\n");
  const preheader = '<div style="display:none;font-size:1px;color:' + doc.pageBackground + ';line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">' + esc(doc.preheader) + "</div>";
  const wrapperOpen = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + doc.pageBackground + ';padding:24px 0;"><tr><td align="center"><table role="presentation" width="' + doc.contentWidth + '" cellpadding="0" cellspacing="0" style="width:' + doc.contentWidth + 'px;max-width:100%;background:' + doc.contentBackground + ';border-radius:12px;overflow:hidden;">';
  const wrapperClose = "</table></td></tr></table></body></html>";
  return head + preheader + wrapperOpen + sectionsHtml + wrapperClose;
}

function renderSection(section: EmailSection): string {
  const colCount = section.columns.length;
  const colWidth = colCount > 0 ? Math.floor(100 / colCount) : 100;
  const banner = renderSectionBanner(section);
  const cells = section.columns
    .map((col) => {
      const blocks = col.blocks.map(renderBlock).join("\n");
      return '<td valign="top" width="' + colWidth + '%" style="width:' + colWidth + '%;padding:0 8px;vertical-align:top;">' + blocks + "</td>";
    })
    .join("");
  return '<tr><td style="background:' + section.background + ";padding:" + section.paddingY + "px " + section.paddingX + 'px;">' + banner + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + cells + "</tr></table></td></tr>";
}

function renderSectionBanner(section: EmailSection): string {
  if (!section.bannerSrc) return "";
  const img = '<img src="' + esc(section.bannerSrc) + '" alt="' + esc(section.bannerAlt ?? "") + '" width="100%" style="display:block;width:100%;max-width:100%;height:auto;border-radius:8px;margin:0 0 16px 0;" />';
  if (!section.bannerHref) return img;
  return '<a href="' + esc(section.bannerHref) + '" target="_blank" rel="noopener" style="display:block;text-decoration:none;">' + img + "</a>";
}

function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case "heading": {
      const tag = "h" + block.level;
      const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 14;
      const weight = block.level === 3 ? 700 : 600;
      const tracking = block.level === 3 ? "letter-spacing:0.16em;text-transform:uppercase;" : "";
      return "<" + tag + ' style="margin:0 0 12px 0;font-size:' + size + "px;font-weight:" + weight + ";color:" + block.color + ";text-align:" + block.align + ";" + tracking + '">' + escWithLinks(block.text, block.color) + "</" + tag + ">";
    }
    case "text": {
      const html = escWithLinks(block.html, block.color).replace(/\n/g, "<br />");
      return '<div style="font-size:15px;line-height:1.6;color:' + block.color + ";text-align:" + block.align + ';margin:0 0 12px 0;">' + html + "</div>";
    }
    case "image": {
      if (!block.src) {
        return '<div style="text-align:' + block.align + ';margin:0 0 12px 0;color:#a1a1aa;font-size:12px;font-style:italic;">[empty image]</div>';
      }
      const img = '<img src="' + esc(block.src) + '" alt="' + esc(block.alt) + '" width="' + block.width + '%" style="display:inline-block;max-width:' + block.width + '%;height:auto;border-radius:6px;" />';
      const wrapped = block.href ? '<a href="' + esc(block.href) + '" target="_blank" rel="noopener">' + img + "</a>" : img;
      return '<div style="text-align:' + block.align + ';margin:0 0 12px 0;">' + wrapped + "</div>";
    }
    case "button": {
      return '<div style="text-align:' + block.align + ';margin:8px 0 16px 0;"><a href="' + esc(block.href) + '" style="display:inline-block;background:' + block.bg + ";color:" + block.color + ";text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;\">" + esc(block.label) + "</a></div>";
    }
    case "divider": {
      return '<div style="height:0;border-top:' + block.thickness + "px solid " + block.color + ';margin:16px 0;"></div>';
    }
    case "spacer": {
      return '<div style="height:' + block.height + "px;line-height:" + block.height + 'px;font-size:1px;">&nbsp;</div>';
    }
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((it) => "<li>" + escWithLinks(it, "#404040") + "</li>").join("");
      return "<" + tag + ' style="font-size:15px;line-height:1.6;color:#404040;margin:0 0 12px 0;padding-left:22px;">' + items + "</" + tag + ">";
    }
  }
}

// Email clients want inline-styled anchors with explicit color. The renderer
// escapes everything first, then promotes `[label](url)` markdown to safe
// <a> tags. Only http(s) URLs are allowed; anything else stays plain text.
function escWithLinks(text: string, color: string): string {
  const escaped = esc(text);
  return escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = url.replace(/"/g, "%22");
    return (
      '<a href="' +
      safeUrl +
      '" style="color:' +
      color +
      ';text-decoration:underline;" target="_blank" rel="noopener">' +
      label +
      "</a>"
    );
  });
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
