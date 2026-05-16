"use server";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  type Align,
  type EmailBlock,
  type EmailColumn,
  type EmailDocument,
  type EmailSection,
  newId,
  serializeEmail,
} from "@/lib/campaign-email";
import { getCampaignTemplate } from "@/lib/campaign-templates";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { prisma } from "@/lib/prisma";

const AI_AGENT_ID = "skatehive-marketing";
const AI_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 4 * 60_000);
const ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");

// Hive snap publishing constants (mirrors repo-to-social.ts).
const HIVE_NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://hive-api.arcange.eu",
];
const HIVE_COMMUNITY_TAG = "hive-173115";
const SNAPS_CONTAINER_AUTHOR = "peak.snaps";

export async function createCampaign(formData: FormData) {
  const templateId = ((formData.get("templateId") as string | null) ?? "").trim();
  const template = templateId ? getCampaignTemplate(templateId) : null;

  const rawName = (formData.get("name") as string | null)?.trim();
  const name = rawName || template?.name || "Untitled campaign";
  const briefContent = template?.briefSeed ?? "";

  const campaign = await prisma.campaign.create({
    data: {
      name,
      documents: { create: { name: "Brief", isMain: true, content: briefContent } },
    },
    select: { id: true },
  });

  revalidatePath("/campaign-creator");
  redirect(`/campaign-creator/${campaign.id}`);
}

export async function renameCampaign(id: string, name: string) {
  const next = name.trim() || "Untitled campaign";
  await prisma.campaign.update({ where: { id }, data: { name: next } });
  revalidatePath("/campaign-creator");
  revalidatePath(`/campaign-creator/${id}`);
}

export async function deleteCampaign(id: string) {
  await prisma.campaign.delete({ where: { id } });
  revalidatePath("/campaign-creator");
}

