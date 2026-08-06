#!/usr/bin/env node
// Indexador do feed público da SOPA — Hive + Farcaster.
//
// POR QUE É UM SCRIPT SEPARADO do farcaster-trail-worker: lá, capturar um post
// e engajar com ele são a MESMA operação (recordTrigger insere a linha e já
// enfileira like + reply de todo mundo). Indexar pro site não pode disparar o
// engajamento da SOPA — são coisas diferentes. Aqui só se LÊ e se GRAVA a
// linha; nenhuma FarcasterTrailAction é criada, nunca.
//
// De onde vem a lista: do próprio perfil, sem cadastro novo.
//   Hive      → é o username do portal (o login é Hive Keychain)
//   Farcaster → TeamMemberContact label="Farcaster"
//
// Contas já vigiadas pelo trail (watch=true) são PULADAS: se indexássemos
// primeiro, o recordTrigger veria a linha existente e desistiria, matando
// silenciosamente o engajamento entre as marcas.
//
//   dotenv -e .env.local -- node scripts/site-feed-indexer.cjs [--once] [--dry]

"use strict";

const path = require("node:path");
for (const f of [".env.local", ".env.development", ".env"]) {
  try { require("dotenv").config({ path: path.join(__dirname, "..", f), override: false }); } catch {}
}
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });

const DRY = process.argv.includes("--dry");
const ONCE = process.argv.includes("--once") || DRY;
const POLL_MS = Number(process.env.SITE_FEED_POLL_MS ?? 300_000); // 5 min
const PER_ACCOUNT = Number(process.env.SITE_FEED_PER_ACCOUNT ?? 20);
const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://hive-api.arcange.eu"];
const SNAPS_CONTAINER = process.env.TRAIL_SNAPS_CONTAINER || "peak.snaps";
const NEYNAR_KEY = process.env.NEYNAR_API_KEY;

// ── helpers ────────────────────────────────────────────────────────────────
async function hiveCall(method, params) {
  for (const node of HIVE_NODES) {
    try {
      const res = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      if (j && j.result) return j.result;
    } catch { /* próximo nó */ }
  }
  return null;
}

