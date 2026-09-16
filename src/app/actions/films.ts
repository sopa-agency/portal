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
