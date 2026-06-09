import "server-only";
import * as fs from "fs";
import type { ProjectConfig } from "@/projects/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

export type DriveListResult =
  | { ok: true; folderId: string; files: DriveFile[] }
  | { ok: false; reason: "not-configured"; saEmail?: string; note?: string }
  | { ok: false; reason: "error"; error: string };

export type DriveFileContent =
  | { kind: "html"; html: string }
  | { kind: "binary"; contentType: string; base64: string }
  | { kind: "link"; webViewLink: string; mimeType: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Service-account resolution (mirrors google-analytics.ts pattern)
// ---------------------------------------------------------------------------

function resolveServiceAccount(envValue: string): Record<string, unknown> {
  const trimmed = envValue.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  return JSON.parse(fs.readFileSync(trimmed, "utf8")) as Record<string, unknown>;
}

function getServiceAccountJson(
  project: ProjectConfig,
): { sa: Record<string, unknown>; clientEmail: string } | { missing: true; note: string } {
  const prefixKey = `${project.agent.gatewayEnvPrefix}_GOOGLE_SERVICE_ACCOUNT_JSON`;
  const raw = process.env[prefixKey] ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return {
      missing: true,
      note: `No Google service account env found (tried ${prefixKey} and GOOGLE_SERVICE_ACCOUNT_JSON)`,
    };
  }
  const sa = resolveServiceAccount(raw);
  return { sa, clientEmail: sa.client_email as string };
}

// ---------------------------------------------------------------------------
// Token cache (separate from GA cache — different scope)
// ---------------------------------------------------------------------------