async function neynar(p) {
  if (!NEYNAR_KEY) return { ok: false, json: {} };
  try {
    const res = await fetch(`https://api.neynar.com${p}`, {
      headers: { "x-api-key": NEYNAR_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: {} };
  }
}

/** "@Fulano", "https://warpcast.com/fulano" → "fulano" */
function normHandle(v) {
  return String(v || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?(warpcast|farcaster)\.xyz\//i, "")
    .replace(/^https?:\/\/(www\.)?warpcast\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

const IMG_RE = /https?:\/\/[^\s)"'<>]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s)"'<>]*)?/gi;
const VID_RE = /https?:\/\/[^\s)"'<>]+\.(?:mp4|webm|mov|m3u8)(?:\?[^\s)"'<>]*)?/gi;

const IFRAME_RE = /<iframe[^>]+src=["']([^"']+)["']/gi;
// Gateways que servem o arquivo direto (video/mp4, CORS aberto) — dá pra tocar
// em <video> nativo, sem o peso de um iframe por post na timeline.
const DIRECT_VIDEO_HOSTS = /(^|\.)(ipfs\.skatehive\.app|gateway\.pinata\.cloud|ipfs\.io)$/i;

/**
 * Mídia do markdown do Hive. Além de imagem e vídeo por extensão, os posts de
 * skate embutem clipe via <iframe> — que é COMO SE ESCREVE no Hive, não como o
 * site precisa consumir. Separo em dois tipos porque não se renderizam igual:
 *   video → arquivo direto, toca em <video>
 *   embed → player de terceiro (skatehype, odysee, 3speak, youtube), precisa iframe
 */
function mediaFromMarkdown(body) {
  const src = String(body || "");
  const out = [];
  for (const m of src.matchAll(IMG_RE)) out.push({ type: "image", url: m[0] });
  for (const m of src.matchAll(VID_RE)) out.push({ type: "video", url: m[0] });
  for (const m of src.matchAll(IFRAME_RE)) {
    const url = m[1];
    let host = "";
    try { host = new URL(url).host; } catch { continue; }
    const direto = DIRECT_VIDEO_HOSTS.test(host) || /\/ipfs\//.test(url);
    out.push({ type: direto ? "video" : "embed", url });
  }
  return dedupe(out);
}

/**
 * Quote-cast: cita o post de outra pessoa em vez de publicar algo próprio.
 * Não tem parent_hash (então o filtro de resposta não pega) — o que denuncia é
 * um embed do tipo cast. No feed do estúdio isso é re-share, não produção.
 */
function isQuote(cast) {
  return (cast.embeds || []).some((e) => e && (e.cast_id || e.cast));
}

/**
 * Mídia dos embeds do Farcaster. Três saídas, porque não se renderizam igual:
 *   image → <img>
 *   video → arquivo direto, toca em <video>
 *   embed → HLS (.m3u8) ou player de terceiro; <video> nativo só toca HLS no
 *           Safari, então em vez de caixa preta vira link
 *   link  → o Neynar já resolve o Open Graph do site citado (título, descrição
 *           e imagem), então o preview sai de graça, sem buscar nada
 */
function mediaFromEmbeds(embeds) {
  const out = [];
  for (const e of embeds || []) {
    const url = e && e.url;
    if (!url) continue;
    const meta = e.metadata || {};
    const mime = meta.content_type || "";
    const isHls = /mpegurl/i.test(mime) || /\.m3u8(\?|$)/i.test(url);

    if (isHls) {
      out.push({ type: "embed", url });
    } else if (mime.startsWith("image/") || IMG_RE.test(url)) {
      out.push({ type: "image", url });
    } else if (mime.startsWith("video/") || VID_RE.test(url)) {
      out.push({ type: "video", url });
    } else {
      const og = meta.html || {};
      const img = Array.isArray(og.ogImage) ? og.ogImage[0] : og.ogImage;
      const titulo = og.ogTitle || og.title;
      // sem título nem imagem não é preview, é só uma URL — o texto já tem
      if (titulo || (img && img.url)) {
        out.push({
          type: "link",
          url,
          title: titulo ? String(titulo).slice(0, 120) : null,
          description: og.ogDescription ? String(og.ogDescription).slice(0, 200) : null,
          image: img && img.url ? String(img.url) : null,
        });
      }
    }
    IMG_RE.lastIndex = 0; VID_RE.lastIndex = 0;
  }
  return dedupe(out);
}

/** Tira HTML e sintaxe de markdown do corpo, pra sobrar texto de gente. */
function limpar(body) {
  return String(body || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true))).slice(0, 8);
}

/**
 * Grava (ou completa) uma linha. Só INSERT/UPDATE da própria linha — nunca
 * enfileira ação de engajamento, que é o ponto deste script existir.
 */
async function record({ hash, platform, authorSlug, authorHandle, authorFid, text, url, postedAt, media, embeds, kind, community }) {
  const existing = await prisma.farcasterTrailCast.findUnique({ where: { hash } }).catch(() => null);
  if (existing) {
    // Linha antiga (capturada pelo trail, ou por uma versão anterior deste
    // script). Só ENRIQUECE — nunca reduz o que já está lá.
    // Grava quando acha MAIS itens ou quando a classificação mudou (ex.: um
    // .m3u8 que era `video` e virou `embed` — mesma contagem, outro tipo).
    // Nunca reduz: menos itens que o guardado é extração pior, não melhor.
    const guardado = existing.mediaJson ? JSON.parse(existing.mediaJson) : [];
    const novo = JSON.stringify(media);
    const patch = {};
    if (media.length > guardado.length || (media.length === guardado.length && media.length > 0 && novo !== existing.mediaJson)) {
      patch.mediaJson = novo;
    }
    // Texto gravado por uma versão que cortava ANTES de limpar guardou markup
    // no lugar do conteúdo. Só troca quando o novo é limpo e o antigo não era.
    if (text && /</.test(existing.text) && !/</.test(text)) patch.text = text;
    if (!existing.kind && kind) patch.kind = kind;
    if (!existing.community && community) patch.community = community;
    if (Object.keys(patch).length === 0) return null;
    if (!DRY) await prisma.farcasterTrailCast.update({ where: { hash }, data: patch });
    return patch.kind ? "kind" : "media";
  }
  if (DRY) return "new";
  await prisma.farcasterTrailCast.create({
    data: {
      hash, platform, authorSlug, authorHandle, authorFid: authorFid ?? null,
      text: text || "", url: url ?? null, postedAt, kind: kind ?? null, community: community ?? null,
      mediaJson: media.length ? JSON.stringify(media) : null,
      embedsJson: embeds ? JSON.stringify(embeds).slice(0, 8000) : null,
    },
  });
  return "new";
}

// ── lista de captura, derivada do perfil ───────────────────────────────────
async function resolveAccounts() {
  const members = await prisma.teamMember.findMany({
    where: { projectSlug: { in: ["sopa", "*"] } },
    select: { username: true },
  });
  const usernames = [...new Set(members.map((m) => m.username.toLowerCase()))];

  // Contas que o trail já vigia — capturar aqui roubaria o gatilho delas.
  const watched = new Set(
    (await prisma.trailAccount.findMany({ where: { watch: true, enabled: true }, select: { hiveAccount: true, label: true } }))
      .flatMap((a) => [a.hiveAccount, a.label].filter(Boolean).map((s) => s.toLowerCase())),
  );

  const fcRows = await prisma.teamMemberContact.findMany({
    where: { username: { in: usernames }, label: "Farcaster" },
    select: { username: true, value: true },
  });
  const fcByUser = new Map(fcRows.map((r) => [r.username.toLowerCase(), normHandle(r.value)]));

  return usernames
    .filter((u) => !watched.has(u))
    .map((u) => ({ username: u, hive: u, farcaster: fcByUser.get(u) || null }));
}

// ── um ciclo ───────────────────────────────────────────────────────────────
async function tick() {
  const accounts = await resolveAccounts();
  let novos = 0, midia = 0, classificados = 0;

  for (const acc of accounts) {
    // Hive: posts de blog + snaps (comentários no container). Snaps são a maior
    // parte do volume e é justamente o que faz o feed parecer timeline.
    const blog = (await hiveCall("bridge.get_account_posts", { sort: "posts", account: acc.hive, limit: PER_ACCOUNT })) || [];
    const comments = (await hiveCall("bridge.get_account_posts", { sort: "comments", account: acc.hive, limit: PER_ACCOUNT })) || [];
    const snaps = comments.filter((c) => c && c.parent_author === SNAPS_CONTAINER);

    for (const post of [...blog, ...snaps]) {
      if (!post || post.author !== acc.hive) continue;
      const isSnap = post.parent_author === SNAPS_CONTAINER;
      if (!isSnap && post.depth !== 0) continue;
      const r = await record({
        hash: `hive:${post.author}/${post.permlink}`,
        platform: "hive",
        authorSlug: acc.username,
        authorHandle: post.author,
        // Snap não tem título de verdade — o da Hive é "RE: Snaps Container //
        // <data>", ruído puro. O conteúdo do snap é o corpo.
        // limpa ANTES de cortar: cortar primeiro parte a tag no meio e o
        // saneamento do endpoint não reconhece mais o `<iframe ...` sem fechar
        text: isSnap ? limpar(post.body).slice(0, 500) : post.title || limpar(post.body).slice(0, 200),
        url: `https://peakd.com/@${post.author}/${post.permlink}`,
        postedAt: new Date((post.created || "") + "Z"),
        media: mediaFromMarkdown(post.body),
        kind: isSnap ? "snap" : "blog",
        community: post.category || null,
      });
      if (r === "new") novos++; else if (r === "media") midia++; else if (r === "kind") classificados++;
    }

    // Farcaster: handle → fid → casts do usuário.
    if (acc.farcaster) {
      const u = await neynar(`/v2/farcaster/user/by_username?username=${encodeURIComponent(acc.farcaster)}`);
      const fid = u.ok && u.json && u.json.user && u.json.user.fid;
      if (fid) {
        const r = await neynar(`/v2/farcaster/feed/user/casts?fid=${fid}&limit=${PER_ACCOUNT}`);
        for (const c of (r.ok && r.json.casts) || []) {
          if (!c || !c.hash) continue;
          if (c.parent_hash) continue; // só originais — resposta não é post
          if (isQuote(c)) continue;    // nem re-share do post de outra pessoa
          const handle = (c.author && c.author.username) || acc.farcaster;
          const res = await record({
            hash: c.hash,
            platform: "farcaster",
            authorSlug: acc.username,
            authorHandle: handle,
            authorFid: fid,
            text: c.text || "",
            url: `https://warpcast.com/${handle}/${c.hash.slice(0, 10)}`,
            postedAt: new Date(c.timestamp),
            media: mediaFromEmbeds(c.embeds),
            embeds: c.embeds,
            kind: "cast",
          });
          if (res === "new") novos++; else if (res === "media") midia++; else if (res === "kind") classificados++;
        }
      }
    }
  }

  console.log(
    `[feed] ${accounts.length} contas · ${novos} novo(s) · ${midia} com mídia completada · ${classificados} classificado(s)${DRY ? " (dry run)" : ""}`,
  );
}

async function main() {
  console.log(`[feed] indexador iniciado${DRY ? " (DRY — não grava)" : ""}`);
  await tick();
  if (ONCE) return prisma.$disconnect();
  setInterval(() => { tick().catch((e) => console.error("[feed]", e.message)); }, POLL_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