export async function createDocument(
  campaignId: string,
  name?: string,
): Promise<{ ok: boolean; documentId?: string; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.create({
      data: {
        campaignId,
        name: name?.trim() || "Untitled document",
        content: "",
        isMain: false,
      },
      select: { id: true },
    });
    revalidatePath(`/campaign-creator/${campaignId}`);
    return { ok: true, documentId: doc.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteDocument(
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { campaignId: true, isMain: true },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    if (doc.isMain) return { ok: false, error: "Cannot delete the main brief." };
    await prisma.campaignDocument.delete({ where: { id: documentId } });
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateDocumentContent(documentId: string, content: string) {
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { content },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}

export async function renameDocument(documentId: string, name: string) {
  const next = name.trim() || "Untitled";
  const doc = await prisma.campaignDocument.update({
    where: { id: documentId },
    data: { name: next },
    select: { campaignId: true },
  });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

type GenerateResult = { ok: true } | { ok: false; error: string };

// Match briefings.ts: lazily fill GATEWAY_TOKEN from ~/.openclaw/.env so local
// dev works without manual export.
async function ensureLocalGatewayToken(): Promise<void> {
  if (process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN) return;
  try {
    const raw = await fs.readFile(ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[1];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env.GATEWAY_TOKEN = val;
      return;
    }
  } catch {
    // env file unreadable — caller will surface the proper "token missing" error.
  }
}

export async function generateCampaignBrief(campaignId: string): Promise<GenerateResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { documents: { where: { isMain: true }, take: 1 } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const title = campaign.name.trim();
  if (!title || title.toLowerCase() === "untitled campaign") {
    return { ok: false, error: "Rename the campaign first — the title is what the brief is built from." };
  }

  const prompt = `You are the growth lead at SkateHive — a community-owned skateboarding platform built on Hive where skaters post clips, earn $HIVE, and connect without algorithms or ads. Draft a marketing campaign brief for the campaign titled "${title}".

Write it as a long-form Hive blog post (300-500 words) that is ready to publish to the SkateHive community (tag: hive-173115). Editorial tone — direct, skater-to-skater, no corporate marketing-speak. Make concrete assumptions about goal, audience, offer, and channel mix based on the title; lean into the specifics the title implies.

Use this exact section structure:

# ${title}

(One opening paragraph that hooks the reader and frames the campaign in 2-3 sentences.)

## Goal
One paragraph stating the outcome we want and a measurable target.

## Audience
2-3 sentences naming the specific skater segment, with the wedge that makes them relevant (region, age, content style, board setup, whatever fits).

## The offer
What the user actually gets. Be concrete (amounts in $HIVE/HBD, mechanics, timing, prizes).

## Window
Specific start and end dates (assume the campaign runs ~4 weeks starting roughly 2 weeks from today, 2026-05-16).

## Channels
Ordered list of the channels we'll use, in execution order. Skatehive's stack: Hive snaps (peak.snaps container), Farcaster /skateboard channel as @skatehive, Twitter/X thread, Discord announcement, email newsletter. Note which day each lands.

## Success metric
Primary metric + 1 sentence on why it matters. Add a north-star metric as a follow-up line.

## Risks
2-4 bullets covering realistic failure modes (turnout, judging fairness, payout liquidity, dependencies on partners).

## Next steps
A short bulleted to-do list owners can pick up immediately.

Return ONLY the markdown body starting with the H1 title — no preamble, no code fences, no JSON.`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, AI_AGENT_ID, { timeoutMs: AI_TIMEOUT_MS });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to draft the brief." };
  }

  const body = stripCodeFence(raw).trim();
  if (!body) return { ok: false, error: "AI returned an empty brief." };

  const mainDoc = campaign.documents[0];
  if (mainDoc) {
    await prisma.campaignDocument.update({ where: { id: mainDoc.id }, data: { content: body } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name: "Brief", isMain: true, content: body },
    });
  }

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");
  return { ok: true };
}

export async function generateCampaignArtifacts(campaignId: string): Promise<GenerateResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { documents: true },
  });
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const title = campaign.name.trim();
  const mainDoc = campaign.documents.find((d) => d.isMain);
  const brief = (mainDoc?.content ?? "").trim();
  if (!brief) {
    return { ok: false, error: "Write or generate the brief first — there's nothing for the artifacts to draw from." };
  }

  const prompt = `You are the growth lead at SkateHive — a community-owned skateboarding platform built on Hive. Draft five coordinated campaign artifacts based on the brief below.

Campaign title: "${title}"

Brief:
${brief}

Return a single JSON object with this exact shape, and NOTHING else (no prose, no code fences):

{
  "hive_snap": "...",
  "farcaster": "...",
  "tweets": ["...", "..."],
  "discord": "...",
  "email": {
    "subject": "...",
    "preheader": "...",
    "sections": [
      {
        "background": "linear-gradient(90deg,#0a0a0a,#1f2937)",
        "paddingY": 28,
        "paddingX": 32,
        "columns": [
          { "blocks": [ { "type": "heading", "level": 3, "text": "SKATEHIVE UPDATE", "align": "left", "color": "#a3e635" } ] }
        ]
      },
      {
        "background": "#ffffff",
        "paddingY": 32,
        "paddingX": 32,
        "columns": [
          { "blocks": [ /* see block shapes below */ ] }
        ]
      }
    ]
  }
}

Rules:
- "hive_snap": a single Hive snap (short post) that will be published as a comment under peak.snaps' daily container on hive-173115. Plain text, real line breaks, under 280 characters when possible. Skater voice. Mention the relevant link (https://skatehive.app/...). No hashtags in front — SkateHive frontends pick those up from json_metadata.
- "farcaster": a single Farcaster cast for the /skateboard channel as @skatehive. Under 320 characters. Plain text. One short hook + the link. Emojis are fine when they fit the skate vibe (🛹).
- "tweets": an array of 3-5 tweet strings posted from @skatehive. The first opens the thread with a hook + payoff and ends with a downward arrow. Each subsequent tweet stands on its own. Plain text, real line breaks. Keep each under 280 characters. Don't number them ("1/", "2/") — the UI handles that. Skater tone.
- "discord": a single message for the SkateHive Discord #announcements channel. Start with @everyone or @community if appropriate. Discord markdown (**bold**, bullet lists). Include the relevant link(s). More casual than the tweets.
- "email": a structured email document. Use SkateHive accent colors (lime #a3e635 against #0a0a0a black/ink). Reproduce the layout pattern from the example above: a dark hero section with an eyebrow heading ("SKATEHIVE UPDATE") in lime, then a body section with 2-3 short "text" paragraphs, a "button" block (label like "Drop in", href like https://skatehive.app), a "list" block (ordered "How it works" steps), and a small "text" footer with an unsubscribe note. Use {{first_name}} in the H1 if personalization helps. DO NOT include any "image" blocks — the user will drag their own art in.

Allowed block shapes (omit id — the server assigns them):
- heading: { "type": "heading", "level": 1|2|3, "text": "...", "align": "left|center|right", "color": "#hex" }
- text:    { "type": "text",    "html": "plain text — newlines allowed", "align": "left|center|right", "color": "#hex" }
- button:  { "type": "button",  "label": "...", "href": "https://...", "bg": "#hex", "color": "#hex", "align": "left|center|right" }
- divider: { "type": "divider", "color": "#hex", "thickness": 1 }
- spacer:  { "type": "spacer",  "height": 24 }
- list:    { "type": "list",    "ordered": true|false, "items": ["...", "..."] }

The JSON must be valid — escape newlines inside strings as \\n, escape quotes as \\". Begin your reply with "{" and end with "}".`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, AI_AGENT_ID, { timeoutMs: AI_TIMEOUT_MS });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to draft the artifacts." };
  }

  const parsed = extractArtifactsJson(raw);
  if (!parsed) return { ok: false, error: "AI did not return valid JSON. Try again." };

  const tweetsContent = parsed.tweets.map((t) => t.trim()).filter(Boolean).join("\n---\n");
  const emailDocument = normalizeAiEmail(parsed.email);
  const emailContent = serializeEmail(emailDocument);

  await upsertNamedDocument(campaignId, "Hive snap", parsed.hive_snap.trim());
  await upsertNamedDocument(campaignId, "Farcaster cast", parsed.farcaster.trim());
  await upsertNamedDocument(campaignId, "Twitter thread", tweetsContent);
  await upsertNamedDocument(campaignId, "Discord announcement", parsed.discord.trim());
  await upsertNamedDocument(campaignId, "Email", emailContent);

  revalidatePath(`/campaign-creator/${campaignId}`);
  revalidatePath("/campaign-creator");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rebuild a legacy raw-HTML email into structured blocks via the AI.