type CachedToken = { token: string; expiresAt: number };
const driveTokenCache = new Map<string, CachedToken>();
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getDriveAccessToken(project: ProjectConfig): Promise<string> {
  const cached = driveTokenCache.get(project.slug);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const saResult = getServiceAccountJson(project);
  if ("missing" in saResult) throw new Error(saResult.note);

  const { JWT } = await import("google-auth-library");
  const { sa } = saResult;
  const jwt = new JWT({
    email: sa.client_email as string,
    key: sa.private_key as string,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const credentials = await jwt.authorize();
  const token = credentials.access_token;
  if (!token) throw new Error("Failed to obtain Drive access token");

  driveTokenCache.set(project.slug, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

// ---------------------------------------------------------------------------
// listDriveFolder
// ---------------------------------------------------------------------------

export async function listDriveFolder(
  project: ProjectConfig,
  folderId?: string,
): Promise<DriveListResult> {
  // Resolve folder ID: per-project override → global fallback → parameter
  const prefix = project.agent.gatewayEnvPrefix;
  const resolvedFolderId =
    folderId ??
    process.env[`${prefix}_GOOGLE_DRIVE_FOLDER_ID`] ??
    process.env.GOOGLE_DRIVE_FOLDER_ID;

  // Check service account availability first so we can surface the SA email
  const saResult = getServiceAccountJson(project);
  if ("missing" in saResult) {
    return { ok: false, reason: "not-configured", note: saResult.note };
  }

  if (!resolvedFolderId) {
    return {
      ok: false,
      reason: "not-configured",
      saEmail: saResult.clientEmail,
    };
  }

  try {
    const token = await getDriveAccessToken(project);

    const query = encodeURIComponent(`'${resolvedFolderId}' in parents and trashed=false`);
    const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime,size,webViewLink)");
    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q=${query}` +
      `&fields=${fields}` +
      `&orderBy=folder,name` +
      `&pageSize=200` +
      `&supportsAllDrives=true` +
      `&includeItemsFromAllDrives=true`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Drive API ${res.status}: ${text.slice(0, 300)}`);
    }

    interface DriveListResponse {
      files?: {
        id: string;
        name: string;
        mimeType: string;
        modifiedTime: string;
        size?: string;
        webViewLink?: string;
      }[];
    }
    const data = (await res.json()) as DriveListResponse;
    const files: DriveFile[] = (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      webViewLink: f.webViewLink,
    }));

    // Folders first, then alphabetical (Drive's orderBy already does this, but
    // belt-and-suspenders sort to ensure consistent ordering client-side)
    files.sort((a, b) => {
      const aFolder = a.mimeType === "application/vnd.google-apps.folder" ? 0 : 1;
      const bFolder = b.mimeType === "application/vnd.google-apps.folder" ? 0 : 1;
      return aFolder - bFolder || a.name.localeCompare(b.name);
    });

    return { ok: true, folderId: resolvedFolderId, files };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// getDriveFileContent
// ---------------------------------------------------------------------------

const GOOGLE_DOCS = "application/vnd.google-apps.document";
const GOOGLE_SHEETS = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

// Maximum bytes to proxy as binary (10 MB)
const MAX_BINARY_BYTES = 10 * 1024 * 1024;

export async function getDriveFileContent(
  project: ProjectConfig,
  fileId: string,
): Promise<DriveFileContent> {
  try {
    const token = await getDriveAccessToken(project);

    // Step 1: get file metadata
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!metaRes.ok) {
      const text = await metaRes.text();
      throw new Error(`Drive metadata ${metaRes.status}: ${text.slice(0, 200)}`);
    }

    interface DriveMeta {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      webViewLink?: string;
    }
    const meta = (await metaRes.json()) as DriveMeta;
    const { mimeType, webViewLink = "", size } = meta;

    // Folders — not a previewable file
    if (mimeType === GOOGLE_FOLDER) {
      return { kind: "link", webViewLink, mimeType };
    }

    // Step 2: handle Google native docs via export
    if (mimeType === GOOGLE_DOCS) {
      const exportUrl =
        `https://www.googleapis.com/drive/v3/files/${fileId}/export` +
        `?mimeType=${encodeURIComponent("text/html")}`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!exportRes.ok) {
        return { kind: "link", webViewLink, mimeType };
      }
      const html = await exportRes.text();
      return { kind: "html", html };
    }

    if (mimeType === GOOGLE_SHEETS) {
      const exportUrl =
        `https://www.googleapis.com/drive/v3/files/${fileId}/export` +
        `?mimeType=${encodeURIComponent("text/html")}`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!exportRes.ok) {
        return { kind: "link", webViewLink, mimeType };
      }
      const html = await exportRes.text();
      return { kind: "html", html };
    }

    if (mimeType === GOOGLE_SLIDES) {
      const exportUrl =
        `https://www.googleapis.com/drive/v3/files/${fileId}/export` +
        `?mimeType=${encodeURIComponent("application/pdf")}`;
      const exportRes = await fetch(exportUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!exportRes.ok) {
        return { kind: "link", webViewLink, mimeType };
      }
      const arrayBuffer = await exportRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return { kind: "binary", contentType: "application/pdf", base64 };
    }

    // Text / Markdown → render inline (markdown via marked; plain text escaped)
    const isMarkdown =
      mimeType.includes("markdown") || /\.(md|markdown)$/i.test(meta.name ?? "");
    if (mimeType.startsWith("text/") || mimeType === "application/json" || isMarkdown) {
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dlRes.ok) return { kind: "link", webViewLink, mimeType };
      const text = await dlRes.text();
      let html: string;
      if (isMarkdown) {
        const { marked } = await import("marked");
        const body = marked.parse(text) as string;
        html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;padding:8px 16px;color:#1f2937">${body}</div>`;
      } else {
        const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
        html = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;padding:12px 16px">${esc}</pre>`;
      }
      return { kind: "html", html };
    }

    // Step 3: binary download for images, PDFs, videos
    const fileSize = size ? parseInt(size, 10) : 0;
    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";
    const isVideo = mimeType.startsWith("video/");

    if (isImage || isPdf || isVideo) {
      // Files larger than 10MB → link fallback
      if (fileSize > MAX_BINARY_BYTES) {
        return { kind: "link", webViewLink, mimeType };
      }
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
      const dlRes = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!dlRes.ok) {
        return { kind: "link", webViewLink, mimeType };
      }
      const arrayBuffer = await dlRes.arrayBuffer();
      // Double-check actual size
      if (arrayBuffer.byteLength > MAX_BINARY_BYTES) {
        return { kind: "link", webViewLink, mimeType };
      }
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return { kind: "binary", contentType: mimeType, base64 };
    }

    // Everything else → link
    return { kind: "link", webViewLink, mimeType };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
