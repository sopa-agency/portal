"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Columns2,
  Columns3,
  Folder,
  Heading,
  Image as ImageIcon,
  Layout,
  List as ListIcon,
  ListOrdered,
  Loader2,
  Minus,
  MousePointerClick,
  Move,
  Plus,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { importDriveImageToPinata } from "@/app/actions/drive-import";
import {
  type Align,
  type ButtonBlock,
  type DividerBlock,
  type EmailBlock,
  type EmailColumn,
  type EmailDocument,
  type EmailSection,
  type HeadingBlock,
  type ImageBlock,
  type ListBlock,
  type SpacerBlock,
  type TextBlock,
  newBlock,
  newColumn,
  type EmailBrand,
  newSection,
  renderEmail,
} from "@/lib/campaign-email";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type Selection =
  | { kind: "none" }
  | { kind: "section"; sectionId: string }
  | { kind: "block"; sectionId: string; columnId: string; blockId: string };

export function CampaignEmailBuilderDialog({
  onClose,
  initialDocument,
  onSave,
  emailBrand,
}: {
  onClose: () => void;
  initialDocument: EmailDocument;
  onSave: (doc: EmailDocument) => void;
  emailBrand?: EmailBrand;
}) {
  const [doc, setDoc] = useState<EmailDocument>(initialDocument);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleClose = useCallback(() => {
    onSave(doc);
    onClose();
  }, [doc, onSave, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // ----- Section ops --------------------------------------------------------

  const addSection = (columnCount: 1 | 2 | 3) => {
    setDoc((d) => ({ ...d, sections: [...d.sections, newSection(columnCount)] }));
  };

  const removeSection = (sectionId: string) => {
    setDoc((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== sectionId) }));
    setSelection({ kind: "none" });
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    setDoc((d) => {
      const idx = d.sections.findIndex((s) => s.id === sectionId);
      if (idx < 0) return d;
      const next = idx + dir;
      if (next < 0 || next >= d.sections.length) return d;
      const sections = [...d.sections];
      const [s] = sections.splice(idx, 1);
      sections.splice(next, 0, s);
      return { ...d, sections };
    });
  };

  const updateSection = (sectionId: string, patch: Partial<EmailSection>) => {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    }));
  };

  const setSectionColumns = (sectionId: string, count: 1 | 2 | 3) => {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const current = s.columns;
        if (current.length === count) return s;
        if (current.length < count) {
          const extra = Array.from({ length: count - current.length }, () => newColumn());
          return { ...s, columns: [...current, ...extra] };
        }
        const keep = current.slice(0, count);
        const collapsed = current.slice(count).flatMap((c) => c.blocks);
        const merged = [...keep];
        merged[0] = { ...merged[0], blocks: [...merged[0].blocks, ...collapsed] };
        return { ...s, columns: merged };
      }),
    }));
  };

  // ----- Block ops ----------------------------------------------------------

  const addBlock = (sectionId: string, columnId: string, type: EmailBlock["type"]) => {
    const block = newBlock(type, emailBrand);
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              columns: s.columns.map((c) =>
                c.id === columnId ? { ...c, blocks: [...c.blocks, block] } : c,
              ),
            }
          : s,
      ),
    }));
    setSelection({ kind: "block", sectionId, columnId, blockId: block.id });
  };

  const updateBlock = (
    sectionId: string,
    columnId: string,
    blockId: string,
    patch: Partial<EmailBlock>,
  ) => {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              columns: s.columns.map((c) =>
                c.id === columnId
                  ? {
                      ...c,
                      blocks: c.blocks.map((b) =>
                        b.id === blockId ? ({ ...b, ...patch } as EmailBlock) : b,
                      ),
                    }
                  : c,
              ),
            }
          : s,
      ),
    }));
  };

  const removeBlock = (sectionId: string, columnId: string, blockId: string) => {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              columns: s.columns.map((c) =>
                c.id === columnId ? { ...c, blocks: c.blocks.filter((b) => b.id !== blockId) } : c,
              ),
            }
          : s,
      ),
    }));
    setSelection({ kind: "none" });
  };

  const moveBlock = (sectionId: string, columnId: string, blockId: string, dir: -1 | 1) => {
    setDoc((d) => ({
      ...d,
      sections: d.sections.map((s) => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          columns: s.columns.map((c) => {
            if (c.id !== columnId) return c;
            const idx = c.blocks.findIndex((b) => b.id === blockId);
            if (idx < 0) return c;
            const next = idx + dir;
            if (next < 0 || next >= c.blocks.length) return c;
            const blocks = [...c.blocks];
            const [b] = blocks.splice(idx, 1);
            blocks.splice(next, 0, b);
            return { ...c, blocks };
          }),
        };
      }),
    }));
  };

  // ----- Render -------------------------------------------------------------

  if (!mounted) return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Email builder"
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
    >
      <BuilderTopBar
        subject={doc.subject}
        preheader={doc.preheader}
        onSubjectChange={(subject) => setDoc((d) => ({ ...d, subject }))}
        onPreheaderChange={(preheader) => setDoc((d) => ({ ...d, preheader }))}
        onClose={handleClose}
      />

      <div className="flex min-h-0 flex-1">
        <Palette
          onAddBlock={(type) => {
            const target = activeColumn(doc, selection);
            if (target) addBlock(target.sectionId, target.columnId, type);
            else if (doc.sections[0])
              addBlock(doc.sections[0].id, doc.sections[0].columns[0].id, type);
          }}
          onAddSection={addSection}
        />

        <main className="min-w-0 flex-1 overflow-auto bg-surface-elevated p-8">
          <div
            className="mx-auto rounded-lg shadow-2xl"
            style={{ width: doc.contentWidth, maxWidth: "100%", background: doc.contentBackground }}
          >
            {doc.sections.length === 0 ? (
              <EmptyState />
            ) : (
              doc.sections.map((section, sIdx) => (
                <SectionView
                  key={section.id}
                  section={section}
                  index={sIdx}
                  total={doc.sections.length}
                  selection={selection}
                  onSelect={(sel) => setSelection(sel)}
                  onUpdateSection={(patch) => updateSection(section.id, patch)}
                  onSetColumns={(count) => setSectionColumns(section.id, count)}
                  onRemoveSection={() => removeSection(section.id)}
                  onMoveSection={(dir) => moveSection(section.id, dir)}
                  onUpdateBlock={(columnId, blockId, patch) =>
                    updateBlock(section.id, columnId, blockId, patch)
                  }
                  onRemoveBlock={(columnId, blockId) => removeBlock(section.id, columnId, blockId)}
                  onMoveBlock={(columnId, blockId, dir) =>
                    moveBlock(section.id, columnId, blockId, dir)
                  }
                  onAddBlockToColumn={(columnId, type) => addBlock(section.id, columnId, type)}
                />
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function BuilderTopBar({
  subject,
  preheader,
  onSubjectChange,
  onPreheaderChange,
  onClose,
}: {
  subject: string;
  preheader: string;
  onSubjectChange: (s: string) => void;
  onPreheaderChange: (s: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="flex min-w-0 flex-1 gap-4">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.22em] text-foreground-subtle">Subject</span>
          <input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Email subject line"
            className="min-w-0 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground-faint"
          />
        </label>
        <label className="flex min-w-0 flex-[1.4] flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.22em] text-foreground-subtle">Preheader</span>
          <input
            value={preheader}
            onChange={(e) => onPreheaderChange(e.target.value)}
            placeholder="Inbox preview text"
            className="min-w-0 bg-transparent text-sm text-foreground-muted outline-none placeholder:text-foreground-faint"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-foreground/5"
      >
        Done
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function Palette({
  onAddBlock,
  onAddSection,
}: {
  onAddBlock: (type: EmailBlock["type"]) => void;
  onAddSection: (cols: 1 | 2 | 3) => void;
}) {
  const blockItems: Array<{ type: EmailBlock["type"]; label: string; Icon: typeof Plus }> = [
    { type: "heading", label: "Heading", Icon: Heading },
    { type: "text", label: "Text", Icon: Type },
    { type: "image", label: "Image", Icon: ImageIcon },
    { type: "button", label: "Button", Icon: MousePointerClick },
    { type: "list", label: "List", Icon: ListIcon },
    { type: "divider", label: "Divider", Icon: Minus },
    { type: "spacer", label: "Spacer", Icon: Square },
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-4">
      <div>
        <p className="px-1 pb-2 text-[10px] uppercase tracking-[0.22em] text-foreground-subtle">Blocks</p>
        <div className="grid grid-cols-2 gap-2">
          {blockItems.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => onAddBlock(type)}
              className="flex flex-col items-center gap-1 rounded-lg border border-border bg-surface-elevated px-2 py-3 text-xs text-foreground transition hover:border-accent-border hover:bg-accent-bg"
            >
              <Icon className="h-4 w-4 text-foreground-muted" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="px-1 pb-2 text-[10px] uppercase tracking-[0.22em] text-foreground-subtle">Sections</p>
        <div className="space-y-1.5">
          <PaletteSectionButton
            onClick={() => onAddSection(1)}
            icon={<Layout className="h-4 w-4" />}
            label="1 column"
          />
          <PaletteSectionButton
            onClick={() => onAddSection(2)}
            icon={<Columns2 className="h-4 w-4" />}
            label="2 columns"
          />
          <PaletteSectionButton
            onClick={() => onAddSection(3)}
            icon={<Columns3 className="h-4 w-4" />}
            label="3 columns"
          />
        </div>
      </div>
    </aside>
  );
}

function PaletteSectionButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground transition hover:border-accent-border hover:bg-accent-bg"
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section view
// ---------------------------------------------------------------------------

function SectionView({
  section,
  index,
  total,
  selection,
  onSelect,
  onUpdateSection,
  onSetColumns,
  onRemoveSection,
  onMoveSection,
  onUpdateBlock,
  onRemoveBlock,
  onMoveBlock,
  onAddBlockToColumn,
}: {
  section: EmailSection;
  index: number;
  total: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onUpdateSection: (patch: Partial<EmailSection>) => void;
  onSetColumns: (count: 1 | 2 | 3) => void;
  onRemoveSection: () => void;
  onMoveSection: (dir: -1 | 1) => void;
  onUpdateBlock: (columnId: string, blockId: string, patch: Partial<EmailBlock>) => void;
  onRemoveBlock: (columnId: string, blockId: string) => void;
  onMoveBlock: (columnId: string, blockId: string, dir: -1 | 1) => void;
  onAddBlockToColumn: (columnId: string, type: EmailBlock["type"]) => void;
}) {
  const sectionSelected = selection.kind === "section" && selection.sectionId === section.id;
  return (
    <div
      className={`group/section relative ${sectionSelected ? "outline outline-2 outline-accent" : ""}`}
      style={{ background: section.background, padding: `${section.paddingY}px ${section.paddingX}px` }}
      onClick={(event) => {
        if (event.target === event.currentTarget)
          onSelect({ kind: "section", sectionId: section.id });
      }}
    >
      <div className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1 opacity-0 transition group-hover/section:opacity-100">
        <SectionChip
          label={`Section ${index + 1}`}
          onClick={() => onSelect({ kind: "section", sectionId: section.id })}
        />
      </div>
      <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition group-hover/section:opacity-100">
        <IconChip
          title="Move up"
          disabled={index === 0}
          onClick={() => onMoveSection(-1)}
          icon={<ArrowUp className="h-3 w-3" />}
        />
        <IconChip
          title="Move down"
          disabled={index === total - 1}
          onClick={() => onMoveSection(1)}
          icon={<ArrowDown className="h-3 w-3" />}
        />
        <IconChip
          title="Delete section"
          onClick={onRemoveSection}
          icon={<Trash2 className="h-3 w-3" />}
          tone="danger"
        />
      </div>

      <div className="flex gap-3" style={{ gap: 16 }}>
        {section.columns.map((col) => (
          <ColumnView
            key={col.id}
            section={section}
            column={col}
            selection={selection}
            onSelect={onSelect}
            onUpdateBlock={(blockId, patch) => onUpdateBlock(col.id, blockId, patch)}
            onRemoveBlock={(blockId) => onRemoveBlock(col.id, blockId)}
            onMoveBlock={(blockId, dir) => onMoveBlock(col.id, blockId, dir)}
            onAddBlock={(type) => onAddBlockToColumn(col.id, type)}
          />
        ))}
      </div>

      {sectionSelected ? (
        <SectionInspector section={section} onUpdate={onUpdateSection} onSetColumns={onSetColumns} />
      ) : null}
    </div>
  );
}

function SectionChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/40 bg-black/65 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm backdrop-blur-sm hover:bg-black/80"
    >
      <Move className="h-3 w-3" />
      {label}
    </button>
  );
}

function IconChip({
  title,
  onClick,
  icon,
  disabled,
  tone,
}: {
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/40 shadow-sm backdrop-blur-sm ${
        tone === "danger"
          ? "bg-rose-600/85 text-white hover:bg-rose-600"
          : "bg-black/65 text-white hover:bg-black/85"
      } disabled:opacity-30`}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Column view
// ---------------------------------------------------------------------------

function ColumnView({
  section,
  column,
  selection,
  onSelect,
  onUpdateBlock,
  onRemoveBlock,
  onMoveBlock,
  onAddBlock,
}: {
  section: EmailSection;
  column: EmailColumn;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onUpdateBlock: (blockId: string, patch: Partial<EmailBlock>) => void;
  onRemoveBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, dir: -1 | 1) => void;
  onAddBlock: (type: EmailBlock["type"]) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {column.blocks.length === 0 ? (
        <EmptyColumn onAddBlock={onAddBlock} />
      ) : (
        column.blocks.map((block, idx) => (
          <BlockView
            key={block.id}
            block={block}
            selected={selection.kind === "block" && selection.blockId === block.id}
            onSelect={() =>
              onSelect({ kind: "block", sectionId: section.id, columnId: column.id, blockId: block.id })
            }
            onUpdate={(patch) => onUpdateBlock(block.id, patch)}
            onRemove={() => onRemoveBlock(block.id)}
            onMoveUp={() => onMoveBlock(block.id, -1)}
            onMoveDown={() => onMoveBlock(block.id, 1)}
            canMoveUp={idx > 0}
            canMoveDown={idx < column.blocks.length - 1}
          />
        ))
      )}
      {column.blocks.length > 0 ? <ColumnAddButton onAddBlock={onAddBlock} /> : null}
    </div>
  );
}

function EmptyColumn({ onAddBlock }: { onAddBlock: (type: EmailBlock["type"]) => void }) {
  return (
    <div className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white/40 p-4 text-zinc-500">
      <p className="text-xs">Empty column</p>
      <ColumnAddButton onAddBlock={onAddBlock} compact />
    </div>
  );
}

function ColumnAddButton({
  onAddBlock,
  compact,
}: {
  onAddBlock: (type: EmailBlock["type"]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-400 bg-white/60 text-xs font-medium text-zinc-600 transition hover:border-lime-600 hover:text-lime-700 ${
          compact ? "px-2 py-1" : "w-full justify-center px-3 py-1.5"
        }`}
      >
        <Plus className="h-3.5 w-3.5" />
        Add block
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-10 mt-1 grid w-44 grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl">
          {(["heading", "text", "image", "button", "list", "divider", "spacer"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                onAddBlock(t);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-left text-xs capitalize text-zinc-700 hover:bg-zinc-100"
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block view + inspector
// ---------------------------------------------------------------------------

function BlockView({
  block,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  block: EmailBlock;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<EmailBlock>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div
      className={`group/block relative rounded-md transition ${selected ? "ring-2 ring-lime-500" : "hover:ring-1 hover:ring-zinc-300"}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <div className="pointer-events-none absolute right-1 top-1 z-20 flex items-center gap-1 rounded-full bg-white/90 px-1 py-1 opacity-0 shadow-sm ring-1 ring-zinc-200 backdrop-blur-sm transition group-hover/block:opacity-100">
        <IconChip title="Move up" disabled={!canMoveUp} onClick={onMoveUp} icon={<ArrowUp className="h-3 w-3" />} />
        <IconChip title="Move down" disabled={!canMoveDown} onClick={onMoveDown} icon={<ArrowDown className="h-3 w-3" />} />
        <IconChip title="Delete block" onClick={onRemove} icon={<Trash2 className="h-3 w-3" />} tone="danger" />
      </div>
      <BlockEditableBody block={block} onUpdate={onUpdate} />
      {selected ? <BlockInspector block={block} onUpdate={onUpdate} /> : null}
    </div>
  );
}

function BlockEditableBody({
  block,
  onUpdate,
}: {
  block: EmailBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  switch (block.type) {
    case "heading":
      return <HeadingView block={block} onUpdate={onUpdate} />;
    case "text":
      return <TextView block={block} onUpdate={onUpdate} />;
    case "image":
      return <ImageView block={block} onUpdate={onUpdate} />;
    case "button":
      return <ButtonView block={block} />;
    case "divider":
      return <DividerView block={block} />;
    case "spacer":
      return <SpacerView block={block} />;
    case "list":
      return <ListView block={block} onUpdate={onUpdate} />;
  }
}

// ---------------------------------------------------------------------------
// Individual block views (WYSIWYG — render on top of the email's own
// background colors, so we keep hex colors here intentionally).
// ---------------------------------------------------------------------------

function HeadingView({
  block,
  onUpdate,
}: {
  block: HeadingBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  const size = block.level === 1 ? 28 : block.level === 2 ? 22 : 14;
  const weight = block.level === 3 ? 700 : 600;
  const tracking = block.level === 3 ? "0.16em" : "normal";
  const transform = block.level === 3 ? "uppercase" : "none";
  return (
    <ContentEditable
      value={block.text}
      onChange={(text) => onUpdate({ text } as Partial<HeadingBlock>)}
      style={{
        fontSize: size,
        fontWeight: weight,
        color: block.color,
        textAlign: block.align,
        letterSpacing: tracking,
        textTransform: transform,
        padding: "8px 10px",
        margin: "0 0 4px 0",
        lineHeight: 1.25,
      }}
    />
  );
}

function TextView({
  block,
  onUpdate,
}: {
  block: TextBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <ContentEditable
      value={block.html}
      onChange={(html) => onUpdate({ html } as Partial<TextBlock>)}
      multiline
      style={{
        fontSize: 15,
        lineHeight: 1.6,
        color: block.color,
        textAlign: block.align,
        padding: "8px 10px",
      }}
    />
  );
}

function ImageView({
  block,
  onUpdate,
}: {
  block: ImageBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);

  const accept = (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is over 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (src) onUpdate({ src } as Partial<ImageBlock>);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  if (!block.src) {
    return (
      <div className="px-2 py-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={(e) => {
            e.preventDefault();
            setHover(false);
            const f = e.dataTransfer.files?.[0];
            if (f) accept(f);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-10 text-center transition ${
            hover ? "border-lime-500 bg-lime-100/40" : "border-zinc-300 bg-zinc-50"
          }`}
        >
          <ImageIcon className="h-6 w-6 text-zinc-500" />
          <p className="text-sm font-medium text-zinc-700">Drop image here</p>
          <p className="text-[11px] text-zinc-500">PNG / JPG / GIF / WebP, up to 2 MB</p>
        </button>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="Insert image from Google Drive"
            onClick={() => setDrivePickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            <Folder className="h-3.5 w-3.5 text-zinc-500" />
            Insert from Drive
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) accept(f);
            e.target.value = "";
          }}
        />
        {error ? <p className="mt-1 text-[11px] text-rose-600">{error}</p> : null}
        {drivePickerOpen
          ? createPortal(
              <DriveImagePicker
                onSelect={(url) => {
                  onUpdate({ src: url } as Partial<ImageBlock>);
                  setDrivePickerOpen(false);
                }}
                onClose={() => setDrivePickerOpen(false)}
              />,
              document.body,
            )
          : null}
      </div>
    );
  }

  return (
    <div style={{ textAlign: block.align, padding: "8px 10px" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.src}
        alt={block.alt}
        style={{ display: "inline-block", maxWidth: `${block.width}%`, height: "auto", borderRadius: 6 }}
      />
    </div>
  );
}

function ButtonView({ block }: { block: ButtonBlock }) {
  return (
    <div style={{ textAlign: block.align, padding: "8px 10px" }}>
      <span
        style={{
          display: "inline-block",
          background: block.bg,
          color: block.color,
          padding: "12px 22px",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        {block.label || "Button"}
      </span>
    </div>
  );
}

function DividerView({ block }: { block: DividerBlock }) {
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ borderTop: `${block.thickness}px solid ${block.color}`, height: 0 }} />
    </div>
  );
}

function SpacerView({ block }: { block: SpacerBlock }) {
  return <div style={{ height: block.height, padding: "0 10px" }} />;
}

function ListView({
  block,
  onUpdate,
}: {
  block: ListBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div style={{ padding: "8px 10px" }}>
      {block.items.map((item, idx) => (
        <div key={idx} className="flex items-baseline gap-2">
          <span className="w-4 shrink-0 text-zinc-500">{block.ordered ? `${idx + 1}.` : "•"}</span>
          <input
            value={item}
            onChange={(e) => {
              const items = [...block.items];
              items[idx] = e.target.value;
              onUpdate({ items } as Partial<ListBlock>);
            }}
            className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1 text-[15px] text-zinc-700 outline-none focus:border-lime-500/60"
          />
          <button
            type="button"
            onClick={() => {
              const items = block.items.filter((_, i) => i !== idx);
              onUpdate({ items } as Partial<ListBlock>);
            }}
            className="text-xs text-zinc-400 hover:text-rose-500"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onUpdate({ items: [...block.items, "New item"] } as Partial<ListBlock>)}
        className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-lime-700"
      >
        <Plus className="h-3 w-3" />
        Add item
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentEditable wrapper (uncontrolled DOM, sync on blur)
// ---------------------------------------------------------------------------

function ContentEditable({
  value,
  onChange,
  multiline,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onChange(e.currentTarget.innerText)}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") e.preventDefault();
      }}
      className="outline-none focus:bg-white/50 focus:ring-1 focus:ring-lime-500/40"
      style={{ minHeight: 18, whiteSpace: multiline ? "pre-wrap" : "nowrap", ...style }}
    />
  );
}

// ---------------------------------------------------------------------------
// Inspectors — render in a light panel that sits on the email canvas
// (intentionally not themed; the surrounding chrome is themed instead).
// ---------------------------------------------------------------------------

function BlockInspector({
  block,
  onUpdate,
}: {
  block: EmailBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div
      className="border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-zinc-700"
      onClick={(e) => e.stopPropagation()}
    >
      {block.type === "heading" ? <HeadingInspector block={block} onUpdate={onUpdate} /> : null}
      {block.type === "text" ? (
        <AlignColorInspector align={block.align} color={block.color} onUpdate={onUpdate} />
      ) : null}
      {block.type === "image" ? <ImageInspector block={block} onUpdate={onUpdate} /> : null}
      {block.type === "button" ? <ButtonInspector block={block} onUpdate={onUpdate} /> : null}
      {block.type === "divider" ? <DividerInspector block={block} onUpdate={onUpdate} /> : null}
      {block.type === "spacer" ? <SpacerInspector block={block} onUpdate={onUpdate} /> : null}
      {block.type === "list" ? <ListInspector block={block} onUpdate={onUpdate} /> : null}
    </div>
  );
}

function HeadingInspector({
  block,
  onUpdate,
}: {
  block: HeadingBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Field label="Level">
        <select
          value={block.level}
          onChange={(e) =>
            onUpdate({ level: Number(e.target.value) as 1 | 2 | 3 } as Partial<HeadingBlock>)
          }
          className="rounded border border-zinc-300 bg-white px-1.5 py-1"
        >
          <option value={1}>H1</option>
          <option value={2}>H2</option>
          <option value={3}>Eyebrow</option>
        </select>
      </Field>
      <AlignControl align={block.align} onChange={(align) => onUpdate({ align } as Partial<HeadingBlock>)} />
      <ColorControl
        label="Color"
        color={block.color}
        onChange={(color) => onUpdate({ color } as Partial<HeadingBlock>)}
      />
    </div>
  );
}

function AlignColorInspector({
  align,
  color,
  onUpdate,
}: {
  align: Align;
  color: string;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <AlignControl align={align} onChange={(a) => onUpdate({ align: a } as Partial<TextBlock>)} />
      <ColorControl label="Color" color={color} onChange={(c) => onUpdate({ color: c } as Partial<TextBlock>)} />
    </div>
  );
}

function ImageInspector({
  block,
  onUpdate,
}: {
  block: ImageBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50"
        >
          Replace image
        </button>
        <button
          type="button"
          aria-label="Insert image from Google Drive"
          onClick={() => setDrivePickerOpen(true)}
          className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-1 hover:bg-zinc-50"
        >
          <Folder className="h-3 w-3" />
          Insert from Drive
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > MAX_IMAGE_BYTES) {
              e.target.value = "";
              return;
            }
            const r = new FileReader();
            r.onload = () => onUpdate({ src: String(r.result || "") } as Partial<ImageBlock>);
            r.readAsDataURL(file);
            e.target.value = "";
          }}
        />
        <AlignControl align={block.align} onChange={(align) => onUpdate({ align } as Partial<ImageBlock>)} />
        <Field label="Width">
          <input
            type="range"
            min={20}
            max={100}
            step={5}
            value={block.width}
            onChange={(e) => onUpdate({ width: Number(e.target.value) } as Partial<ImageBlock>)}
          />
          <span className="w-10 text-right">{block.width}%</span>
        </Field>
        <Field label="Alt">
          <input
            value={block.alt}
            onChange={(e) => onUpdate({ alt: e.target.value } as Partial<ImageBlock>)}
            className="w-32 rounded border border-zinc-300 bg-white px-1.5 py-1"
          />
        </Field>
        <Field label="Link">
          <input
            value={block.href ?? ""}
            onChange={(e) => onUpdate({ href: e.target.value || undefined } as Partial<ImageBlock>)}
            placeholder="https://"
            className="w-40 rounded border border-zinc-300 bg-white px-1.5 py-1"
          />
        </Field>
      </div>
      {drivePickerOpen
        ? createPortal(
            <DriveImagePicker
              onSelect={(url) => {
                onUpdate({ src: url } as Partial<ImageBlock>);
                setDrivePickerOpen(false);
              }}
              onClose={() => setDrivePickerOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function ButtonInspector({
  block,
  onUpdate,
}: {
  block: ButtonBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Field label="Label">
        <input
          value={block.label}
          onChange={(e) => onUpdate({ label: e.target.value } as Partial<ButtonBlock>)}
          className="w-32 rounded border border-zinc-300 bg-white px-1.5 py-1"
        />
      </Field>
      <Field label="Link">
        <input
          value={block.href}
          onChange={(e) => onUpdate({ href: e.target.value } as Partial<ButtonBlock>)}
          placeholder="https://"
          className="w-44 rounded border border-zinc-300 bg-white px-1.5 py-1"
        />
      </Field>
      <AlignControl align={block.align} onChange={(align) => onUpdate({ align } as Partial<ButtonBlock>)} />
      <ColorControl label="BG" color={block.bg} onChange={(bg) => onUpdate({ bg } as Partial<ButtonBlock>)} />
      <ColorControl
        label="Text"
        color={block.color}
        onChange={(color) => onUpdate({ color } as Partial<ButtonBlock>)}
      />
    </div>
  );
}

function DividerInspector({
  block,
  onUpdate,
}: {
  block: DividerBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <ColorControl
        label="Color"
        color={block.color}
        onChange={(color) => onUpdate({ color } as Partial<DividerBlock>)}
      />
      <Field label="Thickness">
        <input
          type="number"
          min={1}
          max={8}
          value={block.thickness}
          onChange={(e) => onUpdate({ thickness: Number(e.target.value) } as Partial<DividerBlock>)}
          className="w-14 rounded border border-zinc-300 bg-white px-1.5 py-1"
        />
        px
      </Field>
    </div>
  );
}

function SpacerInspector({
  block,
  onUpdate,
}: {
  block: SpacerBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Field label="Height">
        <input
          type="number"
          min={4}
          max={200}
          value={block.height}
          onChange={(e) => onUpdate({ height: Number(e.target.value) } as Partial<SpacerBlock>)}
          className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-1"
        />
        px
      </Field>
    </div>
  );
}

function ListInspector({
  block,
  onUpdate,
}: {
  block: ListBlock;
  onUpdate: (patch: Partial<EmailBlock>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Field label="Style">
        <button
          type="button"
          onClick={() => onUpdate({ ordered: false } as Partial<ListBlock>)}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 ${!block.ordered ? "border-lime-600 bg-lime-100/50" : "border-zinc-300 bg-white"}`}
        >
          <ListIcon className="h-3 w-3" /> Bulleted
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ ordered: true } as Partial<ListBlock>)}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 ${block.ordered ? "border-lime-600 bg-lime-100/50" : "border-zinc-300 bg-white"}`}
        >
          <ListOrdered className="h-3 w-3" /> Numbered
        </button>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section inspector
// ---------------------------------------------------------------------------

function SectionInspector({
  section,
  onUpdate,
  onSetColumns,
}: {
  section: EmailSection;
  onUpdate: (patch: Partial<EmailSection>) => void;
  onSetColumns: (count: 1 | 2 | 3) => void;
}) {
  return (
    <div
      className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-3">
        <ColorControl
          label="Background"
          color={section.background}
          onChange={(c) => onUpdate({ background: c })}
        />
        <Field label="Padding Y">
          <input
            type="number"
            min={0}
            max={120}
            value={section.paddingY}
            onChange={(e) => onUpdate({ paddingY: Number(e.target.value) })}
            className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-1"
          />
        </Field>
        <Field label="Padding X">
          <input
            type="number"
            min={0}
            max={120}
            value={section.paddingX}
            onChange={(e) => onUpdate({ paddingX: Number(e.target.value) })}
            className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-1"
          />
        </Field>
        <Field label="Columns">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSetColumns(n as 1 | 2 | 3)}
              className={`rounded border px-2 py-1 ${section.columns.length === n ? "border-lime-600 bg-lime-100/50 text-lime-800" : "border-zinc-300 bg-white"}`}
            >
              {n}
            </button>
          ))}
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="inline-flex items-center gap-1">{children}</span>
    </label>
  );
}

function AlignControl({ align, onChange }: { align: Align; onChange: (a: Align) => void }) {
  const options: Array<{ a: Align; Icon: typeof AlignLeft }> = [
    { a: "left", Icon: AlignLeft },
    { a: "center", Icon: AlignCenter },
    { a: "right", Icon: AlignRight },
  ];
  return (
    <Field label="Align">
      <span className="inline-flex rounded border border-zinc-300 bg-white">
        {options.map(({ a, Icon }) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            className={`inline-flex h-7 w-7 items-center justify-center ${a === align ? "bg-lime-100/60 text-lime-800" : "text-zinc-500 hover:bg-zinc-100"}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </span>
    </Field>
  );
}

function ColorControl({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="color"
        value={normalizeColor(color)}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-zinc-300 bg-white p-0"
      />
      <input
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-1 text-[11px]"
      />
    </Field>
  );
}

function normalizeColor(value: string): string {
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return value;
  if (/^#([0-9a-fA-F]{3})$/.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return "#" + r + r + g + g + b + b;
  }
  return "#000000";
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="p-12 text-center text-zinc-400">
      <Layout className="mx-auto mb-3 h-8 w-8" />
      <p className="text-sm">This email is empty. Add a section from the left panel to get started.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drive image picker
// ---------------------------------------------------------------------------

type DriveFileEntry = {
  id: string;
  name: string;
  mimeType: string;
};

type DriveListResponse =
  | { ok: true; folderId: string; files: DriveFileEntry[] }
  | { ok: false; reason: string; saEmail?: string; note?: string; error?: string };

type BreadcrumbEntry = { id: string; name: string };

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

/**
 * A modal Drive image browser.
 * - Navigates folders with a breadcrumb trail.
 * - Clicking an image file calls importDriveImageToPinata(id), shows a
 *   spinner, then resolves the block src to the public Pinata URL.
 * - If Drive is not configured for the project, shows a friendly message.
 */
function DriveImagePicker({
  onSelect,
  onClose,
}: {
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([
    { id: "", name: "Drive" },
  ]);
  const [entries, setEntries] = useState<DriveFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [notConfiguredProject, setNotConfiguredProject] = useState<string>("");
  const [importing, setImporting] = useState<string | null>(null); // fileId being imported
  const [importError, setImportError] = useState<string | null>(null);

  const currentFolderId = breadcrumb[breadcrumb.length - 1]?.id ?? "";

  const fetchFolder = useCallback(async (folderId: string) => {
    setLoading(true);
    setListError(null);
    setImportError(null);
    try {
      const url = folderId
        ? `/api/brain/drive/list?folderId=${encodeURIComponent(folderId)}`
        : "/api/brain/drive/list";
      const res = await fetch(url);
      const data = (await res.json()) as DriveListResponse;
      if (!data.ok) {
        if (data.reason === "not-configured") {
          setNotConfigured(true);
          // Try to extract the project name from the note if present
          const noteMatch = (data.note ?? "").match(/tried (\w+)_GOOGLE/);
          const prefix = noteMatch ? noteMatch[1].toLowerCase() : "";
          setNotConfiguredProject(prefix || "this project");
        } else {
          setListError(
            "error" in data && data.error ? data.error : "Failed to list Drive folder.",
          );
        }
        setEntries([]);
      } else {
        setEntries(data.files);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Network error.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void fetchFolder("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateInto = (folder: DriveFileEntry) => {
    const next = [...breadcrumb, { id: folder.id, name: folder.name }];
    setBreadcrumb(next);
    void fetchFolder(folder.id);
  };

  const navigateTo = (idx: number) => {
    const next = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(next);
    void fetchFolder(next[next.length - 1]?.id ?? "");
  };

  const handleSelectImage = async (file: DriveFileEntry) => {
    setImporting(file.id);
    setImportError(null);
    try {
      const result = await importDriveImageToPinata(file.id);
      if (result.ok) {
        onSelect(result.url);
      } else {
        setImportError(result.error);
      }
    } finally {
      setImporting(null);
    }
  };

  const folders = entries.filter((e) => e.mimeType === GOOGLE_FOLDER_MIME);
  const images = entries.filter((e) => isImageMime(e.mimeType));
  const others = entries.filter(
    (e) => e.mimeType !== GOOGLE_FOLDER_MIME && !isImageMime(e.mimeType),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Insert image from Google Drive"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Insert from Google Drive</h2>
          <button
            type="button"
            aria-label="Close Drive image picker"
            onClick={onClose}
            className="rounded-md p-1 text-foreground-muted hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <nav
          aria-label="Drive folder navigation"
          className="flex items-center gap-1 border-b border-border px-4 py-2 text-xs text-foreground-muted"
        >
          {breadcrumb.map((crumb, idx) => (
            <span key={crumb.id || "root"} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-foreground-subtle" />}
              <button
                type="button"
                onClick={() => navigateTo(idx)}
                className={`rounded px-1 py-0.5 hover:bg-foreground/5 ${
                  idx === breadcrumb.length - 1
                    ? "font-semibold text-foreground"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Body */}
        <div className="min-h-[260px] overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2
                className="h-6 w-6 animate-spin text-foreground-muted"
                aria-label="Loading Drive contents"
              />
            </div>
          ) : notConfigured ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-foreground">Drive not connected</p>
              <p className="max-w-xs text-xs text-foreground-muted">
                Google Drive is not configured for {notConfiguredProject}. Ask your admin to set a{" "}
                <code className="rounded bg-surface-elevated px-1 py-0.5 font-mono text-[10px]">
                  GOOGLE_DRIVE_FOLDER_ID
                </code>{" "}
                environment variable.
              </p>
            </div>
          ) : listError ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm font-medium text-danger">Error loading Drive</p>
              <p className="max-w-xs text-xs text-foreground-muted">{listError}</p>
              <button
                type="button"
                onClick={() => void fetchFolder(currentFolderId)}
                className="mt-1 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-foreground hover:bg-foreground/5"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-foreground-muted">
              This folder is empty.
            </div>
          ) : (
            <div className="space-y-3">
              {importError ? (
                <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {importError}
                </p>
              ) : null}

              {/* Folders */}
              {folders.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-foreground-subtle">
                    Folders
                  </p>
                  <div className="space-y-0.5">
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        aria-label={`Open folder ${folder.name}`}
                        onClick={() => navigateInto(folder)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-foreground/5"
                      >
                        <Folder className="h-4 w-4 shrink-0 text-foreground-muted" />
                        <span className="truncate">{folder.name}</span>
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Images */}
              {images.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-foreground-subtle">
                    Images
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {images.map((img) => {
                      const isThis = importing === img.id;
                      const thumbUrl = `/api/brain/drive/file?id=${encodeURIComponent(img.id)}&mode=raw`;
                      return (
                        <button
                          key={img.id}
                          type="button"
                          disabled={importing !== null}
                          aria-label={`Insert image ${img.name}`}
                          onClick={() => void handleSelectImage(img)}
                          className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated transition hover:border-accent-border disabled:cursor-wait disabled:opacity-60"
                        >
                          <div className="relative aspect-square w-full overflow-hidden bg-surface">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={thumbUrl}
                              alt={img.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                            {isThis && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Loader2
                                  className="h-5 w-5 animate-spin text-white"
                                  aria-label="Uploading to Pinata"
                                />
                              </div>
                            )}
                          </div>
                          <p className="truncate px-1.5 py-1 text-[10px] text-foreground-muted">
                            {img.name}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Other non-image files (shown dimmed, not selectable) */}
              {others.length > 0 && images.length === 0 && folders.length === 0 && (
                <div className="flex h-28 flex-col items-center justify-center gap-1 text-center">
                  <ImageIcon className="h-6 w-6 text-foreground-subtle" />
                  <p className="text-xs text-foreground-muted">
                    No images found in this folder.
                  </p>
                  <p className="text-[11px] text-foreground-subtle">
                    Only PNG, JPG, GIF, WebP etc. can be inserted.
                  </p>
                </div>
              )}
              {others.length > 0 && (images.length > 0 || folders.length > 0) && (
                <p className="text-[11px] text-foreground-subtle">
                  {others.length} non-image file{others.length !== 1 ? "s" : ""} in this folder
                  (not selectable).
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activeColumn(
  doc: EmailDocument,
  selection: Selection,
): { sectionId: string; columnId: string } | null {
  if (selection.kind === "block") {
    return { sectionId: selection.sectionId, columnId: selection.columnId };
  }
  if (selection.kind === "section") {
    const section = doc.sections.find((s) => s.id === selection.sectionId);
    if (section && section.columns[0]) return { sectionId: section.id, columnId: section.columns[0].id };
  }
  return null;
}

export { renderEmail };
