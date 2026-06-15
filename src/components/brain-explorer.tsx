"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Lock,
  Pin,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// Mirror of isProtectedBrainFile() in src/lib/brain-workspace.ts — root-level
// agent boot files that can be edited but never deleted. The server enforces
// this authoritatively; here we just hide the Delete affordance.
const PROTECTED_ROOT_BASENAMES = new Set([
  "soul.md",
  "identity.md",
  "user.md",
  "agents.md",
  "tools.md",
  "heartbeat.md",
  "memory.md",
  "bootstrap.md",
]);

function isProtectedBrainFile(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (norm.includes("/")) return false;
  return PROTECTED_ROOT_BASENAMES.has(norm.toLowerCase());
}

// ---------------------------------------------------------------------------
// Drive types (mirrors src/lib/google-drive.ts public surface)
// ---------------------------------------------------------------------------

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

type DriveListResult =
  | { ok: true; folderId: string; files: DriveFile[] }
  | { ok: false; reason: "not-configured"; saEmail?: string; note?: string }
  | { ok: false; reason: "error"; error: string };

type DriveFileContent =
  | { kind: "html"; html: string }
  | { kind: "binary"; contentType: string; base64: string }
  | { kind: "link"; webViewLink: string; mimeType: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Drive helpers
// ---------------------------------------------------------------------------

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

function driveFileIcon(mimeType: string) {
  if (mimeType === DRIVE_FOLDER_MIME)
    return <Folder className="h-4 w-4 shrink-0 text-accent" aria-hidden />;
  if (mimeType.startsWith("image/"))
    return <File className="h-4 w-4 shrink-0 text-foreground-subtle" aria-hidden />;
  return <FileText className="h-4 w-4 shrink-0 text-foreground-subtle" aria-hidden />;
}

function formatDriveDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// DriveViewer component
// ---------------------------------------------------------------------------

function DriveViewer({ projectName }: { projectName: string }) {
  const [listState, setListState] = useState<DriveListResult | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [content, setContent] = useState<DriveFileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState("");
  // Stack of folder IDs for drill-down navigation (v1: top-level + one level)
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);

  const fetchList = useCallback(async (folderId?: string) => {
    setListLoading(true);
    setListError("");
    setSelectedFile(null);
    setContent(null);
    try {
      const url = folderId
        ? `/api/brain/drive/list?folderId=${encodeURIComponent(folderId)}`
        : "/api/brain/drive/list";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as DriveListResult;
      setListState(data);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function openFile(file: DriveFile) {
    if (file.mimeType === DRIVE_FOLDER_MIME) {
      // Drill into subfolder
      setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
      await fetchList(file.id);
      return;
    }
    setSelectedFile(file);
    setContent(null);
    setContentError("");
    setContentLoading(true);
    try {
      const res = await fetch(`/api/brain/drive/file?id=${encodeURIComponent(file.id)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as DriveFileContent;
      setContent(data);
    } catch (e) {
      setContentError(e instanceof Error ? e.message : String(e));
    } finally {
      setContentLoading(false);
    }
  }

  async function navigateTo(idx: number) {
    // idx === -1 → root; idx >= 0 → specific folder in stack
    if (idx === -1) {
      setFolderStack([]);
      await fetchList();
    } else {
      const newStack = folderStack.slice(0, idx + 1);
      setFolderStack(newStack);
      await fetchList(folderStack[idx].id);
    }
  }

  // Render content pane
  function renderContent() {
    if (!selectedFile) {
      return (
        <div className="flex min-h-[400px] items-center justify-center text-sm text-foreground-faint">
          Select a file to preview
        </div>
      );
    }
    if (contentLoading) {
      return (
        <div className="flex min-h-[400px] items-center justify-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      );
    }
    if (contentError) {
      return (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {contentError}
        </p>
      );
    }
    if (!content) return null;

    // Error result
    if ("ok" in content && !content.ok) {
      return (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {content.error}
        </p>
      );
    }

    const c = content as Exclude<DriveFileContent, { ok: false; error: string }>;

    if (c.kind === "html") {
      return (
        <iframe
          title={selectedFile.name}
          srcDoc={c.html}
          sandbox="allow-same-origin"
          className="w-full rounded-lg border border-border"
          style={{ height: "70vh", minHeight: 400 }}
          aria-label={`Preview of ${selectedFile.name}`}
        />
      );
    }

    if (c.kind === "binary") {
      if (c.contentType.startsWith("image/")) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/brain/drive/file?id=${encodeURIComponent(selectedFile.id)}&mode=raw`}
            alt={selectedFile.name}
            className="max-w-full rounded-lg border border-border"
          />
        );
      }
      // PDF (and slides exported as PDF)
      return (
        <iframe
          title={selectedFile.name}
          src={`/api/brain/drive/file?id=${encodeURIComponent(selectedFile.id)}&mode=raw`}
          className="w-full rounded-lg border border-border"
          style={{ height: "70vh", minHeight: 400 }}
          aria-label={`Preview of ${selectedFile.name}`}
        />
      );
    }

    // kind === "link"
    if (c.kind === "link") {
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-elevated p-8 text-center">
          <FileText className="h-10 w-10 text-foreground-faint" aria-hidden />
          <p className="text-sm text-foreground-muted">Preview not available for this file type.</p>
          {c.webViewLink && (
            <a
              href={c.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20"
              aria-label={`Open ${selectedFile.name} in Google Drive`}
            >
              Open in Google Drive <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      );
    }

    return null;
  }

  // Not configured state
  if (!listLoading && listState && !listState.ok && listState.reason === "not-configured") {
    return (
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">
            Google Drive isn&apos;t connected for {projectName}.
          </p>
          {listState.saEmail ? (
            <>
              <p className="text-sm text-foreground-muted">
                Share a Drive folder with the service account, enable the Drive API in that
                account&apos;s GCP project, then set the folder ID env var.
              </p>
              <ol className="ml-4 list-decimal space-y-1.5 text-sm text-foreground-muted">
                <li>
                  Share your Drive folder with{" "}
                  <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-xs text-foreground">
                    {listState.saEmail}
                  </code>{" "}
                  (Viewer role).
                </li>
                <li>Enable the Google Drive API in the GCP project for that service account.</li>
                <li>
                  Set the env var{" "}
                  <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-xs text-foreground">
                    {/* The prefix is inferred from the not-configured context — we show a generic hint */}
                    {"<PREFIX>_GOOGLE_DRIVE_FOLDER_ID"}
                  </code>{" "}
                  to the folder&apos;s ID (the part after{" "}
                  <code className="font-mono text-xs">drive.google.com/drive/folders/</code>
                  ).
                </li>
              </ol>
            </>
          ) : (
            <p className="text-sm text-foreground-muted">
              {listState.note ?? "No Google service account is configured for this project."}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      {/* File list */}
      <div className="rounded-xl border border-border bg-surface p-3 lg:col-span-1">
        {/* Breadcrumb navigation */}
        {folderStack.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-foreground-muted">
            <button
              type="button"
              onClick={() => navigateTo(-1)}
              className="rounded px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground"
              aria-label="Navigate to root Drive folder"
            >
              Drive
            </button>
            {folderStack.map((folder, idx) => (
              <span key={folder.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                {idx < folderStack.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => navigateTo(idx)}
                    className="rounded px-1 py-0.5 hover:bg-foreground/5 hover:text-foreground"
                    aria-label={`Navigate to ${folder.name}`}
                  >
                    {folder.name}
                  </button>
                ) : (
                  <span className="truncate font-medium text-foreground">{folder.name}</span>
                )}
              </span>
            ))}
          </div>
        )}

        {listLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-foreground-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </div>
        ) : listError ? (
          <p className="text-xs text-danger">{listError}</p>
        ) : listState?.ok ? (
          listState.files.length === 0 ? (
            <p className="py-4 text-center text-xs text-foreground-faint">
              This folder is empty.
            </p>
          ) : (
            <div className="space-y-0.5">
              {listState.files.map((f) => {
                const isFolder = f.mimeType === DRIVE_FOLDER_MIME;
                const active = selectedFile?.id === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => openFile(f)}
                    aria-label={`${isFolder ? "Open folder" : "Preview file"}: ${f.name}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                      active
                        ? "bg-accent-bg font-medium text-accent"
                        : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground",
                    )}
                  >
                    {driveFileIcon(f.mimeType)}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {isFolder && (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground-faint" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : listState && !listState.ok && listState.reason === "error" ? (
          <p className="text-xs text-danger">{listState.error}</p>
        ) : null}
      </div>

      {/* Content pane */}
      <div className="rounded-xl border border-border bg-surface lg:col-span-3">
        {selectedFile && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {driveFileIcon(selectedFile.mimeType)}
              <span className="truncate font-mono text-sm text-foreground">{selectedFile.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-foreground-faint tabular-nums">
              {selectedFile.modifiedTime && (
                <span>{formatDriveDate(selectedFile.modifiedTime)}</span>
              )}
              {selectedFile.webViewLink && (
                <a
                  href={selectedFile.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-foreground-muted transition hover:border-border-strong hover:text-foreground"
                  aria-label={`Open ${selectedFile.name} in Google Drive`}
                >
                  <ExternalLink className="h-3 w-3" aria-hidden /> Drive
                </a>
              )}
            </div>
          </div>
        )}
        <div className="p-4">{renderContent()}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

type BrainTree = { pinned: string[]; core: string[]; folders: Record<string, string[]> };
type Resp<T> = { ok: boolean; data?: T; error?: string };

const EMPTY_TREE: BrainTree = { pinned: [], core: [], folders: {} };

const FOLDER_ORDER = ["memory", "projects", "docs", "scripts", "data", "drafts", "content", "skills"];
const FOLDER_LABELS: Record<string, string> = {
  memory: "📝 memory",
  projects: "📁 projects",
  docs: "📄 docs",
  scripts: "⚙️ scripts",
  data: "💾 data",
  drafts: "✍️ drafts",
  content: "🎬 content",
  skills: "🧩 skills",
};

function pickDefault(tree: BrainTree): string {
  const prefer = ["IDENTITY.md", "SOUL.md", "MEMORY.md", "USER.md"];
  for (const p of prefer) if (tree.core.includes(p)) return p;
  if (tree.core[0]) return tree.core[0];
  if (tree.pinned[0]) return tree.pinned[0];
  const firstFolder = Object.entries(tree.folders).find(([, files]) => files.length > 0);
  if (firstFolder) return `${firstFolder[0]}/${firstFolder[1][0]}`;
  return "";
}

export function BrainExplorer({ agentName }: { agentName: string }) {
  // Top-level section: Workspace or Drive
  const [section, setSection] = useState<"workspace" | "drive">("workspace");

  const [tree, setTree] = useState<BrainTree>(EMPTY_TREE);
  const [file, setFile] = useState("");
  const [serverContent, setServerContent] = useState("");
  const [draft, setDraft] = useState("");
  const [binary, setBinary] = useState(false);
  const [tab, setTab] = useState<"edit" | "view">("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["memory"]));

  const dirty = useMemo(() => !binary && draft !== serverContent, [binary, draft, serverContent]);
  const isMarkdown = file.endsWith(".md") || file.endsWith(".mdx");

  const loadFile = useCallback(async (f: string) => {
    setError("");
    try {
      const res = await fetch(`/api/brain/file?file=${encodeURIComponent(f)}`, { cache: "no-store" });
      const j = (await res.json()) as Resp<{ binary: boolean; content: string }>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to load");
      setFile(f);
      setBinary(Boolean(j.data?.binary));
      setServerContent(j.data?.content ?? "");
      setDraft(j.data?.content ?? "");
      setTab(j.data?.binary ? "view" : f.endsWith(".md") ? "view" : "edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadTree = useCallback(async (): Promise<BrainTree> => {
    const res = await fetch("/api/brain/list", { cache: "no-store" });
    const j = (await res.json()) as Resp<{ tree: BrainTree }>;
    if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to load brain");
    const t = j.data?.tree ?? EMPTY_TREE;
    setTree(t);
    return t;
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const t = await loadTree();
        const first = pickDefault(t);
        if (first) await loadFile(first);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTree, loadFile]);

  async function switchFile(f: string) {
    if (saving) return;
    if (dirty && !confirm(`Discard unsaved changes to ${file}?`)) return;
    await loadFile(f);
  }

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/brain/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file, content: draft }),
      });
      const j = (await res.json()) as Resp<unknown>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to save");
      setServerContent(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!file) return;
    if (isProtectedBrainFile(file)) {
      setError("This is a protected boot file and cannot be deleted.");
      return;
    }
    if (!confirm(`Delete ${file}? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/brain/file", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const j = (await res.json()) as Resp<unknown>;
      if (!res.ok || !j.ok) throw new Error(j.error ?? "failed to delete");
      const t = await loadTree();
      const next = pickDefault(t);
      if (next) {
        await loadFile(next);
      } else {
        setFile("");
        setServerContent("");
        setDraft("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleFolder(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const orderedFolders = Object.entries(tree.folders)
    .filter(([, files]) => files.length > 0)
    .sort(([a], [b]) => {
      const ai = FOLDER_ORDER.indexOf(a);
      const bi = FOLDER_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
    });

  const fileBtn = (
    full: string,
    label: string,
    opts: { small?: boolean; pinned?: boolean } = {},
  ) => {
    const { small, pinned } = opts;
    const active = file === full;
    const Icon = pinned ? Pin : FileText;
    return (
      <button
        key={full}
        type="button"
        onClick={() => switchFile(full)}
        className={cn(
          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
          small ? "text-xs" : "text-sm",
          active
            ? "bg-accent-bg font-medium text-accent"
            : pinned
              ? "border border-accent-border/40 bg-accent-bg/30 text-foreground hover:bg-accent-bg/60"
              : "text-foreground-muted hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <Icon className={cn("shrink-0", pinned ? "text-accent" : "", small ? "h-3 w-3" : "h-4 w-4")} />
        <span className="truncate">{label}</span>
        {active && dirty && (
          <span className="ml-auto rounded border border-border px-1 text-[10px] text-foreground-subtle">•</span>
        )}
      </button>
    );
  };

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">🧠 Brain</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Files for <span className="font-medium text-accent">{agentName}</span>. Edits write directly to the agent workspace.
          </p>
        </div>
        {/* Workspace | Drive section switcher */}
        <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Brain section">
          {(["workspace", "drive"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                section === s ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground",
              )}
            >
              {s === "workspace" ? "Workspace" : "Drive"}
            </button>
          ))}
        </div>
      </header>

      {section === "drive" ? (
        <DriveViewer projectName={agentName} />
      ) : (
        <>
      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading brain…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {/* File tree */}
          <div className="rounded-xl border border-border bg-surface p-3 lg:col-span-1">
            {tree.pinned.length > 0 && (
              <div className="mb-4">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                  📌 Pinned
                </div>
                <div className="space-y-0.5">
                  {tree.pinned.map((f) => fileBtn(f, f.split("/").pop() ?? f, { pinned: true }))}
                </div>
              </div>
            )}
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-foreground-subtle">
              Core
            </div>
            <div className="space-y-0.5">{tree.core.map((f) => fileBtn(f, f))}</div>

            <div className="mt-4 space-y-2">
              {orderedFolders.map(([folder, files]) => {
                const open = expanded.has(folder);
                return (
                  <div key={folder}>
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {open ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                      <span className="truncate">{FOLDER_LABELS[folder] ?? folder}</span>
                      <span className="ml-auto text-[10px] text-foreground-faint">{files.length}</span>
                    </button>
                    {open && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
                        {files.map((f) => fileBtn(`${folder}/${f}`, f, { small: true }))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Editor / preview */}
          <div className="rounded-xl border border-border bg-surface lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <span className="truncate font-mono text-sm text-foreground">{file || "—"}</span>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border p-0.5">
                  {(["edit", "view"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      disabled={t === "edit" && binary}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-40",
                        tab === t ? "bg-accent-bg text-accent" : "text-foreground-muted hover:text-foreground",
                      )}
                    >
                      {t === "edit" ? "Edit" : "Preview"}
                    </button>
                  ))}
                </div>
                <span
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider",
                    dirty ? "bg-warning/10 text-warning" : "text-foreground-faint",
                  )}
                >
                  {dirty ? "unsaved" : "saved"}
                </span>
                <button
                  type="button"
                  onClick={() => loadFile(file)}
                  disabled={saving || !file}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reload
                </button>
                {file && isProtectedBrainFile(file) ? (
                  <span
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground-faint"
                    title="Boot file — protected from deletion so the agent can always bootstrap. You can still edit it."
                  >
                    <Lock className="h-3.5 w-3.5" /> Protected
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={del}
                    disabled={saving || !file}
                    className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty || binary}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-2.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            </div>

            <div className="p-4">
              {binary ? (
                <div className="flex min-h-[400px] items-center justify-center rounded-lg border border-border bg-surface-elevated text-sm text-foreground-muted">
                  {serverContent}
                </div>
              ) : tab === "edit" ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="min-h-[600px] w-full resize-y rounded-lg border border-border bg-surface-elevated p-3 font-mono text-xs text-foreground focus:border-accent-border focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              ) : isMarkdown ? (
                <div className="min-h-[600px] rounded-lg border border-border bg-surface-elevated p-4">
                  <MarkdownContent markdown={draft} />
                </div>
              ) : (
                <pre className="min-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-elevated p-4 font-mono text-xs text-foreground">
                  {draft}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
