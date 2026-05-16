"use client";

import { Mail, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { rebuildEmailFromHtml, renameDocument, updateDocumentContent } from "@/app/actions/campaigns";
import { CampaignEmailBuilderDialog } from "@/components/campaign-email-builder-dialog";
import {
  type EmailDocument,
  createEmptyEmail,
  parseEmail,
  renderEmail,
  serializeEmail,
} from "@/lib/campaign-email";
import { ageFromDate } from "@/lib/utils";

export function CampaignEmailEditor({
  documentId,
  initialName,
  initialContent,
  updatedAt,
}: {
  documentId: string;
  initialName: string;
  initialContent: string;
  updatedAt: Date;
}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, startTransition] = useTransition();
  const savedContentRef = useRef(initialContent);
  const savedNameRef = useRef(initialName);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const parsed = useMemo(() => parseEmail(content), [content]);

  const handleSaveFromBuilder = (doc: EmailDocument) => {
    setContent(serializeEmail(doc));
  };

  const handleOpenBuilder = () => {
    if (parsed.kind === "empty") {
      setContent(serializeEmail(createEmptyEmail()));
    }
    setDialogOpen(true);
  };

  const handleRebuild = () => {
    setRebuildError(null);
    startTransition(async () => {
      const result = await rebuildEmailFromHtml(documentId);
      if (!result.ok) {
        setRebuildError(result.error);
        return;
      }
      setContent(result.content);
      savedContentRef.current = result.content;
    });
  };

  const builderDocument = useMemo<EmailDocument>(() => {
    if (parsed.kind === "document") return parsed.document;
    return createEmptyEmail();
  }, [parsed]);

  return (
    <section className="rounded-2xl border border-border bg-surface/70">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-bg text-accent">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() === savedNameRef.current) return;
                startTransition(async () => {
                  await renameDocument(documentId, name);
                  savedNameRef.current = name.trim() || "Untitled";
                });
              }}
              className="block w-full min-w-0 truncate bg-transparent text-sm font-semibold text-foreground outline-none focus:ring-0"
              aria-label="Document name"
            />
            <p className="truncate text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
              Email · Updated {ageFromDate(updatedAt)}
            </p>
          </div>
        </div>
        <span className="hidden w-16 text-right text-[11px] text-foreground-subtle sm:inline" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </span>
        <button
          type="button"
          onClick={handleOpenBuilder}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit email
        </button>
      </header>

      <div className="p-5">
        {parsed.kind === "document" ? (
          <EmailIframe html={renderEmail(parsed.document)} />
        ) : parsed.kind === "legacy_html" ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <p>This email is raw HTML from an older draft. Rebuild it as structured blocks to edit it visually.</p>
              <button
                type="button"
                onClick={handleRebuild}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 font-medium text-warning transition hover:bg-warning/20"
              >
                <RefreshCw className="h-3 w-3" />
                Rebuild from blocks
              </button>
            </div>
            {rebuildError ? <p className="text-xs text-danger">{rebuildError}</p> : null}
            <EmailIframe html={parsed.html} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface-elevated px-6 py-10 text-center">
            <p className="text-sm text-foreground">This email is empty.</p>
            <button
              type="button"
              onClick={handleOpenBuilder}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-bg px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20"
            >
              <Pencil className="h-3.5 w-3.5" />
              Start building
            </button>
          </div>
        )}
      </div>

      {dialogOpen ? (
        <CampaignEmailBuilderDialog
          onClose={() => setDialogOpen(false)}
          initialDocument={builderDocument}
          onSave={handleSaveFromBuilder}
        />
      ) : null}
    </section>
  );
}

function EmailIframe({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(640);

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const measure = () => {
      const next = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0, 640);
      setHeight(next + 24);
    };
    measure();
    doc.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", measure, { once: true });
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      <iframe
        ref={iframeRef}
        title="Email preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="block w-full"
        style={{ height }}
        onLoad={handleLoad}
      />
    </div>
  );
}