// ---------------------------------------------------------------------------

export async function rebuildEmailFromHtml(
  documentId: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const doc = await prisma.campaignDocument.findUnique({
    where: { id: documentId },
    select: { id: true, content: true, campaignId: true },
  });
  if (!doc) return { ok: false, error: "Email document not found." };

  const html = (doc.content ?? "").trim();
  if (!html || html.startsWith("{")) {
    return { ok: false, error: "Nothing to rebuild — this email is already structured (or empty)." };
  }

  const prompt = `Convert the following HTML email into the structured SkateHive email-blocks JSON shape.

Return ONLY a JSON object matching this shape, no prose or code fences:

{
  "subject": "...",
  "preheader": "...",
  "sections": [
    { "background": "#hex or gradient", "paddingY": 24, "paddingX": 24, "columns": [
      { "blocks": [ /* blocks */ ] }
    ] }
  ]
}

Allowed block shapes (omit id):
- heading: { "type": "heading", "level": 1|2|3, "text": "...", "align": "left|center|right", "color": "#hex" }
- text:    { "type": "text",    "html": "plain text", "align": "left|center|right", "color": "#hex" }
- button:  { "type": "button",  "label": "...", "href": "https://...", "bg": "#hex", "color": "#hex", "align": "left|center|right" }
- divider, spacer, list as in the campaign generator.

Skip image tags — leave a comment-only gap if needed. Preserve headings, paragraphs, lists, buttons, colors, and the overall hero/body structure. Do NOT inline-style; the renderer adds styling.

Source HTML:
${html}`;

  let raw: string;
  try {
    await ensureLocalGatewayToken();
    raw = await callOpenClaw(prompt, AI_AGENT_ID, { timeoutMs: AI_TIMEOUT_MS });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "AI gateway failed to rebuild the email." };
  }

  const stripped = stripCodeFence(raw);
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "AI did not return valid JSON. Try again." };

  let aiEmail: unknown;
  try {
    aiEmail = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: "AI returned malformed JSON. Try again." };
  }

  const document = normalizeAiEmail(aiEmail);
  const content = serializeEmail(document);

  await prisma.campaignDocument.update({ where: { id: documentId }, data: { content } });
  revalidatePath(`/campaign-creator/${doc.campaignId}`);

  return { ok: true, content };
}

