"use client";

import { Eye, ImagePlus, Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameDocument, updateDocumentContent } from "@/app/actions/campaigns";
import { signPostMediaUpload } from "@/app/actions/post-creator";
import { MarkdownContent } from "@/components/markdown-content";

type Mode = "edit" | "preview";

/** Artifact kinds where an image upload makes sense (social posts). */
export type ImageKind = "hive" | "hive_mag" | "farcaster" | "tweets" | "discord";

/** Direct browser→Pinata upload (mirrors the post-creator flow): ask the server
 *  for a short-lived signed URL, POST the file straight to Pinata, return the
 *  public gateway URL. The image never flows through the Next server. */
async function uploadImageToPinata(
  file: File,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const signed = await signPostMediaUpload(file.name, file.size, file.type);
    if (!signed.ok) return signed;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("network", "public");
    const res = await fetch(signed.url, { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Pinata upload HTTP ${res.status}: ${body.slice(0, 160)}` };
    }
    const json = (await res.json().catch(() => null)) as { data?: { cid?: string } } | null;
    const cid = json?.data?.cid;
    if (!cid) return { ok: false, error: "Pinata returned no CID" };
    return { ok: true, url: `${signed.gateway}/${cid}?filename=${encodeURIComponent(file.name)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Format an uploaded image URL for the channel that will publish it:
 *  - Hive / Hive mag / Discord render markdown, so embed `![image](url)`.
 *  - Farcaster infers embeds from bare URLs in the body → drop the raw URL.
 *  - Twitter/X is a manual intent (no media API) → raw URL so it can be opened
 *    /attached; it also previews as a link card. */
function formatImageForKind(kind: ImageKind, url: string): string {
  if (kind === "farcaster" || kind === "tweets") return `\n${url}\n`;
  return `\n![image](${url})\n`;
}

export function CampaignDocumentEditor({
  documentId,
  initialName,
  initialContent,
  editorOnly = false,
  bare = false,
  imageKind,
  onContentChange,
}: {
  documentId: string;
  initialName: string;
  initialContent: string;
  /** Hide the built-in preview toggle and always show the textarea — used when
   *  a parent panel owns the Preview/Edit switch (avoids a duplicate preview). */
  editorOnly?: boolean;
  /** Render only the textarea + save status — no card, name input, or toggle.
   *  The parent panel supplies the card chrome and name. */
  bare?: boolean;
  /** When set, show an "Add image" button that uploads to Pinata and inserts
   *  the URL in this channel's format. Only for image-capable social kinds. */
  imageKind?: ImageKind;
  /** Notify the parent on every keystroke so a shared preview can update live. */
  onContentChange?: (content: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<Mode>("edit");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const savedContentRef = useRef(initialContent);
  const savedNameRef = useRef(initialName);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Insert text at the caret (or append) and propagate the change.
  const insertAtCaret = (snippet: string) => {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : content.length;
    const next = content.slice(0, at) + snippet + content.slice(el ? el.selectionEnd : content.length);
    setContent(next);
    onContentChange?.(next);
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file || !imageKind) return;
    setUploadError(null);
    setUploading(true);
    const res = await uploadImageToPinata(file);
    setUploading(false);
    if (!res.ok) {
      setUploadError(res.error);
      return;
    }
    insertAtCaret(formatImageForKind(imageKind, res.url));
  };

  const ImageButton = imageKind ? (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface/70 px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:text-foreground">
      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
      {uploading ? "Uploading…" : "Add image"}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          void onPickImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  ) : null;

  useEffect(() => {
    if (content === savedContentRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStatus("saving");
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const next = content;
        await updateDocumentContent(documentId, next);
        savedContentRef.current = next;
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1200);
      });
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, documentId]);

  // Bare mode: just the textarea + save status. A parent panel owns the card,
  // name, and the Preview/Edit toggle (avoids a duplicate card + preview).
  if (bare) {
    return (
      <div>
        {ImageButton && (
          <div className="mb-2 flex items-center gap-2">
            {ImageButton}
            {uploadError && <span className="text-[11px] text-danger">{uploadError}</span>}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            onContentChange?.(e.target.value);
          }}
          placeholder="Edit the content here…"
          className="min-h-[60vh] w-full resize-y rounded-xl border border-border bg-surface-elevated px-4 py-3 text-[14px] leading-7 text-foreground outline-none focus:border-accent-border focus:ring-1 focus:ring-lime-400/20"
        />
        <p className="mt-2 text-right text-[11px] text-foreground-subtle" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/70 p-5">
      <div className="flex items-center justify-between gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() === savedNameRef.current) return;
            startTransition(async () => {
              await renameDocument(documentId, name);
              savedNameRef.current = name.trim() || "Untitled";
            });
          }}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-foreground outline-none focus:ring-0"
          aria-label="Document name"
        />
        {!editorOnly && <ModeToggle mode={mode} onChange={setMode} />}
        <span className="w-16 text-right text-[11px] text-foreground-subtle" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </span>
      </div>

      {editorOnly || mode === "edit" ? (
        <>
          {ImageButton && (
            <div className="mt-3 flex items-center gap-2">
              {ImageButton}
              {uploadError && <span className="text-[11px] text-danger">{uploadError}</span>}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              onContentChange?.(e.target.value);
            }}
            placeholder="Write the brief here. What's the goal, who's it for, what's the angle?"
            className="mt-4 min-h-[70vh] w-full resize-y rounded-xl border border-border bg-surface-elevated px-4 py-3 text-[14px] leading-7 text-foreground outline-none focus:border-accent-border focus:ring-1 focus:ring-lime-400/20"
          />
        </>
      ) : (
        <div className="mt-4 min-h-[70vh] rounded-xl border border-border bg-black/20 px-4 py-3">
          {content.trim() ? (
            <MarkdownContent markdown={content} />
          ) : (
            <p className="text-sm text-foreground-subtle">
              Nothing to preview yet. Switch back to Edit to start writing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (next: Mode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Document mode"
      className="inline-flex rounded-lg border border-border bg-surface/70 p-0.5"
    >
      <ToggleButton
        active={mode === "edit"}
        onClick={() => onChange("edit")}
        icon={<Pencil className="h-3.5 w-3.5" />}
        label="Edit"
      />
      <ToggleButton
        active={mode === "preview"}
        onClick={() => onChange("preview")}
        icon={<Eye className="h-3.5 w-3.5" />}
        label="Preview"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-white/[0.08] text-foreground" : "text-foreground-subtle hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
