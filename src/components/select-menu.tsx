"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnchoredPopover } from "@/components/anchored-popover";

export type SelectOption = {
  value: string;
  label: string;
  /** Optional swatch, e.g. the repo's hue — same dot the filter chips use. */
  dot?: string;
};

/**
 * The house replacement for a native <select>.
 *
 * A native select can't be styled below the trigger: the list is drawn by the
 * OS, so it ignores the theme entirely — white list, system font, system
 * highlight, in the middle of a dark board. This renders the list itself.
 *
 * Focus deliberately never leaves the trigger; the highlighted row is announced
 * through `aria-activedescendant` (the listbox-popup pattern). That keeps the
 * card dialog's focus trap intact — it only knows about elements inside the
 * dialog, and this list is portalled out of it.
 *
 * Typeahead is here because a native select has it: with a handful of repos
 * that all start differently, typing "m" is the fastest way to choose.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  size = "md",
  label,
  title,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  /** Draws the trigger in the warning tone — a required choice not made yet. */
  invalid?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Accessible name for the trigger and the list. */
  label: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const close = useCallback(() => setOpen(false), []);

  const openList = useCallback(() => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  }, [options, value]);

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Keep the highlighted row visible when arrowing past the panel's edge.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  // Typeahead buffer: consecutive letters narrow the match, a pause resets it.
  const typed = useRef("");
  const typedTimer = useRef<number | null>(null);
  function typeahead(key: string) {
    if (key.length !== 1 || !/\S/.test(key)) return;
    typed.current += key.toLowerCase();
    if (typedTimer.current) window.clearTimeout(typedTimer.current);
    typedTimer.current = window.setTimeout(() => (typed.current = ""), 600);
    const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current));
    if (i >= 0) setActive(i);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (options[active]) choose(options[active]);
        break;
      case "Tab":
        // Let focus move on, but don't leave a menu hanging over the page.
        setOpen(false);
        break;
      default:
        typeahead(e.key);
    }
    // Escape is handled by AnchoredPopover, which has to intercept it earlier
    // than the dialog that may be hosting this field.
  }

  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-2 text-sm";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`flex items-center gap-1.5 rounded-lg border bg-surface outline-none transition-colors disabled:opacity-50 ${pad} ${
          invalid
            ? "border-warning text-warning hover:border-warning"
            : open
              ? "border-accent-border text-foreground"
              : "border-border text-foreground-muted hover:border-border-strong hover:text-foreground"
        } ${className}`}
      >
        {selected?.dot && (
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: selected.dot }} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <AnchoredPopover open={open} onClose={close} anchorRef={triggerRef} className="max-h-64 overflow-y-auto p-1">
        <ul role="listbox" id={listId} aria-label={label}>
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              // No key handler on the row on purpose: the keyboard drives this
              // list from the trigger, through aria-activedescendant.
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                  i === active ? "bg-accent-bg text-accent" : "text-foreground-muted"
                }`}
              >
                {o.dot && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.dot }} aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      </AnchoredPopover>
    </>
  );
}