// ---------------------------------------------------------------------------
// Publish a Hive snap document — mirrors repo-to-social.publishTweetToHive.
// Posts the doc's content as a comment under peak.snaps' latest container.
// ---------------------------------------------------------------------------

export async function publishHiveSnap(
  documentId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const account = process.env.HIVE_POSTING_ACCOUNT;
    const key = process.env.HIVE_POSTING_KEY;
    if (!account || !key) {
      return { ok: false, error: "HIVE_POSTING_ACCOUNT or HIVE_POSTING_KEY not set on the server." };
    }

    const doc = await prisma.campaignDocument.findUnique({
      where: { id: documentId },
      select: { content: true, campaignId: true },
    });
    if (!doc) return { ok: false, error: "Document not found." };
    const text = doc.content.trim();
    if (!text) return { ok: false, error: "Snap is empty — nothing to publish." };

    const { Client, PrivateKey } = await import("@hiveio/dhive");
    const client = new Client(HIVE_NODES);

    const result = (await client.database.call("get_discussions_by_author_before_date", [
      SNAPS_CONTAINER_AUTHOR,
      "",
      new Date().toISOString().split(".")[0],
      1,
    ])) as Array<{ permlink: string }>;
    if (!result?.[0]?.permlink) {
      return { ok: false, error: "Could not fetch peak.snaps container." };
    }
    const parentPermlink = result[0].permlink;
    const permlink = `snap-${crypto.randomUUID()}`;

    const imageUrls = [
      ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g),
    ]
      .map((m) => m[1])
      .concat(text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s)]*)?/gi) ?? []);

    const metadata = {
      app: "Marketing Portal Skatehive",
      tags: [HIVE_COMMUNITY_TAG, "snaps"],
      images: [...new Set(imageUrls)],
    };
    const op = [
      "comment",
      {
        parent_author: SNAPS_CONTAINER_AUTHOR,
        parent_permlink: parentPermlink,
        author: account,
        permlink,
        title: "",
        body: text,
        json_metadata: JSON.stringify(metadata),
      },
    ] as const;

    const pk = PrivateKey.fromString(key);
    await client.broadcast.sendOperations([op as never], pk);

    const url = `https://skatehive.app/post/${account}/${permlink}`;
    revalidatePath(`/campaign-creator/${doc.campaignId}`);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------

