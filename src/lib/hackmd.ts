import "server-only";

// Thin HackMD API client (https://api.hackmd.io/v1). Token comes from
// HACKMD_API_KEY (copied from the OpenClaw env). Used to publish a meeting's
// ata and to surface the team's existing notes inside the portal.

const API = "https://api.hackmd.io/v1";

function token(): string | null {
  return process.env.HACKMD_API_KEY?.trim() || null;
}

export function hackmdConfigured(): boolean {
  return !!token();
}

export type HackmdNote = {
  id: string;
  title: string;
  /** Canonical, guest-readable URL (we standardise on the id-form so we can PATCH later). */
  url: string;
  publishLink: string | null;
  lastChangedAt: number | null;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const t = token();
  if (!t) throw new Error("HACKMD_API_KEY não configurada.");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HackMD ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  // PATCH returns 202 with empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

type RawNote = { id: string; title?: string; publishLink?: string; lastChangedAt?: number; publishedAt?: number };

const toNote = (n: RawNote): HackmdNote => ({
  id: n.id,
  title: n.title || "(sem título)",
  url: `https://hackmd.io/${n.id}`,
  publishLink: n.publishLink ?? null,
  lastChangedAt: n.lastChangedAt ?? null,
});

/** Create a personal note. readPermission "guest" = anyone with the link can read. */
export async function createHackmdNote(input: {
  title: string;
  content: string;
  readPermission?: "owner" | "signed_in" | "guest";
}): Promise<HackmdNote> {
  const n = await req<RawNote>("/notes", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      readPermission: input.readPermission ?? "guest",
      writePermission: "owner",
      commentPermission: "everyone",
    }),
  });
  return toNote(n);
}

/** Overwrite a note's content by id. */
export async function updateHackmdNote(noteId: string, content: string): Promise<void> {
  await req(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ content }) });
}

/** A single note's markdown content by id (for importing into a campaign brief). */
export async function getHackmdNoteContent(noteId: string): Promise<string> {
  const n = await req<{ content?: string }>(`/notes/${noteId}`);
  return n.content ?? "";
}

/** The authenticated user's notes (most-recently-changed first). */
export async function listHackmdNotes(limit = 50): Promise<HackmdNote[]> {
  const notes = await req<RawNote[]>("/notes");
  return notes
    .map(toNote)
    .sort((a, b) => (b.lastChangedAt ?? 0) - (a.lastChangedAt ?? 0))
    .slice(0, limit);
}

/** Pull the id out of a stored HackMD url (id-form or publish-link short id). */
export function noteIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/hackmd\.io\/(?:@[^/]+\/)?([A-Za-z0-9_-]{8,})/);
  return m ? m[1] : null;
}
