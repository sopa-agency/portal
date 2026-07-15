"use client";

import {
  BookOpenText,
  Coins,
  FileText,
  Flame,
  Images,
  Mail,
  MessageCircleMore,
  MessageSquare,
  Plus,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocument, deleteDocument } from "@/app/actions/campaigns";
import { CampaignArtifactActions } from "@/components/campaign-artifact-actions";
import { CampaignCarouselEditor } from "@/components/campaign-carousel-editor";
import { CampaignDocumentEditor } from "@/components/campaign-document-editor";
import { CampaignDocumentPanel } from "@/components/campaign-document-panel";
import {
  classifyCampaignDocument,
  type CampaignDocumentKind,
  type CampaignPreviewBrand,
} from "@/components/campaign-document-preview";
import { CampaignEmailEditor } from "@/components/campaign-email-editor";
import { CampaignOutreachPanel } from "@/components/campaign-outreach-panel";
import { DEFAULT_EMAIL_BRAND } from "@/lib/campaign-email";
import { CampaignGenerateBar } from "@/components/campaign-generate-bar";

type CampaignDocument = {
  id: string;
  name: string;
  content: string;
  isMain: boolean;
  updatedAt: Date;
  postedAt: Date | null;
};

const KIND_META: Record<CampaignDocumentKind, { label: string; icon: typeof Mail; tone: string }> = {
  brief:     { label: "Brief / Hive blog",       icon: FileText,          tone: "text-foreground-muted" },
  hive:      { label: "Hive snap",               icon: Flame,             tone: "text-red-400" },
  hive_mag:  { label: "Hive blog (mag post)",    icon: BookOpenText,      tone: "text-red-400" },
  farcaster: { label: "Farcaster cast",          icon: Send,              tone: "text-purple-400" },
  tweets:    { label: "Twitter / X thread",      icon: MessageCircleMore, tone: "text-foreground" },
  discord:   { label: "Discord announcement",    icon: MessageSquare,     tone: "text-indigo-400" },
  binance:   { label: "Binance Square post",     icon: Coins,             tone: "text-yellow-500" },
  instagram: { label: "Instagram carousel",      icon: Images,            tone: "text-pink-400" },
  email:     { label: "Email",                   icon: Mail,              tone: "text-accent" },
  markdown:  { label: "Markdown post",           icon: BookOpenText,      tone: "text-amber-400" },
  doc:       { label: "Document",                icon: FileText,          tone: "text-foreground-muted" },
};

export function CampaignFolderShell({
  campaignId,
  documents,
  brand,
}: {
  campaignId: string;
  documents: CampaignDocument[];
  brand?: CampaignPreviewBrand;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const enriched = useMemo(
    () =>
      documents.map((d) => ({
        ...d,
        kind: classifyCampaignDocument(d.name, d.isMain),
      })),
    [documents],
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => enriched[0]?.id ?? null);
  const selected = enriched.find((d) => d.id === selectedId) ?? enriched[0] ?? null;

  // Local content override — updated after a successful remix so the preview
  // refreshes immediately without a full router.refresh().
  const [localContent, setLocalContent] = useState<Record<string, string>>({});

  const getContent = (doc: typeof enriched[number]) =>
    localContent[doc.id] ?? doc.content;

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
          const next = enriched.find((d) => d.id !== doc.id);
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
          {enriched.map((doc) => {
            const meta = KIND_META[doc.kind];
            const Icon = doc.isMain ? Star : meta.icon;
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
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? "text-foreground" : doc.isMain ? "text-accent/70" : meta.tone
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                    <p className="truncate text-[10px] uppercase tracking-[0.18em] text-foreground-subtle">
                      {meta.label}
                    </p>
                  </div>
                </button>
                {!doc.isMain && (
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={pending}
                    aria-label={`Delete ${doc.name}`}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-foreground-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="min-w-0 space-y-4">
        {selected.kind === "brief" ? (
          <>
            <CampaignGenerateBar campaignId={campaignId} />
            <CampaignDocumentEditor
              key={selected.id}
              documentId={selected.id}
              initialName={selected.name}
              initialContent={selected.content}
            />
          </>
        ) : selected.kind === "markdown" ? (
          <CampaignDocumentEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
          />
        ) : selected.kind === "email" ? (
          <div className="space-y-4">
            <CampaignEmailEditor
              key={selected.id}
              documentId={selected.id}
              initialName={selected.name}
              initialContent={selected.content}
              updatedAt={selected.updatedAt}
              emailBrand={
                brand
                  ? {
                      name: brand.displayName,
                      url: brand.siteUrl ?? DEFAULT_EMAIL_BRAND.url,
                      accent: brand.accent ?? DEFAULT_EMAIL_BRAND.accent,
                      accentDark: brand.accentDark ?? DEFAULT_EMAIL_BRAND.accentDark,
                    }
                  : undefined
              }
            />
            <CampaignArtifactActions
              documentId={selected.id}
              kind="email"
              content={getContent(selected)}
              initialPostedAt={selected.postedAt}
              onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
            />
            <CampaignOutreachPanel campaignId={campaignId} />
          </div>
        ) : selected.kind === "hive" ||
          selected.kind === "hive_mag" ||
          selected.kind === "farcaster" ||
          selected.kind === "tweets" ||
          selected.kind === "discord" ||
          selected.kind === "binance" ? (
          <CampaignDocumentPanel
            key={selected.id}
            doc={{
              id: selected.id,
              name: selected.name,
              updatedAt: selected.updatedAt,
              postedAt: selected.postedAt,
            }}
            kind={selected.kind}
            brand={brand}
            content={getContent(selected)}
            onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
          />
        ) : selected.kind === "instagram" ? (
          <CampaignCarouselEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
            initialPostedAt={selected.postedAt}
            brand={brand}
            onContentChange={(c) => setLocalContent((prev) => ({ ...prev, [selected.id]: c }))}
          />
        ) : (
          <CampaignDocumentEditor
            key={selected.id}
            documentId={selected.id}
            initialName={selected.name}
            initialContent={selected.content}
          />
        )}
      </div>
    </div>
  );
}
