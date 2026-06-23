import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Paragraph (paragraph.com) — newsletter publication API wrapper.
//
// The API is ALPHA ("breaking changes until we finalize the design"), so every
// call in the codebase goes through this one file. Keys are per-publication,
// resolved with the usual `${prefix}_PARAGRAPH_API_KEY` convention.
//
// Known gates: POST /emails/send requires per-publication approval from
// Paragraph (403 "not eligible" until granted). Subscriber add/import is
// silent — no confirmation email goes out (verified 2026-06-10).
// ---------------------------------------------------------------------------

const BASE = "https://public.api.paragraph.com/api/v1";

export function paragraphApiKey(project: ProjectConfig): string | null {
  const prefix = project.agent.gatewayEnvPrefix;
  return (
    (prefix ? process.env[`${prefix}_PARAGRAPH_API_KEY`] : undefined) ??
    process.env.PARAGRAPH_API_KEY ??
    null
  );
}

async function call<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  // Their alpha API rate-limits aggressively (429 with no Retry-After) —
  // back off and retry a few times before surfacing the error.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const data = (await res.json().catch(() => null)) as T & { success?: boolean; msg?: string };
    if (!res.ok || data === null || data?.success === false) {
      throw new Error(`Paragraph ${path} HTTP ${res.status}: ${data?.msg ?? "unknown error"}`);
    }
    return data;
  }
}

export type ParagraphSubscriber = {
  email?: string;
  walletAddress?: string;
  createdAt: number;
};

/** The publication this API key belongs to. */
export async function getPublication(apiKey: string): Promise<{ id: string; name: string; slug: string }> {
  return call(apiKey, "/me");
}

export async function getSubscriberCount(publicationId: string): Promise<number> {
  // Public endpoint — no auth needed.
  const res = await fetch(`${BASE}/publications/${publicationId}/subscribers/count`);
  const data = (await res.json()) as { count?: number };
  if (typeof data.count !== "number") throw new Error("Paragraph subscriber count unavailable.");
  return data.count;
}

/**
 * All ACTIVE subscribers (their API never returns unsubscribed ones), deduped.
 *
 * DEFENSIVE: their alpha cursor used to loop forever on null-createdAt rows
 * (reported 2026-06-11, fixed by Paragraph next day). The loop guard stays as
 * a backstop; `complete` tells callers whether enumeration finished cleanly
 * (hasMore=false) or was cut short by the guard / page cap.
 */
export async function listAllSubscribers(
  apiKey: string,
): Promise<{ items: ParagraphSubscriber[]; complete: boolean }> {
  const out: ParagraphSubscriber[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) });
    const data = await call<{ items: ParagraphSubscriber[]; pagination?: { cursor?: string; hasMore?: boolean } }>(
      apiKey,
      `/subscribers?${qs}`,
    );
    let fresh = 0;
    for (const it of data.items ?? []) {
      const key = (it.email ?? it.walletAddress ?? "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      fresh++;
    }
    if (fresh === 0) return { items: out, complete: false }; // wrapped — loop guard
    if (!data.pagination?.hasMore || !data.pagination.cursor) {
      return { items: out, complete: true };
    }
    cursor = data.pagination.cursor;
    await new Promise((r) => setTimeout(r, 350)); // stay under their page-rate limit
  }
  return { items: out, complete: false }; // page cap hit
}

/** Add one subscriber. Paragraph dedupes by email/wallet; silent (no email sent). */
export async function addSubscriber(
  apiKey: string,
  sub: { email?: string; wallet?: string; createdAt?: number },
): Promise<void> {
  await call(apiKey, "/subscribers", { method: "POST", body: JSON.stringify(sub) });
}

/** Remove a subscriber by email (used when someone opts out from settings). */
export async function removeSubscriber(apiKey: string, email: string): Promise<void> {
  await call(apiKey, "/subscribers", {
    method: "DELETE",
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
}

/**
 * Create a post on the publication. Content is markdown. `status: "draft"`
 * keeps it unpublished (safe for tests / human review). Verified against the
 * alpha API 2026-06-23: POST /posts → { id, status }.
 *
 * Email is OPT-IN and orthogonal to publishing: `status: "published"` alone
 * only puts the post on the web/feed. Subscribers are emailed ONLY when
 * `sendNewsletter: true` (default false) — confirmed against the API docs.
 */
export async function createPost(
  apiKey: string,
  params: {
    title: string;
    subtitle?: string;
    markdown: string;
    imageUrl?: string;
    status?: "draft" | "published";
    sendNewsletter?: boolean;
  },
): Promise<{ id: string; status: string }> {
  return call(apiKey, "/posts", {
    method: "POST",
    body: JSON.stringify({ status: "draft", sendNewsletter: false, ...params }),
  });
}

/**
 * Send a custom email to explicit recipients (max 10k). Markdown body.
 * GATED: requires Paragraph approval for the publication; throws the 403
 * "not eligible" message until granted. dryRun validates without sending.
 */
export async function sendCustomEmail(
  apiKey: string,
  params: { subject: string; body: string; emails: string[]; dryRun?: boolean },
): Promise<{ accepted: number; skipped: Array<{ email: string; reason: string }> }> {
  return call(apiKey, "/emails/send", { method: "POST", body: JSON.stringify(params) });
}
