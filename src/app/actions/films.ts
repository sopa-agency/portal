"use server";

// Textos editados no estúdio de filmes: manchete, subtítulo, legendas e tweet
// por cena, guardados por projeto. O roteiro em código é o padrão; salvar
// grava a diferença, "restaurar" apaga a linha.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/team-access";
import { getActiveProject } from "@/projects";
import type { FilmText } from "@/lib/films/types";

type Guard = { ok: false; error: string } | { ok: true; projectSlug: string; username: string | null };

async function guard(): Promise<Guard> {
  const project = await getActiveProject();
  if (!project.films) return { ok: false, error: "Films not enabled for this project." };
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, project);
  if (!session) return { ok: false, error: "Unauthorized." };
  return { ok: true, projectSlug: project.slug, username: session.username ?? null };
}

function cleanText(input: FilmText): FilmText {
  const line = (s: unknown, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return {
    headline: [line(input.headline?.[0], 60), line(input.headline?.[1], 60)],
    subtitle: line(input.subtitle, 120),
    captions: (Array.isArray(input.captions) ? input.captions : []).slice(0, 8).map((c) => line(c, 60)),
    tweet: String(input.tweet ?? "").replace(/\r\n/g, "\n").trim().slice(0, 400),
  };
}

/** Todos os textos editados do projeto ativo, por id de cena. */
export async function loadFilmTexts(projectSlug: string): Promise<Record<string, FilmText>> {
  const rows = await prisma.filmTextOverride.findMany({ where: { projectSlug }, select: { filmId: true, text: true } });
  return Object.fromEntries(rows.map((r) => [r.filmId, r.text as unknown as FilmText]));
}

export async function saveFilmText(filmId: string, text: FilmText): Promise<{ ok: true; text: FilmText } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const id = filmId.trim().slice(0, 60);
  if (!id) return { ok: false, error: "Missing film id." };
  const clean = cleanText(text);
  try {
    await prisma.filmTextOverride.upsert({
      where: { projectSlug_filmId: { projectSlug: g.projectSlug, filmId: id } },
      create: { projectSlug: g.projectSlug, filmId: id, text: clean, updatedBy: g.username },
      update: { text: clean, updatedBy: g.username },
    });
    revalidatePath("/films");
    return { ok: true, text: clean };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resetFilmText(filmId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  try {
    await prisma.filmTextOverride.deleteMany({ where: { projectSlug: g.projectSlug, filmId: filmId.trim().slice(0, 60) } });
    revalidatePath("/films");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Cenas em dados: listar, gerar com a IA, remixar, salvar, apagar ─────────

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { callOpenClaw } from "@/lib/openclaw-gateway";
import { filmsForProject } from "@/lib/films";
import { assetCatalog, generatePrompt, remixPrompt, type SceneBrief } from "@/lib/films/prompt";
import { extractJson, parseSpec, type FilmSpec } from "@/lib/films/spec";

const AI_TIMEOUT_MS = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 285_000);
const ENV_FILE = process.env.OPENCLAW_ENV_FILE ?? path.join(os.homedir(), ".openclaw", ".env");

/** Mesmo truque das campanhas: sem GATEWAY_TOKEN no ambiente, lê o do OpenClaw local. */
async function ensureGatewayToken(): Promise<void> {
  if (process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN) return;
  try {
    const raw = await fsp.readFile(ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?GATEWAY_TOKEN\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[1];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env.GATEWAY_TOKEN = val;
      return;
    }
  } catch {
    // sem arquivo: o gateway devolve o erro certo
  }
}

export type StoredScene = { sceneId: string; spec: FilmSpec; source: string; basedOn: string | null; updatedAt: string };

export async function loadFilmScenes(projectSlug: string): Promise<StoredScene[]> {
  const rows = await prisma.filmScene.findMany({ where: { projectSlug }, orderBy: { createdAt: "asc" } });
  const out: StoredScene[] = [];
  for (const r of rows) {
    const parsed = parseSpec(r.spec);
    if (parsed.ok) out.push({ sceneId: r.sceneId, spec: parsed.spec, source: r.source, basedOn: r.basedOn, updatedAt: r.updatedAt.toISOString() });
  }
  return out;
}

async function askForScene(projectSlug: string, prompt: string): Promise<{ ok: true; spec: FilmSpec } | { ok: false; error: string; raw?: string }> {
  const project = await getActiveProject();
  if (project.slug !== projectSlug) return { ok: false, error: "Project mismatch." };
  await ensureGatewayToken();
  let raw: string;
  try {
    raw = await callOpenClaw(prompt, project.agent.id, { timeoutMs: AI_TIMEOUT_MS, project });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI gateway failed." };
  }
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return { ok: false, error: "The AI did not return a JSON scene. Try again.", raw: raw.slice(0, 600) };
  }
  const parsed = parseSpec(json);
  if (!parsed.ok) return { ok: false, error: `The AI scene is invalid (${parsed.error}). Try again or adjust the direction.`, raw: JSON.stringify(json).slice(0, 600) };
  return { ok: true, spec: parsed.spec };
}

/** Garante um sceneId livre no projeto: "auctions-remix", "auctions-remix-2", … */
async function freeSceneId(projectSlug: string, wanted: string, codedIds: Set<string>): Promise<string> {
  const base = wanted.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "scene";
  const taken = new Set((await prisma.filmScene.findMany({ where: { projectSlug }, select: { sceneId: true } })).map((r) => r.sceneId));
  let id = base;
  for (let n = 2; taken.has(id) || codedIds.has(id); n++) id = `${base}-${n}`;
  return id;
}

async function persistScene(projectSlug: string, spec: FilmSpec, source: "ai" | "remix" | "manual", basedOn: string | null, username: string | null): Promise<StoredScene> {
  const set = filmsForProject(projectSlug);
  const sceneId = await freeSceneId(projectSlug, spec.id, new Set(set?.films.map((f) => f.id) ?? []));
  const stored = { ...spec, id: sceneId };
  const row = await prisma.filmScene.create({ data: { projectSlug, sceneId, spec: stored, source, basedOn, createdBy: username } });
  return { sceneId, spec: stored, source, basedOn, updatedAt: row.updatedAt.toISOString() };
}

export async function generateFilmScene(brief: SceneBrief): Promise<{ ok: true; scene: StoredScene } | { ok: false; error: string; raw?: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const set = filmsForProject(g.projectSlug);
  if (!set) return { ok: false, error: "This project has no film set yet." };
  const clean: SceneBrief = { label: brief.label.trim().slice(0, 40), url: brief.url.trim().slice(0, 80), about: brief.about.trim().slice(0, 1200), instruction: brief.instruction?.trim().slice(0, 600) || undefined, seconds: brief.seconds };
  if (!clean.label || !clean.url || !clean.about) return { ok: false, error: "Label, page and a description (or the tweet) are required." };
  const r = await askForScene(g.projectSlug, generatePrompt(set, clean, assetCatalog(set)));
  if (!r.ok) return r;
  const scene = await persistScene(g.projectSlug, r.spec, "ai", null, g.username);
  revalidatePath("/films");
  return { ok: true, scene };
}

export async function remixFilmScene(sourceId: string, instruction: string): Promise<{ ok: true; scene: StoredScene } | { ok: false; error: string; raw?: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const set = filmsForProject(g.projectSlug);
  if (!set) return { ok: false, error: "This project has no film set yet." };
  const direction = instruction.trim().slice(0, 600);
  if (!direction) return { ok: false, error: "Say what to change." };
  const coded = set.films.find((f) => f.id === sourceId);
  const stored = coded ? null : await prisma.filmScene.findUnique({ where: { projectSlug_sceneId: { projectSlug: g.projectSlug, sceneId: sourceId } } });
  let prompt: string;
  if (coded) prompt = remixPrompt(set, { kind: "code", film: coded }, direction, assetCatalog(set));
  else if (stored) {
    const parsed = parseSpec(stored.spec);
    if (!parsed.ok) return { ok: false, error: "The source scene is invalid." };
    prompt = remixPrompt(set, { kind: "data", spec: parsed.spec }, direction, assetCatalog(set));
  } else return { ok: false, error: "Source scene not found." };
  const r = await askForScene(g.projectSlug, prompt);
  if (!r.ok) return r;
  const scene = await persistScene(g.projectSlug, r.spec, "remix", sourceId, g.username);
  revalidatePath("/films");
  return { ok: true, scene };
}

/** Salva a cena editada à mão (JSON validado); o id do JSON deve ser o da cena. */
export async function saveFilmScene(sceneId: string, raw: unknown): Promise<{ ok: true; scene: StoredScene } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const parsed = parseSpec(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const spec = { ...parsed.spec, id: sceneId };
  try {
    const row = await prisma.filmScene.update({ where: { projectSlug_sceneId: { projectSlug: g.projectSlug, sceneId } }, data: { spec } });
    revalidatePath("/films");
    return { ok: true, scene: { sceneId, spec, source: row.source, basedOn: row.basedOn, updatedAt: row.updatedAt.toISOString() } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Cria uma cena em dados a partir de um JSON escrito à mão (ou colado). */
export async function createFilmScene(raw: unknown): Promise<{ ok: true; scene: StoredScene } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const parsed = parseSpec(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const scene = await persistScene(g.projectSlug, parsed.spec, "manual", null, g.username);
  revalidatePath("/films");
  return { ok: true, scene };
}

export async function deleteFilmScene(sceneId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  try {
    await prisma.filmScene.deleteMany({ where: { projectSlug: g.projectSlug, sceneId } });
    revalidatePath("/films");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Playbook editável por projeto ───────────────────────────────────────────

export async function loadFilmPlaybook(projectSlug: string): Promise<{ markdown: string; updatedAt: string } | null> {
  const row = await prisma.filmPlaybook.findUnique({ where: { projectSlug } });
  return row ? { markdown: row.markdown, updatedAt: row.updatedAt.toISOString() } : null;
}

export async function saveFilmPlaybook(markdown: string): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  const clean = markdown.replace(/\r\n/g, "\n").trim().slice(0, 60_000);
  if (!clean) return { ok: false, error: "The playbook cannot be empty. Restore the repository version instead." };
  try {
    await prisma.filmPlaybook.upsert({
      where: { projectSlug: g.projectSlug },
      create: { projectSlug: g.projectSlug, markdown: clean, updatedBy: g.username },
      update: { markdown: clean, updatedBy: g.username },
    });
    revalidatePath("/films");
    return { ok: true, markdown: clean };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resetFilmPlaybook(): Promise<{ ok: true } | { ok: false; error: string }> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };
  try {
    await prisma.filmPlaybook.deleteMany({ where: { projectSlug: g.projectSlug } });
    revalidatePath("/films");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