async function upsertNamedDocument(campaignId: string, name: string, content: string) {
  if (!content) return;
  const existing = await prisma.campaignDocument.findFirst({
    where: { campaignId, name, isMain: false },
    select: { id: true },
  });
  if (existing) {
    await prisma.campaignDocument.update({ where: { id: existing.id }, data: { content } });
  } else {
    await prisma.campaignDocument.create({
      data: { campaignId, name, isMain: false, content },
    });
  }
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^\s*```(?:\w+)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  return fenced ? fenced[1] : text;
}

function extractArtifactsJson(raw: string): {
  hive_snap: string;
  farcaster: string;
  tweets: string[];
  discord: string;
  email: unknown;
} | null {
  const stripped = stripCodeFence(raw);
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as {
      hive_snap?: unknown;
      farcaster?: unknown;
      tweets?: unknown;
      discord?: unknown;
      email?: unknown;
    };
    const hive_snap = typeof obj.hive_snap === "string" ? obj.hive_snap : null;
    const farcaster = typeof obj.farcaster === "string" ? obj.farcaster : null;
    const tweets = Array.isArray(obj.tweets)
      ? obj.tweets.filter((t): t is string => typeof t === "string")
      : null;
    const discord = typeof obj.discord === "string" ? obj.discord : null;
    const email = obj.email && typeof obj.email === "object" ? obj.email : null;
    if (!hive_snap || !farcaster || !tweets || tweets.length === 0 || !discord || !email) return null;
    return { hive_snap, farcaster, tweets, discord, email };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI -> EmailDocument normalization. The AI emits a loosely-typed shape;
// we coerce to a valid EmailDocument with IDs filled in.
// ---------------------------------------------------------------------------

function normalizeAiEmail(input: unknown): EmailDocument {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const subject = typeof obj.subject === "string" ? obj.subject : "";
  const preheader = typeof obj.preheader === "string" ? obj.preheader : "";
  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const sections: EmailSection[] = sectionsRaw.map(normalizeAiSection);
  return {
    version: 1,
    subject,
    preheader,
    pageBackground: "#f4f4f5",
    contentBackground: "#ffffff",
    contentWidth: 640,
    textColor: "#171717",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    sections: sections.length ? sections : [],
  };
}

function normalizeAiSection(input: unknown): EmailSection {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const columnsRaw = Array.isArray(obj.columns) ? obj.columns : [];
  const columns: EmailColumn[] = columnsRaw.map(normalizeAiColumn);
  return {
    id: newId("sec"),
    background: typeof obj.background === "string" ? obj.background : "#ffffff",
    paddingY: typeof obj.paddingY === "number" ? obj.paddingY : 24,
    paddingX: typeof obj.paddingX === "number" ? obj.paddingX : 24,
    columns: columns.length ? columns : [{ id: newId("col"), blocks: [] }],
  };
}

function normalizeAiColumn(input: unknown): EmailColumn {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const blocksRaw = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks = blocksRaw
    .map(normalizeAiBlock)
    .filter((b): b is EmailBlock => b !== null);
  return { id: newId("col"), blocks };
}

function normalizeAiBlock(input: unknown): EmailBlock | null {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = obj.type;
  const align = pickAlign(obj.align);
  switch (type) {
    case "heading": {
      const levelRaw = obj.level;
      const level = levelRaw === 1 || levelRaw === 2 || levelRaw === 3 ? levelRaw : 2;
      return {
        id: newId("h"),
        type: "heading",
        level,
        text: typeof obj.text === "string" ? obj.text : "",
        align,
        color: pickColor(obj.color, "#0a0a0a"),
      };
    }
    case "text":
      return {
        id: newId("t"),
        type: "text",
        html:
          typeof obj.html === "string"
            ? obj.html
            : typeof obj.text === "string"
              ? (obj.text as string)
              : "",
        align,
        color: pickColor(obj.color, "#404040"),
      };
    case "button":
      return {
        id: newId("btn"),
        type: "button",
        label: typeof obj.label === "string" ? obj.label : "Drop in",
        href: typeof obj.href === "string" ? obj.href : "https://skatehive.app",
        bg: pickColor(obj.bg, "#65a30d"),
        color: pickColor(obj.color, "#ffffff"),
        align,
      };
    case "divider":
      return {
        id: newId("div"),
        type: "divider",
        color: pickColor(obj.color, "#e5e5e5"),
        thickness: typeof obj.thickness === "number" ? obj.thickness : 1,
      };
    case "spacer":
      return {
        id: newId("sp"),
        type: "spacer",
        height: typeof obj.height === "number" ? obj.height : 24,
      };
    case "list": {
      const items = Array.isArray(obj.items)
        ? obj.items.filter((x): x is string => typeof x === "string")
        : [];
      return {
        id: newId("li"),
        type: "list",
        ordered: Boolean(obj.ordered),
        items: items.length ? items : ["Item"],
      };
    }
    case "image":
      // The AI is instructed not to emit images. Drop if it does.
      return null;
    default:
      return null;
  }
}

function pickAlign(value: unknown): Align {
  if (value === "left" || value === "center" || value === "right") return value;
  return "left";
}

function pickColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length ? value : fallback;
}
