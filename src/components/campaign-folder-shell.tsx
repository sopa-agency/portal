"use client";

import { FileText, Plus, Trash2, Star } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocument, deleteDocument } from "@/app/actions/campaigns";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";

type CampaignDocument = {
  id: string;
  name: string;
  content: string;
  isMain: boolean;
  updatedAt: Date;
};

export function CampaignFolderShell({
  campaignId,
  documents,
}: {
  campaignId: string;
  documents: CampaignDocument[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(() => documents[0]?.id ?? null);
  const selected = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? documents[0] ?? null,
    [documents, selectedId],
  );

  const handleNew = () => {
    const name = window.prompt("Name the document", "Untitled document");
    if (!name) return;
    startTransition(async () => {
      const result = await createDocument(campaignId, name);
      if (result.ok && result.documentId) {
        setSelectedId(result.documentId);
        router.refresh();
      }
    });
  };

  const handleDelete = (doc: CampaignDocument) => {
    if (doc.isMain) return;
    if (!window.confirm(`Delete "${doc.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteDocument(doc.id);
      if (result.ok) {
        if (doc.id === selectedId) {
          const next = documents.find((d) => d.id !== doc.id);
          setSelectedId(next?.id ?? null);
        }
        router.refresh();
      }
    });
  };

  if (!selected) {
    return <p className="text-sm text-foreground-subtle">This campaign has no documents yet.</p>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <div className="flex items-center justify-between px-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-foreground-subtle">Files</p>
          <button
            type="button"
            onClick={handleNew}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-bg disabled:opacity-50"
            aria-label="New document"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>
        <ul className="space-y-1">
          {documents.map((doc) => {
            const active = doc.id === selected.id;
            return (
              <li key={doc.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(doc.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-accent-border bg-accent-bg"
                      : "border-transparent hover:border-border hover:bg-foreground/5"
                  }`}
                  aria-pressed={active}
                >
                  {doc.isMain ? (
                    <Star className={`h-4 w-4 shrink-0 ${active ? "text-accent" : "text-accent/60"}`} />
                  ) : (
                    <FileText className={`h-4 w-4 shrink-0 ${active ? "text-foreground" : "text-foreground-muted"}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${active ? "text-foreground" : "text-foreground"}`}>
                      {doc.name}
                    </p>
                    <p className="truncate text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
                      {doc.isMain ? "Brief" : "Document"}
                    </p>
                  </div>
                </button>
                {!doc.isMain && (
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={pending}
                    aria-label={`Delete ${doc.name}`}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-subtle opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0">
        <CampaignDocumentEditor
          key={selected.id}
          documentId={selected.id}
          initialName={selected.name}
          initialContent={selected.content}
        />
      </div>
    </div>
  );
}
